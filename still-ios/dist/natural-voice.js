// Natural voice: a more human-sounding voice for read aloud, made by
// OpenAI's text-to-speech through this site's own small server function
// (netlify/functions/speak.mjs, which keeps the API key). Only the few
// sentences about to be read aloud are sent, one chunk at a time, and only
// while read aloud is on with a natural voice chosen; nothing is stored.
//
// NaturalPlayback has the same shape as engine.Playback and
// read-aloud.SpokenPlayback (index, playing, finished, play, pause, seek,
// retime, breakAfter/onBreak, onWord, onEnd), so the app swaps it in the same
// way. It speaks one sentence (chunk) at a time, fetches the next one while
// the current one plays, and moves the shown word by an estimate of when each
// word is said, since the voice gives no word timings.
import { clamp, endsSentence, clauseEnd, isSentenceEnd } from "./engine.js";
import { chunkEnd, utteranceText, estimateWordTimes } from "./read-aloud.js";
import { spokenBeats } from "./spoken.js";

export const NATURAL_PREFIX = "natural:";
// The voices offered (OpenAI's names); the server accepts only these.
// Marin and Cedar are the ones OpenAI recommends for the best quality.
export const NATURAL_VOICES = [
  { id: "marin", name: "Marin" },
  { id: "cedar", name: "Cedar" },
  { id: "coral", name: "Coral" },
  { id: "sage", name: "Sage" },
];
export const DEFAULT_NATURAL_VOICE = NATURAL_VOICES[0].id;
// The value stored in appearance.readAloudVoice for a natural voice, and
// back. Returns "" for anything that isn't one of NATURAL_VOICES.
export const naturalVoiceValue = (id) => NATURAL_PREFIX + id;
export function naturalVoiceId(value) {
  const id = String(value || "").startsWith(NATURAL_PREFIX)
    ? String(value).slice(NATURAL_PREFIX.length)
    : "";
  return NATURAL_VOICES.some((v) => v.id === id) ? id : "";
}
// The longest text the server takes in one request.
export const MAX_SPEAK_CHARS = 1200;
// The server functions (this voice, the visit counter and the waitlist and
// feedback forms) run on Netlify. Served from anywhere else, such as GitHub
// Pages, the app calls them there; on Netlify or locally, on the same site.
export const SERVER_SITE = "https://still123.netlify.app";
export function serverBase(scope = globalThis) {
  const host = scope.location?.hostname || "";
  return !host ||
    host.endsWith(".netlify.app") ||
    host === "localhost" ||
    host === "127.0.0.1"
    ? ""
    : SERVER_SITE;
}
export const SPEAK_ENDPOINT = serverBase() + "/api/speak";

// Everything the natural voice needs from the browser: Web Audio to play the
// clips, and fetch to get them.
export function naturalSupported(scope = globalThis) {
  try {
    return (
      !!(scope.AudioContext || scope.webkitAudioContext) &&
      typeof scope.fetch === "function"
    );
  } catch {
    return false;
  }
}

// ---- Pace ----
// The voices speak about 160 words a minute at speed 1 (learned per voice as
// they read). The speed option sounds natural from about 0.6 to 1.5.
export const NATURAL_ONE_WPM = 160;
export const MIN_SPEED = 0.6;
export const MAX_SPEED = 1.5;
export function speedForWpm(wpm, oneWpm = NATURAL_ONE_WPM) {
  const speed = clamp(
    (Number(wpm) || oneWpm) / (oneWpm || NATURAL_ONE_WPM),
    MIN_SPEED,
    MAX_SPEED,
  );
  return Math.round(speed * 20) / 20; // steps of 0.05, so clips can be reused
}
// Updates the words-a-minute-at-speed-1 estimate from a chunk just spoken.
// Short chunks say little about the pace and are ignored.
export function learnOneWpm(previous, words, voicedMs, speed) {
  if (words < 6 || voicedMs < 1500 || !(speed > 0)) return previous;
  const observed = words / (voicedMs / 60000) / speed;
  return clamp(previous * 0.7 + observed * 0.3, 110, 240);
}

