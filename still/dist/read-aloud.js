// Read aloud: speaks the reading with the device's own voice while the word
// on screen follows the voice. Hearing each word as you see it helps readers
// who find reading hard, dyslexic readers among them.
//
// Everything stays on the device: speech uses the browser's built-in
// speechSynthesis, only voices that run locally are chosen, and nothing is
// fetched or sent anywhere.
//
// SpokenPlayback has the same shape as engine.Playback (index, playing,
// finished, play, pause, seek, retime, breakAfter/onBreak, onWord, onEnd), so
// the app swaps one for the other and keeps its own handling of check-ins,
// "Pause after each sentence" and the end of a reading.
import { clamp, sentenceEnd, clauseEnd, cleanWord } from "./engine.js";

// Most voices speak about 180 words a minute at rate 1. Browsers accept
// rates from 0.1 to 10, but voices sound broken outside 0.5–2.
export const RATE_ONE_WPM = 180;
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const wpmToRate = (wpm) =>
  clamp((Number(wpm) || RATE_ONE_WPM) / RATE_ONE_WPM, MIN_RATE, MAX_RATE);
export const rateToWpm = (rate) => rate * RATE_ONE_WPM;

export function speechSupported(scope = globalThis) {
  try {
    return (
      !!scope.speechSynthesis &&
      typeof scope.speechSynthesis.speak === "function" &&
      typeof scope.SpeechSynthesisUtterance === "function"
    );
  } catch {
    return false;
  }
}

// One utterance per sentence. A very long sentence is split at the last
// clause end (a comma, semicolon or colon) after at least MIN_SPLIT_WORDS
// words, or after MAX_CHUNK_WORDS words if it has none. Returns the index of
// the chunk's last token.
export const MAX_CHUNK_WORDS = 60;
export const MIN_SPLIT_WORDS = 20;
export function chunkEnd(tokens, start, max = MAX_CHUNK_WORDS) {
  const last = tokens.length - 1;
  const limit = Math.min(last, start + max - 1);
  let clause = -1;
  for (let i = start; i <= limit; i++) {
    const t = tokens[i];
    if (t.paragraphEnd || sentenceEnd.test(t.text)) return i;
    if (i - start + 1 >= MIN_SPLIT_WORDS && clauseEnd.test(t.text)) clause = i;
  }
  if (limit === last) return last;
  return clause >= 0 ? clause : limit;
}

// Scripts written without spaces (see engine.sourceWords): their words are
// joined back together so the voice reads them as written.
const noSpaceScript =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

// The text to speak, and where each word starts in it (the char-offset map
// that turns a boundary event's charIndex back into a word).
export function utteranceText(words) {
  let text = "";
  const offsets = [];
  words.forEach((word, i) => {
    if (i && !(noSpaceScript.test(words[i - 1]) && noSpaceScript.test(word)))
      text += " ";
    offsets.push(text.length);
    text += word;
  });
  return { text, offsets };
}

// The word that contains `charIndex`: the last word starting at or before it.
export function wordAtChar(offsets, charIndex) {
  let low = 0,
    high = offsets.length - 1,
    found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] <= charIndex) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

// For voices that never report word boundaries: how long each word should
// stay on screen, in ms, at `wpm` words a minute. Longer words and words
// before a pause get more time; the average stays at the pace.
export function estimateWordTimes(words, wpm) {
  if (!words.length) return [];
  const perWord = 60000 / Math.max(1, wpm);
  const weights = words.map((word) => {
    const letters = (word.match(/[\p{L}\p{N}]/gu) || []).length;
    let weight = clamp(0.55 + 0.09 * letters, 0.6, 2);
    if (sentenceEnd.test(word)) weight += 0.4;
    else if (clauseEnd.test(word)) weight += 0.2;
    return weight;
  });
  const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;
  return weights.map((w) => (perWord * w) / mean);
}

