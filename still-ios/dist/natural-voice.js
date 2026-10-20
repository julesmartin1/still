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
import { clamp, sentenceEnd, clauseEnd } from "./engine.js";
import { chunkEnd, utteranceText, estimateWordTimes } from "./read-aloud.js";

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
export const SPEAK_ENDPOINT = "/api/speak";

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
// When the phoneme counts aren't known: letters stand in for sounds.
export function letterWeights(words) {
  return words.map((word) =>
    Math.max(1, 0.85 * (word.match(/[\p{L}\p{N}]/gu) || []).length),
  );
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
      if (sentenceEnd.test(word)) x += SENTENCE_PAUSE;
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

// ---- Playback ----
// Natural voice chunks are shorter than the device voice's: a short first
// chunk starts sooner, and each one is a single small request.
export const NATURAL_CHUNK_WORDS = 40;
// How long a chunk may take to arrive while the reader waits, before giving
// up on the natural voice (a little longer the first time).
export const WAIT_LIMIT_MS = 12000;
export const FIRST_WAIT_LIMIT_MS = 20000;
// Extra time after a clip should have ended before deciding the sound is stuck.
export const END_GRACE_MS = 3000;
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
  chunkAt(start) {
    const end = chunkEnd(this.tokens, start, NATURAL_CHUNK_WORDS);
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
    while (this.clips.size > 4)
      this.clips.delete(this.clips.keys().next().value);
    return promise;
  }
  speakFrom(start) {
    const run = ++this.run;
    this.clearTimers();
    const chunk = this.chunkAt(start);
    this.speed = chunk.speed;
    const pending = this.clip(chunk, true);
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
    const starts = naturalWordStarts(chunk.words, duration, clip.weights, span);
    const voiced = duration - span.lead - span.tail;
    this.rates.set(
      this.voiceId,
      learnOneWpm(this.oneWpm, chunk.words.length, voiced, chunk.speed),
    );
    let sound;
    try {
      sound = this.audio.play(clip, () => {
        if (run !== this.run || this.sound !== sound) return;
        this.sound = null;
        this.finishChunk(run, chunk);
      });
    } catch {
      return this.fail(run, "failed");
    }
    this.sound = sound;
    chunk.started = sound.startedAt ?? this.audio.now();
    // If the sound never ends (audio blocked or stuck), stop waiting for it.
    this.watchdog = this.schedule(() => {
      this.watchdog = null;
      if (run === this.run && this.sound === sound) this.fail(run, "failed");
    }, duration + END_GRACE_MS);
    // Fetch the next sentence while this one plays.
    if (chunk.end + 1 < this.length)
      this.clip(this.chunkAt(chunk.end + 1), false).catch(() => {});
    // Line the words up with the clip. The word shown may be past the
    // chunk's start (resuming mid-sentence re-speaks from it, so it is).
    const tick = () => {
      this.timer = null;
      if (run !== this.run || !this.playing) return;
      const elapsed = this.audio.now() - chunk.started;
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
  now() {
    return this.context ? this.context.currentTime * 1000 : performance.now();
  }
  play({ samples, sampleRate }, onEnded) {
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
    source.start(at);
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