// ---- Word timings ----
// Where the voice is in a clip: the silence before the first sound and after
// the last, in ms. Clips usually have a little of both.
export function voicedSpan(samples, sampleRate, threshold = 0.02) {
  const n = samples?.length || 0;
  if (!n || !sampleRate) return { lead: 0, tail: 0 };
  let first = 0;
  while (first < n && Math.abs(samples[first]) < threshold) first++;
  if (first >= n) return { lead: 0, tail: 0 };
  let last = n - 1;
  while (last > first && Math.abs(samples[last]) < threshold) last--;
  const ms = (i) => (i / sampleRate) * 1000;
  const total = ms(n);
  // A short backoff: speech fades in below the threshold.
  return {
    lead: Math.min(Math.max(0, ms(first) - 20), total * 0.4),
    tail: Math.min(Math.max(0, total - ms(last + 1) - 20), total * 0.4),
  };
}
// How long each word takes to say, in beats (see spoken.js): sounds and
// syllables, with numbers and abbreviations read out as the voice says them.
export function letterWeights(words) {
  return words.map((word) => spokenBeats(word));
}
// Extra time, in phonemes, for the pause the voice makes after a comma or a
// sentence end inside a chunk (about a quarter and half a second).
export const CLAUSE_PAUSE = 3;
export const SENTENCE_PAUSE = 6;
// When each word starts in a clip (ms from the start of the clip): the voiced
// part of the clip is shared out by each word's phoneme count, plus the
// pauses after punctuation. The first word starts at 0 (it is already shown).
export function naturalWordStarts(
  words,
  durationMs,
  weights = null,
  span = {},
) {
  const n = words.length;
  if (!n) return [];
  const fallback = letterWeights(words);
  const w = words.map((word, i) => {
    let x = Number(weights?.[i]);
    x = Number.isFinite(x) && x > 0 ? x : fallback[i];
    x = Math.max(1, x);
    // The pause after the last word is the clip's own trailing silence.
    if (i < n - 1) {
      if (endsSentence(word, words[i + 1])) x += SENTENCE_PAUSE;
      else if (clauseEnd.test(word) || /[—–]$/.test(word)) x += CLAUSE_PAUSE;
    }
    return x;
  });
  const total = w.reduce((a, b) => a + b, 0);
  const lead = Math.max(0, span.lead || 0);
  const voiced = Math.max(1, durationMs - lead - Math.max(0, span.tail || 0));
  const starts = [0];
  let sum = 0;
  for (let i = 1; i < n; i++) {
    sum += w[i - 1];
    starts.push(lead + (voiced * sum) / total);
  }
  return starts;
}

// ---- Lining the words up with the voice ----
// The voice gives no word timings, but its pauses can be heard: it stops at
// most commas and full stops and often between phrases. Each pause found in
// the clip is matched to the word boundary it most likely is, and the words
// between two pauses share out the time between them. So the shown word
// lines up with the voice again at every pause instead of drifting further
// off through a long sentence.
export const FRAME_MS = 10;
// Shorter gaps are usually inside a word (the stop before a "t" or "p").
export const MIN_GAP_MS = 70;
// Silence is quieter than this share of the clip's loud level.
export const QUIET = 0.06;
// Gaps of silence inside the voiced part of a clip, as { from, to } in ms.
export function speechGaps(
  samples,
  sampleRate,
  span = {},
  { minMs = MIN_GAP_MS, quiet: share = QUIET } = {},
) {
  const n = samples?.length || 0;
  if (!n || !sampleRate) return [];
  const size = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const frames = Math.floor(n / size);
  const level = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * size, end = i + size; i < end; i++)
      sum += samples[i] * samples[i];
    level[f] = Math.sqrt(sum / size);
  }
  const durationMs = (n / sampleRate) * 1000;
  const first = Math.ceil((span.lead || 0) / FRAME_MS);
  const last = Math.floor((durationMs - (span.tail || 0)) / FRAME_MS) - 1;
  if (last - first < 4) return [];
  // The loud level: near the top of the voiced frames, ignoring a few peaks.
  const sorted = Array.from(level.subarray(first, last + 1)).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)] || 0;
  if (!loud) return [];
  const quiet = Math.max(loud * share, 0.003);
  const gaps = [];
  let start = -1;
  for (let f = first; f <= last + 1; f++) {
    const silent = f <= last && level[f] < quiet;
    if (silent && start < 0) start = f;
    else if (!silent && start >= 0) {
      if ((f - start) * FRAME_MS >= minMs && start > first)
        gaps.push({ from: start * FRAME_MS, to: f * FRAME_MS });
      start = -1;
    }
  }
  // A gap running into the end is the trailing silence, not a pause.
  return gaps.filter((g) => g.to <= last * FRAME_MS);
}
// Whether the voice is likely to pause after `word`, and how strongly.
const pauseAfter = (word, next) =>
  endsSentence(word, next) ? 2 : clauseEnd.test(word) || /[—–]$/.test(word) ? 1 : 0;
