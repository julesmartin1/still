export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const cleanWord = (w) =>
  w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
const common = new Set(
  "the of and a to in is you that it he was for on are as with his they at be this from i have or by one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words just where most know get through back much before go good new write our me man too any day same right look think also around another come work three word must because does part even place well such here take why things help put different away again off went old number great tell every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always show often together asked house world going want school important until form food keep children feet land side without boy once life enough took book hear stop almost let above sometimes answer light sea began need point city play small yet better morning room open slowly eyes window street quiet read reading pace pause start".split(
    " ",
  ),
);
// Closing quotes/brackets that may follow sentence or clause punctuation,
// including CJK corner brackets and full-width parentheses.
export const sentenceEnd = /[.!?。！？][”’"')\]」』）】》]*$/u;
export const clauseEnd = /[,;:、，；：][”’"')\]」』）】》]*$/u;

// Scripts written without spaces between words. Chunks containing them are
// split into words with Intl.Segmenter; everything else splits on whitespace.
const noSpaceScript =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const opening = /^[\p{Ps}\p{Pi}「『（【《]+$/u;
let segmenter;
function segmentChunk(chunk) {
  if (!noSpaceScript.test(chunk) || typeof Intl?.Segmenter !== "function")
    return [chunk];
  segmenter ||= new Intl.Segmenter(undefined, { granularity: "word" });
  const words = [];
  let pending = "";
  for (const { segment, isWordLike } of segmenter.segment(chunk)) {
    const previous = words.at(-1);
    if (
      isWordLike &&
      !pending &&
      previous &&
      /^\p{Script=Hiragana}+$/u.test(segment) &&
      /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}」』）]$/u.test(
        previous,
      )
    ) {
      // Japanese: keep particles and inflections with the word before them
      // (a bunsetsu), which is the natural unit for reading Japanese.
      words[words.length - 1] += segment;
    } else if (isWordLike) {
      words.push(pending + segment);
      pending = "";
    } else if (words.length && !pending && !opening.test(segment))
      words[words.length - 1] += segment; // trailing punctuation
    else pending += segment; // opening punctuation waits for the next word
  }
  if (pending) {
    if (words.length) words[words.length - 1] += pending;
    else words.push(pending);
  }
  return words;
}

// The one definition of a "word" used across the app (display, citations,
// backups, PDF page links). Each word is {text, index} where index is its
// character offset in `text`. Words always concatenate back to the chunk
// they came from, so offsets stay exact.
export function sourceWords(text) {
  const words = [];
  for (const match of text.matchAll(/\S+/g)) {
    let offset = match.index;
    for (const piece of segmentChunk(match[0])) {
      words.push({ text: piece, index: offset });
      offset += piece.length;
    }
  }
  return words;
}
export const countWords = (text) => sourceWords(text).length;

// Builds reading tokens from paragraphs that are already split into words.
export function buildTokens(wordParagraphs) {
  const tokens = [];
  wordParagraphs.forEach((words, paragraph) => {
    if (!words.length) return;
    let sentence = [];
    const finish = () => {
      const length = sentence.length;
      const commas = sentence.filter((t) =>
        /[,;:、，；：]/.test(t.text),
      ).length;
      const complexity = clamp((length - 16) * 0.006 + commas * 0.018, 0, 0.18);
      sentence.forEach((t) => (t.complexity = complexity));
      sentence = [];
    };
    for (const word of words) {
      const norm = cleanWord(word);
      const token = {
        text: word,
        norm,
        paragraph,
        index: tokens.length,
        rare: !common.has(norm) && norm.length > 5,
        complexity: 0,
        paragraphEnd: false,
      };
      tokens.push(token);
      sentence.push(token);
      if (sentenceEnd.test(word)) finish();
    }
    finish();
    tokens.at(-1).paragraphEnd = true;
  });
  return tokens;
}
export const textDifficulty = (tokens) =>
  tokens.length
    ? clamp(
        (tokens.filter((t) => t.rare).length / tokens.length) * 0.13,
        0,
        0.07,
      )
    : 0;
