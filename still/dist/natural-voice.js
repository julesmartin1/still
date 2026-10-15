// Natural voice: an optional, more human-sounding voice for read aloud. It
// is Kokoro-82M (Apache-2.0), a small speech model that runs on the device
// in a Web Worker (natural-voice-worker.js) with the runtime vendored in
// vendor/kokoro/. The model's weights (about 92 MB) are downloaded once from
// Hugging Face, the first time a reader chooses a natural voice, and kept with
// the Cache API, so it works offline after. Only those files are downloaded:
// the text being read is turned into speech on the device and never sent
// anywhere.
//
// NaturalPlayback has the same shape as engine.Playback and
// read-aloud.SpokenPlayback (index, playing, finished, play, pause, seek,
// retime, breakAfter/onBreak, onWord, onEnd), so the app swaps it in the same
// way. It speaks one sentence (chunk) at a time, keeps the next one ready
// while the current one plays, and moves the shown word by an estimate of
// when each word is said, since the model gives no word timings.
import { clamp, sentenceEnd, clauseEnd } from "./engine.js";
import { chunkEnd, utteranceText, estimateWordTimes } from "./read-aloud.js";

export const NATURAL_PREFIX = "natural:";
// The best-graded English voices that come with Kokoro (see kokoro-js's
// voice list: Heart A, Bella A-, Emma B-, Michael C+, the best male voice).
// The files are vendored in vendor/kokoro/voices/.
export const NATURAL_VOICES = [
  { id: "af_heart", name: "Heart", accent: "American English" },
  { id: "af_bella", name: "Bella", accent: "American English" },
  { id: "bf_emma", name: "Emma", accent: "British English" },
  { id: "am_michael", name: "Michael", accent: "American English" },
];
// The value stored in appearance.readAloudVoice for a natural voice, and
// back. Returns "" for anything that isn't one of NATURAL_VOICES.
export const naturalVoiceValue = (id) => NATURAL_PREFIX + id;
export function naturalVoiceId(value) {
  const id = String(value || "").startsWith(NATURAL_PREFIX)
    ? String(value).slice(NATURAL_PREFIX.length)
    : "";
  return NATURAL_VOICES.some((v) => v.id === id) ? id : "";
}
// The natural voice reads English only; "" (unsure) counts as English.
export const naturalReadsLanguage = (lang) => !lang || lang === "en";