// Matches gaps to word boundaries (dynamic programming, in order): a gap
// near where a boundary is expected, after punctuation, is the best match; a
// long gap left unmatched, or punctuation with no pause, costs a little.
// Returns [{ word, gap }] where `word` starts when `gap` ends.
export function matchGaps(words, expected, gaps, durationMs, span = {}) {
  const n = words.length,
    k = gaps.length;
  if (n < 2 || !k) return [];
  const lead = span.lead || 0,
    end = durationMs - (span.tail || 0);
  const skipGap = (g) =>
    0.8 + 2.4 * clamp((g.to - g.from - MIN_GAP_MS) / 230, 0, 1);
  const skipWord = (b) => [0, 0.35, 0.8][pauseAfter(words[b - 1], words[b])];
  const pair = (b, g) => {
    // The guess gets less sure away from the clip's two ends.
    const sure = 110 + 0.22 * Math.min(expected[b] - lead, end - expected[b]);
    const off = Math.abs(expected[b] - g.to) / sure;
    return off > 3 ? Infinity : off + [0.9, 0, -0.3][pauseAfter(words[b - 1], words[b])];
  };
  // cost[i][b]: first i gaps placed among boundaries before b (1..n-1).
  const INF = Infinity;
  const cost = Array.from({ length: k + 1 }, () => new Float64Array(n + 1).fill(INF));
  const from = Array.from({ length: k + 1 }, () => new Int8Array(n + 1));
  cost[0][1] = 0;
  for (let i = 0; i <= k; i++)
    for (let b = 1; b <= n; b++) {
      const here = cost[i][b];
      if (here === INF) continue;
      if (i < k && here + skipGap(gaps[i]) < cost[i + 1][b]) {
        cost[i + 1][b] = here + skipGap(gaps[i]);
        from[i + 1][b] = 1;
      }
      if (b < n) {
        if (here + skipWord(b) < cost[i][b + 1]) {
          cost[i][b + 1] = here + skipWord(b);
          from[i][b + 1] = 2;
        }
        const c = i < k ? pair(b, gaps[i]) : INF;
        if (c !== INF && here + c < cost[i + 1][b + 1]) {
          cost[i + 1][b + 1] = here + c;
          from[i + 1][b + 1] = 3;
        }
      }
    }
  const matches = [];
  for (let i = k, b = n; i > 0 || b > 1; ) {
    const step = from[i][b];
    if (step === 1) i--;
    else if (step === 2) b--;
    else if (step === 3) {
      matches.push({ word: b - 1, gap: gaps[i - 1] });
      i--;
      b--;
    } else break;
  }
  return matches.reverse();
}
// When each word starts in a clip (ms from its start), lined up with the
// pauses heard in it. Also returns the matches, which teach the pace.
export function alignedWordStarts(words, durationMs, weights = null, span = {}, gaps = []) {
  const n = words.length;
  const expected = naturalWordStarts(words, durationMs, weights, span);
  if (n < 2) return { starts: expected, matches: [], stretches: [] };
  const matches = matchGaps(words, expected, gaps, durationMs, span);
  if (!matches.length)
    return {
      starts: expected,
      matches,
      stretches: [[0, n, span.lead || 0, durationMs - (span.tail || 0)]],
    };
  const w = weights?.length === n ? weights : letterWeights(words);
  const starts = new Array(n);
  // Stretches of speech between pauses: words a..b-1 from `at` to `until`.
  const lead = Math.max(0, span.lead || 0);
  const stretches = [];
  let a = 0,
    at = lead;
  for (const { word, gap } of matches) {
    stretches.push([a, word, at, gap.from]);
    a = word;
    at = gap.to;
  }
  stretches.push([a, n, at, durationMs - Math.max(0, span.tail || 0)]);
  for (const [s, e, t0, t1] of stretches) {
    const part = naturalWordStarts(words.slice(s, e), Math.max(1, t1 - t0), w.slice(s, e));
    part.forEach((t, i) => (starts[s + i] = t0 + t));
  }
  starts[0] = 0; // the first word is already shown
  return { starts, matches, stretches };
}