// A light guess at the reading's language from its words or script, so a
// French book is read by a French voice. Returns a language code such as
// "fr", or "" when unsure.
const COMMON = {
  en: "the and of to is that it was for with his her you he she they this not but",
  fr: "le les et est une qui dans pour pas du au il elle nous vous ce sur avec mais je",
  es: "el los las y una por con para del se lo como más pero su al muy yo está",
  it: "il che di è gli della per non sono nel anche ma più questo ho io lei",
  de: "der die das und ist nicht ein eine zu mit den sich von auf ich dem sie",
  pt: "os não uma com do da em um é mais mas foi ao dos das isso ele",
  nl: "het een van dat niet op zijn met voor ik je maar ook deze er",
};
const COMMON_SETS = Object.entries(COMMON).map(([lang, words]) => [
  lang,
  new Set(words.split(" ")),
]);
const SCRIPTS = [
  ["ja", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["ko", /\p{Script=Hangul}/u],
  ["zh", /\p{Script=Han}/u],
  ["th", /\p{Script=Thai}/u],
  ["ru", /\p{Script=Cyrillic}/u],
  ["ar", /\p{Script=Arabic}/u],
  ["he", /\p{Script=Hebrew}/u],
  ["el", /\p{Script=Greek}/u],
  ["hi", /\p{Script=Devanagari}/u],
];
export function guessLanguage(tokens, sample = 2000) {
  const words = tokens.slice(0, sample).map((t) => t.text ?? t);
  if (!words.length) return "";
  const joined = words.join(" ");
  // Japanese is written with Han characters too: kana decide it first.
  for (const [lang, script] of SCRIPTS) {
    const letters = joined.match(new RegExp(script.source, "gu"))?.length || 0;
    if (letters >= Math.max(3, joined.replace(/\s/g, "").length * 0.15))
      return lang;
  }
  const scores = COMMON_SETS.map(([lang, set]) => [
    lang,
    words.reduce((n, w) => n + (set.has(cleanWord(w)) ? 1 : 0), 0),
  ]).sort((a, b) => b[1] - a[1]);
  const [[top, best], [, second]] = scores;
  return best >= Math.max(2, words.length * 0.08) && best >= second * 1.5
    ? top
    : "";
}

const primary = (lang) =>
  String(lang || "")
    .toLowerCase()
    .split(/[-_]/)[0];

// Chooses an on-device voice: one in the reading's language when it is
// known, else the device's default voice. Voices that run on a server
// (localService false) are never chosen. Returns null when no voice on the
// list runs on the device.
export function pickVoice(voices, lang = "", uiLanguage = "") {
  const local = (voices || []).filter((v) => v && v.localService === true);
  if (!local.length) return null;
  const inLanguage = (want) => {
    const matches = local.filter((v) => primary(v.lang) === primary(want));
    return (
      matches.find((v) => v.default) ||
      matches.find(
        (v) =>
          String(v.lang).toLowerCase() === String(uiLanguage).toLowerCase(),
      ) ||
      matches[0] ||
      null
    );
  };
  if (lang) {
    const match = inLanguage(lang);
    if (match) return match;
  }
  const fallback = (voices || []).find((v) => v?.default);
  return (
    local.find((v) => v.default) ||
    (fallback && inLanguage(fallback.lang)) ||
    (uiLanguage && inLanguage(uiLanguage)) ||
    local[0]
  );
}

// Waits this long for the voice to start before carrying on without it.
export const START_TIMEOUT_MS = 2500;
// After the voice starts, waits this long (plus the first word) for a word
// boundary before moving words on a timer instead.
export const BOUNDARY_GRACE_MS = 450;

export class SpokenPlayback {
  constructor({
    length,
    tokens,
    onWord,
    onEnd,
    breakAfter = null,
    onBreak = null,
    // Words a minute wanted at token `i`; sets the voice's rate.
    wpm = () => RATE_ONE_WPM,
    // The reading's language code, or a function returning it (asked once).
    lang = "",
    // Called with "no-voice" or "failed" when words carry on without a voice.
    onSilent = null,
    synth = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance,
    uiLanguage = globalThis.navigator?.language || "",
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    clock = () => performance.now(),
  }) {
    Object.assign(this, {
      length,
      tokens,
      onWord,
      onEnd,
      breakAfter,
      onBreak,
      wpm,
      lang,
      onSilent,
      synth,
      Utterance,
      uiLanguage,
      schedule,
      cancel,
      clock,
    });
    this.index = 0;
    this.playing = false;
    this.finished = false;
    this.timer = null;
    this.run = 0; // bumped on every pause or restart; stale events are ignored
    this.utterance = null;
    this.boundaries = null; // learned: does this voice report word boundaries?
    this.silent = false; // carrying on without a voice until the next play
    this.language = undefined;
  }
  play() {
    if (this.playing || !this.length) return;
    if (this.finished) {
      this.index = 0;
      this.finished = false;
    }
    this.playing = true;
    this.silent = false;
    this.onWord(this.index);
    this.speakFrom(this.index);
  }
  pause() {
    this.playing = false;
    this.run++;
    this.clearTimer();
    if (this.utterance) {
      this.utterance = null;
      try {
        this.synth.cancel();
      } catch {}
    }
  }
  seek(index) {
    this.pause();
    this.index = clamp(index, 0, Math.max(0, this.length - 1));
    this.finished = false;
    this.onWord(this.index);
  }
  // The pace changed: speak again from the current word at the new rate.
  retime() {
    if (!this.playing) return;
    const index = this.index;
    this.pause();
    this.playing = true;
    this.index = index;
    this.speakFrom(index);
  }
  clearTimer() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
  // undefined: voices not known yet (let the browser choose its default);
  // null: no voice runs on this device; otherwise the voice to use.
  chooseVoice() {
    let voices = [];
    try {
      voices = this.synth.getVoices?.() || [];
    } catch {}
    if (!voices.length) return undefined;
    if (this.language === undefined)
      this.language =
        (typeof this.lang === "function" ? this.lang() : this.lang) || "";
    return pickVoice(voices, this.language, this.uiLanguage);
  }
  speakFrom(start) {
    const run = ++this.run;
    this.clearTimer();
    const end = chunkEnd(this.tokens, start);
    const words = this.tokens.slice(start, end + 1).map((t) => t.text);
    const { text, offsets } = utteranceText(words);
    const wanted = this.wpm(start);
    const rate = wpmToRate(wanted);
    const chunk = {
      start,
      end,
      offsets,
      // Timer estimates follow the voice; without a voice, the pace itself.
      voiceTimes: estimateWordTimes(words, rateToWpm(rate)),
      paceTimes: estimateWordTimes(words, wanted),
      // Slower than the slowest voice: wait between sentences to keep pace.
      slower: wanted < rateToWpm(MIN_RATE),
      started: null,
      heard: false, // a word boundary arrived for this utterance
    };
    if (this.silent) return this.timed(run, chunk, chunk.paceTimes, true);
    const voice = this.chooseVoice();
    if (voice === null) return this.goSilent(run, chunk, "no-voice");
    const u = new this.Utterance(text);
    u.rate = rate;
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    const current = () => run === this.run && this.utterance === u;
    u.onstart = () => {
      if (!current() || chunk.started !== null) return;
      chunk.started = this.clock();
      this.clearTimer();
      if (this.boundaries === false)
        this.timed(run, chunk, chunk.voiceTimes, false);
      else
        this.timer = this.schedule(() => {
          if (current() && !chunk.heard)
            this.timed(run, chunk, chunk.voiceTimes, false);
        }, BOUNDARY_GRACE_MS + chunk.voiceTimes[0]);
    };
    u.onboundary = (event) => {
      if (!current() || (event.name && event.name !== "word")) return;
      if (chunk.started === null) chunk.started = this.clock();
      if (!chunk.heard) {
        chunk.heard = true;
        this.clearTimer(); // boundaries take over from any timer
      }
      this.advanceTo(start + wordAtChar(offsets, event.charIndex || 0), end);
    };
    u.onend = () => {
      if (!current()) return;
      this.utterance = null;
      if (chunk.heard || end > start) this.boundaries = chunk.heard;
      this.finishChunk(run, chunk);
    };
    u.onerror = (event) => {
      if (!current()) return;
      this.utterance = null;
      // "interrupted" or "canceled" from something other than us (another
      // tab, a phone call): carry on from here without the voice.
      this.goSilent(
        run,
        chunk,
        event?.error === "interrupted" || event?.error === "canceled"
          ? "interrupted"
          : "failed",
      );
    };
    this.utterance = u;
    // Some browsers never start speaking (no voices installed, a stuck
    // queue). Don't leave the reader waiting.
    this.timer = this.schedule(() => {
      if (!current() || chunk.started !== null) return;
      this.utterance = null;
      try {
        this.synth.cancel();
      } catch {}
      this.goSilent(run, chunk, "failed");
    }, START_TIMEOUT_MS);
    try {
      if (this.synth.paused) this.synth.resume();
      this.synth.speak(u);
    } catch {
      this.utterance = null;
      this.clearTimer();
      this.goSilent(run, chunk, "failed");
    }
  }
  goSilent(run, chunk, reason) {
    if (run !== this.run) return;
    this.silent = true;
    this.onSilent?.(reason);
    if (run !== this.run || !this.playing) return;
    this.timed(run, chunk, chunk.paceTimes, true);
  }
  // Moves words on by estimated times. With `finish`, also ends the chunk
  // (no voice); otherwise the voice's end event does that.
  timed(run, chunk, times, finish) {
    const sums = [0];
    for (const t of times) sums.push(sums.at(-1) + t);
    // Line the clock up with the word already shown.
    const shown = this.index - chunk.start;
    const origin = finish
      ? this.clock() - sums[shown]
      : (chunk.started ?? this.clock());
    const tick = () => {
      this.timer = null;
      if (run !== this.run || !this.playing) return;
      if (chunk.heard && !finish) return;
      const elapsed = this.clock() - origin;
      let k = 0;
      // Within 1 ms counts as due, so rounding can never stall the words.
      while (k < times.length - 1 && sums[k + 1] <= elapsed + 1) k++;
      if (!this.advanceTo(chunk.start + k, chunk.end)) return;
      if (chunk.start + k < chunk.end)
        this.timer = this.schedule(tick, Math.max(1, sums[k + 1] - elapsed));
      else if (finish)
        this.timer = this.schedule(
          () => {
            this.timer = null;
            if (run === this.run) this.finishChunk(run, chunk);
          },
          Math.max(0, sums[times.length] - elapsed),
        );
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
    this.clearTimer();
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
    // At paces slower than any voice speaks, the sentence's last word stays
    // until the pace's time for the sentence is up.
    const wait =
      chunk.slower && chunk.started !== null && !this.silent
        ? chunk.started +
          chunk.paceTimes.reduce((sum, t) => sum + t, 0) -
          this.clock()
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
}