// Where the weights come from. The 8-bit quantized model ("q8",
// onnx/model_quantized.onnx, 92.4 MB) is the one kokoro-js recommends for
// the WebAssembly runtime; the q8f16 file is smaller but needs half-float
// arithmetic, which the WebAssembly runtime does slowly or not at all.
export const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const MODEL_DTYPE = "q8";
export const MODEL_FILE = "onnx/model_quantized.onnx";
export const MODEL_BYTES = 92361116;
export const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/${MODEL_FILE}`;
export const NATURAL_CACHE = "still-natural-voice-v1";

// Everything the natural voice needs from the browser. iOS web views without
// the Cache API would download the model on every launch, so they don't get
// the option.
export function naturalSupported(scope = globalThis) {
  try {
    return (
      typeof scope.WebAssembly?.instantiate === "function" &&
      typeof scope.Worker === "function" &&
      !!(scope.AudioContext || scope.webkitAudioContext) &&
      typeof scope.caches?.open === "function"
    );
  } catch {
    return false;
  }
}
// True once the model is saved on this device.
export async function naturalDownloaded(scope = globalThis) {
  try {
    const cache = await scope.caches.open(NATURAL_CACHE);
    return !!(await cache.match(MODEL_URL));
  } catch {
    return false;
  }
}

// ---- Pace ----
// Kokoro speaks about 160 words a minute at speed 1 (learned per voice as it
// reads). Its speed option sounds natural from about 0.6 to 1.5.
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
// the last, in ms. Kokoro leaves a little of both.
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
// Natural voice chunks are shorter than the device voice's: the model takes
// at most about 500 sounds at once, and a short first chunk starts sooner.
export const NATURAL_CHUNK_WORDS = 40;
// How long a chunk may take to be ready while the reader waits, before giving
// up on the natural voice (longer the first time, while the model loads).
export const WAIT_LIMIT_MS = 15000;
export const FIRST_WAIT_LIMIT_MS = 120000;
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
    // The Kokoro voice id, or a function returning it.
    voice = NATURAL_VOICES[0].id,
    // { synthesize({ text, words, voice, speed }, { urgent }) → Promise of
    //   { samples, sampleRate, weights }, ready (bool), drop?() }
    synth,
    // { unlock?(), play(clip, onEnded) → { startedAt, stop() }, now() }
    audio,
    // Called with a reason ("slow", "failed", "missing", "unsupported") when
    // the natural voice can't carry on; playback is paused by then.
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
  unlock() {
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
    if (this.context.state !== "running")
      this.context.resume?.().catch?.(() => {});
    return this.context;
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

// Talks to natural-voice-worker.js: loads the model (downloading it once if
// asked) and turns chunks into clips, one at a time, the reader's current
// chunk first.
export class NaturalVoiceEngine {
  constructor({
    createWorker = () =>
      new Worker(new URL("./natural-voice-worker.js", import.meta.url), {
        type: "module",
      }),
  } = {}) {
    this.createWorker = createWorker;
    this.worker = null;
    this.state = "idle"; // idle, loading, ready, failed
    this.loading = null;
    this.progress = null; // listener for download progress
    this.queue = [];
    this.busy = null;
    this.ids = 0;
    this.loads = 0;
  }
  get ready() {
    return this.state === "ready";
  }
  start() {
    if (this.worker) return this.worker;
    this.worker = this.createWorker();
    this.worker.onmessage = (event) => this.receive(event.data || {});
    this.worker.onerror = (event) => {
      event?.preventDefault?.();
      this.crash({ code: "unsupported" });
    };
    return this.worker;
  }
  // Loads the voice. With `download`, fetches the model if it isn't saved
  // yet; without, fails with code "missing" instead of downloading.
  load({ download = false, onProgress = null } = {}) {
    if (onProgress) this.progress = onProgress;
    if (this.state === "ready") return Promise.resolve();
    if (this.loading && (!download || this.loading.download))
      return this.loading.promise;
    const loading = { id: ++this.loads, download };
    loading.promise = new Promise((resolve, reject) => {
      loading.resolve = resolve;
      loading.reject = reject;
    });
    // Anyone waiting on an earlier load (without download) waits on this one.
    const earlier = this.loading;
    if (earlier) loading.promise.then(earlier.resolve, earlier.reject);
    this.loading = loading;
    this.state = "loading";
    try {
      this.start().postMessage({ type: "load", id: loading.id, download });
    } catch {
      this.crash({ code: "unsupported" });
    }
    return loading.promise;
  }
  synthesize(request, { urgent = false } = {}) {
    return new Promise((resolve, reject) => {
      const job = { id: ++this.ids, request, resolve, reject };
      if (urgent) {
        this.drop();
        this.queue.unshift(job);
      } else this.queue.push(job);
      this.load().then(
        () => this.pump(),
        (error) => {
          this.queue = this.queue.filter((j) => j !== job);
          reject(error);
        },
      );
    });
  }
  // Forgets chunks asked for but not started (the reader moved on).
  drop() {
    for (const job of this.queue.splice(0)) job.reject({ code: "dropped" });
  }
  pump() {
    if (this.busy || this.state !== "ready" || !this.queue.length) return;
    this.busy = this.queue.shift();
    this.worker.postMessage({
      type: "speak",
      id: this.busy.id,
      ...this.busy.request,
    });
  }
  receive(message) {
    if (message.type === "progress") this.progress?.(message);
    else if (message.type === "ready") {
      if (message.id !== this.loading?.id && this.state === "ready") return;
      this.state = "ready";
      const loading = this.loading;
      this.loading = null;
      loading?.resolve();
      this.progress?.({ done: true });
      this.pump();
    } else if (message.type === "load-error") {
      if (message.id !== this.loading?.id) return; // an earlier, replaced load
      const loading = this.loading;
      this.loading = null;
      this.state = "idle";
      loading?.reject({ code: message.code || "failed" });
      if (message.code !== "missing") this.crash({ code: message.code });
    } else if (message.type === "audio" || message.type === "speak-error") {
      const job = this.busy;
      if (!job || job.id !== message.id) return;
      this.busy = null;
      if (message.type === "audio")
        job.resolve({
          samples: message.samples,
          sampleRate: message.sampleRate,
          weights: message.weights,
        });
      else job.reject({ code: "failed" });
      this.pump();
    }
  }
  // The worker can't run the voice here: fail everything waiting on it.
  crash(error) {
    this.state = "failed";
    const loading = this.loading;
    this.loading = null;
    loading?.reject(error);
    this.busy?.reject(error);
    this.busy = null;
    for (const job of this.queue.splice(0)) job.reject(error);
    try {
      this.worker?.terminate();
    } catch {}
    this.worker = null;
  }
}