// ---- Playback ----
// Natural voice chunks are shorter than the device voice's: a short first
// chunk starts sooner, and each one is a single small request.
export const NATURAL_CHUNK_WORDS = 40;
// Starting cold (play, a jump, a new pace), the first chunk is cut at the
// first sentence or clause end within this many words, so the voice starts
// about twice as soon; it is never cut mid-phrase.
export const FIRST_CHUNK_WORDS = 16;
export const FIRST_CHUNK_MIN_WORDS = 4;
// How many chunks are fetched ahead of the one being read, so a short
// sentence never leaves the voice waiting on the next.
export const FETCH_AHEAD = 2;
// Clips come with silence before and after the voice. Most of it is cut, so
// sentences follow each other like speech: a short breath before the voice,
// and a pause after it about the length of a spoken full stop.
export const KEEP_LEAD_MS = 30;
export const KEEP_TAIL_MS = 220;
// The end of a short opening chunk: the first sentence end, or clause end of
// at least FIRST_CHUNK_MIN_WORDS, within FIRST_CHUNK_WORDS; -1 when there is
// none (the normal chunk is used).
export function firstChunkEnd(tokens, start) {
  const limit = Math.min(tokens.length - 1, start + FIRST_CHUNK_WORDS - 1);
  for (let i = start; i <= limit; i++) {
    const t = tokens[i];
    if (t.paragraphEnd || isSentenceEnd(t)) return i;
    if (
      i - start + 1 >= FIRST_CHUNK_MIN_WORDS &&
      (clauseEnd.test(t.text) || /[—–]$/.test(t.text))
    )
      return i;
  }
  return -1;
}
// The part of a clip to play (ms), with most of its silence cut.
export function playedSpan(durationMs, span) {
  const from = Math.max(0, (span.lead || 0) - KEEP_LEAD_MS);
  const to = Math.max(
    from,
    durationMs - Math.max(0, (span.tail || 0) - KEEP_TAIL_MS),
  );
  return { from, to };
}
// How long a chunk may take to arrive while the reader waits, before giving
// up on the natural voice (a little longer the first time).
export const WAIT_LIMIT_MS = 12000;
export const FIRST_WAIT_LIMIT_MS = 20000;
// Extra time after a clip should have ended before deciding the sound is stuck.
export const END_GRACE_MS = 3000;
// Each word is shown this much before the voice reaches it: reading a word
// just ahead of hearing it feels in step, hearing it first feels late.
export const SHOW_EARLY_MS = 40;
// Learned pace per voice, shared by every NaturalPlayback in this page.
const learnedWpm = new Map();