export function parseText(text) {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean);
  const tokens = buildTokens(
    paragraphs.map((p) => sourceWords(p).map((w) => w.text)),
  );
  return { tokens, paragraphs, difficulty: textDifficulty(tokens) };
}
export const freshProfile = () => ({ slowdown: 0, lookups: {}, rewinds: [] });
export function recordRewind(profile, paragraph, now = Date.now()) {
  const recent = profile.rewinds.filter((r) => now - r.time < 10 * 60 * 1000);
  if (!recent.some((r) => r.paragraph === paragraph))
    recent.push({ paragraph, time: now });
  const additional =
    recent.length >= 3 &&
    recent.length >
      profile.rewinds.filter((r) => now - r.time < 10 * 60 * 1000).length
      ? 0.025
      : 0;
  return {
    ...profile,
    rewinds: recent.slice(-20),
    slowdown: clamp(profile.slowdown + additional, 0, 0.2),
  };
}
export function recordLookup(profile, word) {
  const lookups = { ...profile.lookups, [cleanWord(word)]: Date.now() };
  return { ...profile, lookups };
}
// Relative weights allocate the paragraph's budget; they do not add time to it.
export function wordWeight(
  token,
  { profile = freshProfile(), now = Date.now() } = {},
) {
  const letters = (token.norm.match(/\p{L}/gu) || []).length;
  // Longer words take longer to recognise: in normal reading the eye stays
  // roughly 20-30 ms longer per extra letter. A 10-letter word gets about
  // 40% more time than a short one, up to double for very long words.
  let weight = clamp(1 + 0.08 * Math.max(0, letters - 5), 1, 2);
  weight += token.complexity || 0;
  if (token.rare) weight += 0.16;
  const looked = profile.lookups[token.norm];
  if (Number.isFinite(looked))
    weight += 0.25 * clamp(1 - (now - looked) / 86400000 / 30, 0, 1);
  if (clauseEnd.test(token.text)) weight += 0.35;
  if (sentenceEnd.test(token.text)) weight += 0.7;
  if (token.paragraphEnd) weight += 0.6;
  return weight;
}
// The slowest pace suits a new reader or someone learning the language
// (a word every 1.5 s); the fastest is near the limit of comprehension.
export const MIN_WPM = 40;
export const MAX_WPM = 600;
export function targetWpm(base, profile = freshProfile(), replay = false) {
  return (
    clamp(base, MIN_WPM, MAX_WPM) /
    (1 + clamp(profile.slowdown || 0, 0, 0.2)) /
    (replay ? 1.16 : 1)
  );
}
// Reserve a readable share for every word, then allocate the remainder by weight.
export function minimumWordTime(average) {
  return Math.max(0.85 * average, Math.min(140, 0.95 * average));
}
export function allocateWordTimes(weights, budget) {
  if (!weights.length) return [];
  const minimum = minimumWordTime(budget / weights.length),
    result = new Array(weights.length);
  let pending = weights.map((weight, index) => ({ weight, index })),
    remaining = budget;
  while (pending.length) {
    const total = pending.reduce((sum, w) => sum + w.weight, 0);
    const pinned = pending.filter(
      (w) => (remaining * w.weight) / total < minimum,
    );
    if (!pinned.length) {
      for (const w of pending) result[w.index] = (remaining * w.weight) / total;
      break;
    }
    const pinnedIndices = new Set(pinned.map((w) => w.index));
    for (const w of pinned) {
      result[w.index] = minimum;
      remaining -= minimum;
    }
    pending = pending.filter((w) => !pinnedIndices.has(w.index));
  }
  return result;
}
export function buildTimingPlan(
  tokens,
  {
    base = 260,
    profile = freshProfile(),
    replayParagraph = null,
    replayParagraphs = null, // Set of paragraphs to replay slower
    now = Date.now(),
  } = {},
) {
  const groups = new Map();
  tokens.forEach((token, index) => {
    if (!groups.has(token.paragraph)) groups.set(token.paragraph, []);
    groups
      .get(token.paragraph)
      .push({ index, weight: wordWeight(token, { profile, now }) });
  });
  const durations = new Array(tokens.length);
  for (const [paragraph, words] of groups) {
    const budget =
      (words.length * 60000) /
      targetWpm(
        base,
        profile,
        paragraph === replayParagraph || !!replayParagraphs?.has(paragraph),
      );
    const allocated = allocateWordTimes(
      words.map((w) => w.weight),
      budget,
    );
    words.forEach((word, i) => (durations[word.index] = allocated[i]));
  }
  return durations;
}
export class Playback {
  constructor({
    length,
    duration,
    onWord,
    onEnd,
    // Optional: return true to stop after the word at `index` (a check-in).
    breakAfter = null,
    onBreak = null,
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    clock = () => performance.now(),
  }) {
    Object.assign(this, {
      length,
      duration,
      onWord,
      onEnd,
      breakAfter,
      onBreak,
      schedule,
      cancel,
      clock,
    });
    this.index = 0;
    this.playing = false;
    this.timer = null;
    this.finished = false;
  }
  play() {
    if (this.playing || !this.length) return;
    if (this.finished) {
      this.index = 0;
      this.finished = false;
    }
    this.playing = true;
    this.deadline = this.clock();
    this.onWord(this.index);
    this.queue();
  }
  queue() {
    this.deadline = this.clock() + this.duration(this.index);
    this.timer = this.schedule(
      () => {
        if (!this.playing) return;
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
        this.index++;
        this.onWord(this.index);
        this.queue();
      },
      Math.max(0, this.deadline - this.clock()),
    );
  }
  pause() {
    this.playing = false;
    this.cancel(this.timer);
    this.timer = null;
  }
  seek(index) {
    this.pause();
    this.index = clamp(index, 0, Math.max(0, this.length - 1));
    this.finished = false;
    this.onWord(this.index);
  }
  retime() {
    if (this.playing) {
      this.cancel(this.timer);
      this.deadline = this.clock();
      this.queue();
    }
  }
}
// Easing in: the first few words after pressing play get a little extra
// time, so the eye can settle on the stage before the pace takes over.
// `step` counts words shown since playback started (0 = the first).
const WARM_UP = [1.8, 1.5, 1.3, 1.15];
export const warmUpFactor = (step) => WARM_UP[step] ?? 1;
// Easing in over the first half minute: playback starts 15% slower and
// reaches the chosen pace after 30 seconds, so a start never feels rushed.
// `elapsed` is milliseconds since this stretch of reading began.
export const EASE_IN_MS = 30000;
export const easeInFactor = (elapsed) =>
  1 + 0.15 * Math.max(0, 1 - Math.max(0, elapsed) / EASE_IN_MS);
// Running totals of a timing plan, so the time left from any word is one
// subtraction: sums[to] - sums[from].
export function planSums(plan) {
  const sums = new Float64Array(plan.length + 1);
  for (let i = 0; i < plan.length; i++) sums[i + 1] = sums[i] + (plan[i] || 0);
  return sums;
}