export class NaturalPlayback {
  constructor({
    length,
    tokens,
    onWord,
    onEnd,
    breakAfter = null,
    onBreak = null,
    // Words a minute wanted at token `i`; sets the voice's speed.
    wpm = () => NATURAL_ONE_WPM,
    // The voice's id (see NATURAL_VOICES), or a function returning it.
    voice = NATURAL_VOICES[0].id,
    // { synthesize({ text, words, voice, speed }, { urgent }) → Promise of
    //   { samples, sampleRate, weights }, ready (bool), drop?() }
    synth,
    // { unlock?(), play(clip, onEnded) → { startedAt, stop() }, now() }
    audio,
    // Called with a reason ("slow", "failed", "offline", "unavailable",
    // "busy") when the natural voice can't carry on; playback is paused by then.
    onFail = null,
    // Called with { words, speed, stretches, matches } for each clip played:
    // how long its stretches of speech and its pauses took (see spoken.js).
    onTiming = null,
    rates = learnedWpm,
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
  }) {
    Object.assign(this, {
      length,
      tokens,
      onWord,
      onEnd,
      breakAfter,
      onBreak,
      wpm,
      voice,
      synth,
      audio,
      onFail,
      onTiming,
      rates,
      schedule,
      cancel,
    });
    this.index = 0;
    this.playing = false;
    this.finished = false;
    this.timer = null;
    this.watchdog = null;
    this.run = 0; // bumped on every pause or restart; stale events are ignored
    this.sound = null; // the clip playing now
    this.clips = new Map(); // chunk start → { end, speed, promise }
    this.speed = null;
  }
  get voiceId() {
    return (typeof this.voice === "function" ? this.voice() : this.voice) || "";
  }
  get oneWpm() {
    return this.rates.get(this.voiceId) || NATURAL_ONE_WPM;
  }
  play() {
    if (this.playing || !this.length) return;
    if (this.finished) {
      this.index = 0;
      this.finished = false;
    }
    this.playing = true;
    // Browsers only let sound start from a tap or key press: get the audio
    // output going now, before waiting for the voice.
    try {
      this.audio.unlock?.();
    } catch {}
    this.onWord(this.index);
    this.speakFrom(this.index);
  }
  pause() {
    this.playing = false;
    this.run++;
    this.clearTimers();
    this.stopSound();
  }
  seek(index) {
    this.pause();
    this.index = clamp(index, 0, Math.max(0, this.length - 1));
    this.finished = false;
    this.onWord(this.index);
  }
  // The pace changed: if the voice's speed changes, speak again from the
  // current word at the new speed.
  retime() {
    if (!this.playing) return;
    const speed = speedForWpm(this.wpm(this.index), this.oneWpm);
    if (speed === this.speed) return;
    const index = this.index;
    this.pause();
    this.clips.clear();
    this.playing = true;
    this.index = index;
    this.speakFrom(index);
  }
  clearTimers() {
    if (this.timer !== null) this.cancel(this.timer);
    if (this.watchdog !== null) this.cancel(this.watchdog);
    this.timer = this.watchdog = null;
  }
  stopSound() {
    const sound = this.sound;
    this.sound = null;
    try {
      sound?.stop();
    } catch {}
  }
  chunkAt(start, cold = false) {
    const short = cold ? firstChunkEnd(this.tokens, start) : -1;
    const end =
      short >= 0 ? short : chunkEnd(this.tokens, start, NATURAL_CHUNK_WORDS);
    const words = this.tokens.slice(start, end + 1).map((t) => t.text);
    const wanted = this.wpm(start);
    return {
      start,
      end,
      words,
      wanted,
      speed: speedForWpm(wanted, this.oneWpm),
      started: null,
    };
  }
  // The clip for a chunk: one already asked for (the next sentence, fetched
  // ahead) if it covers the same words at about the same speed, else a new one.
  clip(chunk, urgent) {
    const have = this.clips.get(chunk.start);
    if (
      have &&
      have.end === chunk.end &&
      have.voice === this.voiceId &&
      Math.abs(have.speed - chunk.speed) < 0.11
    ) {
      chunk.speed = have.speed;
      return have.promise;
    }
    const promise = this.synth.synthesize(
      {
        text: utteranceText(chunk.words).text,
        words: chunk.words,
        voice: this.voiceId,
        speed: chunk.speed,
      },
      { urgent },
    );
    const entry = {
      end: chunk.end,
      speed: chunk.speed,
      voice: this.voiceId,
      promise,
    };
    this.clips.set(chunk.start, entry);
    // Forget clips that failed (or were dropped), and keep only a few.
    promise.catch(() => {
      if (this.clips.get(chunk.start) === entry) this.clips.delete(chunk.start);
    });
    while (this.clips.size > FETCH_AHEAD + 3)
      this.clips.delete(this.clips.keys().next().value);
    return promise;
  }
  // Asks for the chunks after `chunk` ahead of time.
  fetchAhead(chunk) {
    for (let n = 0; n < FETCH_AHEAD && chunk.end + 1 < this.length; n++) {
      chunk = this.chunkAt(chunk.end + 1);
      this.clip(chunk, false).catch(() => {});
    }
  }
  speakFrom(start) {
    const run = ++this.run;
    this.clearTimers();
    // Nothing made ahead for this word: start with a short chunk.
    const chunk = this.chunkAt(start, !this.clips.has(start));
    this.speed = chunk.speed;
    const pending = this.clip(chunk, true);
    this.fetchAhead(chunk);
    // Don't leave the reader waiting on a voice that can't keep up.
    this.watchdog = this.schedule(
      () => {
        this.watchdog = null;
        if (run === this.run && this.playing) this.fail(run, "slow");
      },
      this.synth.ready ? WAIT_LIMIT_MS : FIRST_WAIT_LIMIT_MS,
    );
    pending.then(
      (clip) => {
        if (run !== this.run || !this.playing) return;
        this.start(run, chunk, clip);
      },
      (error) => {
        if (run !== this.run || !this.playing) return;
        if (error?.code === "dropped") return this.speakFrom(this.index);
        this.fail(run, error?.code || "failed");
      },
    );
  }
  start(run, chunk, clip) {
    this.clearTimers();
    const duration = (clip.samples.length / clip.sampleRate) * 1000;
    const span = voicedSpan(clip.samples, clip.sampleRate);
    const gaps = speechGaps(clip.samples, clip.sampleRate, span);
    const { starts, stretches, matches } = alignedWordStarts(
      chunk.words,
      duration,
      clip.weights,
      span,
      gaps,
    );
    try {
      this.onTiming?.({
        words: chunk.words,
        speed: chunk.speed,
        stretches,
        matches,
      });
    } catch {}
    const voiced = duration - span.lead - span.tail;
    this.rates.set(
      this.voiceId,
      learnOneWpm(this.oneWpm, chunk.words.length, voiced, chunk.speed),
    );
    const { from, to } = playedSpan(duration, span);
    let sound;
    try {
      sound = this.audio.play(
        clip,
        () => {
          if (run !== this.run || this.sound !== sound) return;
          this.sound = null;
          this.finishChunk(run, chunk);
        },
        { from, to },
      );
    } catch {
      return this.fail(run, "failed");
    }
    this.sound = sound;
    // Word times count from the clip's start, before the silence cut.
    chunk.started = (sound.startedAt ?? this.audio.now()) - from;
    // If the sound never ends (audio blocked or stuck), stop waiting for it.
    this.watchdog = this.schedule(() => {
      this.watchdog = null;
      if (run === this.run && this.sound === sound) this.fail(run, "failed");
    }, to - from + END_GRACE_MS);
    // Keep the next sentences coming while this one plays.
    this.fetchAhead(chunk);
    // Line the words up with the clip. The word shown may be past the
    // chunk's start (resuming mid-sentence re-speaks from it, so it is).
    const tick = () => {
      this.timer = null;
      if (run !== this.run || !this.playing) return;
      const elapsed = this.audio.now() - chunk.started + SHOW_EARLY_MS;
      let k = 0;
      // Within 1 ms counts as due, so rounding can never stall the words.
      while (k < starts.length - 1 && starts[k + 1] <= elapsed + 1) k++;
      if (!this.advanceTo(chunk.start + k, chunk.end)) return;
      if (k < starts.length - 1)
        this.timer = this.schedule(tick, Math.max(1, starts[k + 1] - elapsed));
    };
    tick();
  }
  // Shows each word up to `target`, asking breakAfter about each one passed,
  // as engine.Playback does. Returns false if playback stopped.
  advanceTo(target, end) {
    target = Math.min(target, end);
    while (this.playing && this.index < target) {
      if (this.breakAfter?.(this.index)) {
        this.pause();
        this.onBreak?.(this.index);
        return false;
      }
      this.index++;
      this.onWord(this.index);
    }
    return this.playing;
  }
  finishChunk(run, chunk) {
    this.clearTimers();
    if (!this.advanceTo(chunk.end, chunk.end) || run !== this.run) return;
    if (this.index >= this.length - 1) {
      this.pause();
      this.finished = true;
      this.onEnd();
      return;
    }
    if (this.breakAfter?.(this.index)) {
      this.pause();
      this.onBreak?.(this.index);
      return;
    }
    // At paces slower than the voice goes, the sentence's last word stays
    // until the pace's time for the sentence is up.
    const wait =
      chunk.speed <= MIN_SPEED && chunk.wanted < MIN_SPEED * this.oneWpm
        ? chunk.started +
          estimateWordTimes(chunk.words, chunk.wanted).reduce(
            (sum, t) => sum + t,
            0,
          ) -
          this.audio.now()
        : 0;
    if (wait > 0)
      this.timer = this.schedule(() => {
        this.timer = null;
        if (run === this.run && this.playing) this.next(run);
      }, wait);
    else this.next(run);
  }
  next(run) {
    this.index++;
    this.onWord(this.index);
    if (this.playing && run === this.run) this.speakFrom(this.index);
  }
  fail(run, reason) {
    if (run !== this.run) return;
    this.pause();
    this.clips.clear();
    this.onFail?.(reason);
  }
}

// ---- Browser parts ----
// Plays clips with Web Audio. Times are the audio clock's, in ms, so words
// stay in step with the sound even if the page is busy.
export class WebAudioOutput {
  constructor(scope = globalThis) {
    this.scope = scope;
    this.context = null;
  }
  get audioContext() {
    if (!this.context) {
      const AudioContext =
        this.scope.AudioContext || this.scope.webkitAudioContext;
      this.context = new AudioContext();
      // iPhone: play even with the ring switch on silent, like a podcast.
      try {
        if (this.scope.navigator?.audioSession)
          this.scope.navigator.audioSession.type = "playback";
      } catch {}
    }
    return this.context;
  }
  unlock() {
    const context = this.audioContext;
    if (context.state !== "running") context.resume?.().catch?.(() => {});
    return context;
  }
  // Turns an encoded clip (MP3 from the server) into samples.
  async decode(bytes) {
    const audio = await this.audioContext.decodeAudioData(bytes);
    return { samples: audio.getChannelData(0), sampleRate: audio.sampleRate };
  }
  // The audio clock where it is being heard, in ms. Phones, and Bluetooth
  // headphones most of all, play sound a little (up to a third of a second)
  // after the page makes it; words follow what is heard, not what is made.
  now() {
    const context = this.context;
    if (!context) return performance.now();
    const made = context.currentTime * 1000;
    try {
      const stamp = context.getOutputTimestamp?.();
      if (stamp?.contextTime > 0 && stamp.performanceTime > 0) {
        const heard =
          stamp.contextTime * 1000 + (performance.now() - stamp.performanceTime);
        if (heard <= made && made - heard < 1000) return heard;
      }
    } catch {}
    const latency = Number(context.outputLatency || context.baseLatency) || 0;
    return made - Math.min(1000, Math.max(0, latency * 1000));
  }
  // Plays the clip from `from` to `to` (ms); startedAt is when `from` sounds.
  play({ samples, sampleRate }, onEnded, { from = 0, to = null } = {}) {
    const context = this.unlock();
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    let stopped = false;
    source.onended = () => {
      if (!stopped) onEnded();
    };
    const at = context.currentTime + 0.02;
    const total = (samples.length / sampleRate) * 1000;
    const end = Math.min(total, to ?? total);
    source.start(at, from / 1000, Math.max(0, end - from) / 1000);
    return {
      startedAt: at * 1000,
      stop() {
        stopped = true;
        try {
          source.stop();
        } catch {}
        source.disconnect();
      },
    };
  }
}

// Gets clips from the server. Each request is one chunk; several may be in
// flight (the one being read and the next).
export class CloudVoiceEngine {
  constructor({
    endpoint = SPEAK_ENDPOINT,
    fetch: fetcher = (...args) => globalThis.fetch(...args),
    // (ArrayBuffer) → Promise of { samples, sampleRate }
    decode,
  } = {}) {
    Object.assign(this, { endpoint, fetcher, decode });
    this.ready = true;
  }
  async synthesize({ text, voice, speed }) {
    let response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: String(text).slice(0, MAX_SPEAK_CHARS),
          voice,
          speed,
        }),
      });
    } catch {
      throw { code: "offline" };
    }
    if (!response.ok)
      throw {
        code:
          response.status === 503 || response.status === 404
            ? "unavailable"
            : response.status === 429
              ? "busy"
              : "failed",
      };
    try {
      return await this.decode(await response.arrayBuffer());
    } catch {
      throw { code: "failed" };
    }
  }
}
