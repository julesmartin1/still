import {
  DEFAULT_VOICE_TIMING,
  averageSpokenMs,
  spokenMs,
} from "./spoken.js";

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
// A full stop that doesn't end a sentence: after a title ("Mrs. Saville",
// "St. Petersburgh", "e.g. London") or an initial ("J. R. R. Tolkien"), or
// when a number or a word in lower case follows a short form ("No. 5",
// "Dec. 11th", "etc. and", "a.m. on", "so... and", "Louis XVI. of France",
// "7s. 6d."). A question, an exclamation or a quotation followed by a word
// in lower case runs on into its speaker ("“Is it?” she asked.").
const TITLES = new Set(
  "mr mrs ms mx messrs dr st mt ft prof rev revd hon capt col gen lt sgt cpl maj cmdr adm gov pres sen rep insp supt fr sr sra srta dra mme mlle mons hr hrn cf vs viz e.g i.e z.b".split(
    " ",
  ),
);
const SHORT_FORMS = new Set(
  "etc approx ca jr inc ltd co corp bros esq dept no nos nr vol vols p pp ch chap fig art sec cent mss lb lbs oz yd yds hr hrs sq jan feb mar apr jun jul aug sep sept oct nov dec".split(
    " ",
  ),
);
export function endsSentence(word, next = "") {
  if (!sentenceEnd.test(word)) return false;
  const lowerNext = /^[^\p{L}\p{N}]*\p{Ll}/u.test(next);
  if (!word.endsWith(".")) return !lowerNext;
  const runsOn = lowerNext || /^[^\p{L}\p{N}]*\p{N}/u.test(next);
  const core = word.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, -1);
  const lower = core.toLowerCase();
  return !(
    TITLES.has(lower) ||
    /^\p{Lu}$/u.test(core) ||
    (runsOn &&
      (SHORT_FORMS.has(lower) ||
        /\p{L}\.\p{L}/u.test(core) ||
        /^(?:[IVXLC]+|\p{N}+\p{L}{0,2})$/u.test(core) ||
        word.endsWith("...")))
  );
}
// Tokens carry whether they end a sentence (`end`, from buildTokens).
export const isSentenceEnd = (t) => t.end ?? endsSentence(t.text);

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
    words.forEach((word, k) => {
      const norm = cleanWord(word);
      const token = {
        text: word,
        norm,
        paragraph,
        index: tokens.length,
        rare: !common.has(norm) && norm.length > 5,
        complexity: 0,
        paragraphEnd: false,
        end: endsSentence(word, words[k + 1]),
      };
      tokens.push(token);
      sentence.push(token);
      if (token.end) finish();
    });
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
// One model sets every word's share, from what reading research measures
// about where the time goes when we read:
//
//   weight = say + rare + wrap-up (+ difficulty, a recent lookup, a new view)
//
// say: how long the word takes to say. A voice spends a fixed time on any
// word plus a little per sound in it (spoken.js); the natural voice measures
// both, and its pauses, as it reads aloud, and `voice` carries what it
// measured. Against an average word:
//   say = 0.45 + 0.55 × spoken(word) / spoken(average word)
// so "a" gets about 0.8, an average word 1 and "extraordinary" about 1.9.
// The fixed part keeps short words on screen long enough to be seen.
//
// rare: how common the word is (see frequencyWeight). Uncommon words take
// longer to recognise than common ones of the same length.
//
// wrap-up: readers linger at the end of a clause or sentence to put it
// together, about where a voice pauses. A comma or full stop adds half the
// voice's pause there, and the end of a paragraph a little more.
export function wordWeight(
  token,
  {
    profile = freshProfile(),
    now = Date.now(),
    voice = DEFAULT_VOICE_TIMING,
    // (norm) → the word's Zipf frequency, or undefined when it isn't on the
    // list; null when there is no list for the reading's language.
    frequency = null,
    seen = 0, // times the word came earlier in this reading
  } = {},
) {
  const average = averageSpokenMs(voice);
  const said = spokenMs(token.text ?? token.norm, voice) / average;
  let weight = clamp(0.45 + 0.55 * said, 0.75, 2.2);
  weight += token.complexity || 0;
  weight += rareWeight(token, frequency, seen);
  const looked = profile.lookups[token.norm];
  if (Number.isFinite(looked))
    weight += 0.25 * clamp(1 - (now - looked) / 86400000 / 30, 0, 1);
  if (clauseEnd.test(token.text)) weight += clamp((0.5 * voice.comma) / average, 0.2, 0.6);
  if (isSentenceEnd(token))
    weight += clamp((0.5 * voice.stop) / average, 0.4, 1.1);
  if (token.paragraphEnd) weight += 0.6;
  return weight;
}
// How much longer an uncommon word needs, on the Zipf scale (log10 of how
// often it appears per billion words: "the" is 7.7, "house" 5.7, "quixotic"
// 2.3). In eye-tracking studies the time spent on a word falls steadily with
// its log frequency, by a few tens of milliseconds a step. Here each step
// below 5 adds FREQUENCY_SLOPE of an average word's time (about 20 ms at 260
// words a minute) and each step above takes as much away. The extra time
// for a rare word fades each time it comes again in the same reading (a
// character's name is slow the first time, not the tenth): it is divided by
// √(1 + times seen).
export const FREQUENCY_CENTER = 5;
export const FREQUENCY_SLOPE = 0.09;
// A word not on the list (the lists stop near Zipf 3) is taken as this.
export const UNLISTED_ZIPF = 2.8;
// Without a list for the language, a long word outside the common few
// hundred counts as this rare.
const RARE_ZIPF = 3.2;
export function frequencyWeight(zipf, seen = 0) {
  let extra = FREQUENCY_SLOPE * (FREQUENCY_CENTER - zipf);
  if (extra > 0) extra /= Math.sqrt(1 + Math.max(0, seen));
  return clamp(extra, -0.2, 0.4);
}
function rareWeight(token, frequency, seen) {
  if (typeof frequency !== "function")
    return token.rare ? frequencyWeight(RARE_ZIPF, seen) : 0;
  const norm = token.norm ?? cleanWord(token.text);
  if (!/\p{L}/u.test(norm || "")) return 0; // numbers: their length covers it
  const zipf = frequency(norm);
  return frequencyWeight(Number.isFinite(zipf) ? zipf : UNLISTED_ZIPF, seen);
}
export const VIEW_START = 0.5;
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
    voice = DEFAULT_VOICE_TIMING, // what the voice taught (spoken.js)
    frequency = null, // see wordWeight
    // Showing a sentence at a time: the indices where a new sentence comes
    // on screen. Its first word gets VIEW_START more, for the eye to go back
    // to the start of the line and take in the new view.
    viewStarts = null,
  } = {},
) {
  const groups = new Map();
  const seenCounts = new Map();
  tokens.forEach((token, index) => {
    if (!groups.has(token.paragraph)) groups.set(token.paragraph, []);
    const norm = token.norm ?? cleanWord(token.text);
    const seen = seenCounts.get(norm) || 0;
    seenCounts.set(norm, seen + 1);
    let weight = wordWeight(token, { profile, now, voice, frequency, seen });
    if (index && viewStarts?.has(index)) weight += VIEW_START;
    groups.get(token.paragraph).push({ index, weight });
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

// ---- A sentence at a time ----
// The stretches shown together when reading a sentence at a time: each
// sentence, within one paragraph. A sentence too long for a phone screen
// is split at its last clause end (a comma, semicolon, colon or dash) after
// at least VIEW_MIN_WORDS words, or after VIEW_MAX_WORDS if it has none.
// Returns [start, end] pairs (token indices, inclusive) covering every token.
export const VIEW_MAX_WORDS = 32;
export const VIEW_MIN_WORDS = 12;
const viewClauseEnd = /(?:[,;:、，；：]|[—–])[”’"')\]」』）】》]*$/u;
export function sentenceSpans(tokens, max = VIEW_MAX_WORDS) {
  const spans = [];
  let start = 0;
  while (start < tokens.length) {
    const limit = Math.min(tokens.length - 1, start + max - 1);
    let end = -1,
      clause = -1;
    for (let i = start; i <= limit; i++) {
      const t = tokens[i];
      if (
        t.paragraphEnd ||
        isSentenceEnd(t) ||
        tokens[i + 1]?.paragraph !== t.paragraph
      ) {
        end = i;
        break;
      }
      if (i - start + 1 >= VIEW_MIN_WORDS && viewClauseEnd.test(t.text))
        clause = i;
    }
    if (end < 0) end = limit === tokens.length - 1 ? limit : clause >= 0 ? clause : limit;
    spans.push([start, end]);
    start = end + 1;
  }
  return spans;
}
// The span (from sentenceSpans) holding token `index`.
export function spanAt(spans, index) {
  let low = 0,
    high = spans.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (spans[mid][1] < index) low = mid + 1;
    else if (spans[mid][0] > index) high = mid - 1;
    else return spans[mid];
  }
  return null;
}

// ---- Short words together (Settings › Show › One word) ----
// In ordinary reading the eye skips most short function words ("of", "the",
// "so"): it takes them in along with the next word. Showing them together
// does the same. A word of one or two letters, or a three-letter function
// word, is shown with the word after it when the two fit in
// GROUP_MAX_CHARS, about what the eye takes in at one glance ("of the",
// "a dark", "Mr. Darcy", "go on"). Two of them take a third word when all
// three fit ("in the end", "and so on."), but not a third short word
// mid-phrase ("it was · a dark"). When only an article or preposition
// second fits with what follows, the first stands alone and the second goes
// with its word ("of · the window", "in · at once"); otherwise the first two
// stay together ("he is · considered"). A group never runs past
// punctuation, a paragraph or an opening quote. Returns [start, end] pairs
// like sentenceSpans; playback still moves word by word underneath, so a
// group stays on screen for its words' time.
export const GROUP_MAX_CHARS = 13;
// Three-letter function words in the languages Still has word lists for.
const SHORT_FUNCTION = new Set(
  "the and but for nor yet not are was has had did can may his her its our you she him who how why all any off out too per via let now mrs les des une est aux par pas sur qui que son ses mon mes ton tes nos vos ils lui moi toi car ces cet los las del una por con sin sus mis tus más muy era fue hay der die das den dem ein und ist war mit von zum zur auf aus bei für wir ihr als wie wer nur hat mir dir uns nel gli che non sul dei suo sua mio mia più dos uma com não mas sem seu foi het een van met dat wat aan ook uit bij nog dan hij zij wij ons mij".split(
    " ",
  ),
);
// Short words that belong with the word after them.
const LEANS = new Set(
  "a an the of to in on at by for as his her its my our your mr mrs ms dr st".split(
    " ",
  ),
);
const groupCloser = /[—–…”’"')\]」』）】》]$/u;
const groupOpener = /^[\p{Ps}\p{Pi}"'「『（【《]/u;
const isShortWord = (t) => {
  const norm = t.norm ?? cleanWord(t.text);
  return (
    !!norm &&
    !noSpaceScript.test(t.text) &&
    (norm.length <= 2 || SHORT_FUNCTION.has(norm))
  );
};
// Nothing joins a word that ends a sentence or clause.
const closesGroup = (t) =>
  t.paragraphEnd ||
  isSentenceEnd(t) ||
  clauseEnd.test(t.text) ||
  groupCloser.test(t.text);
export function wordGroups(tokens, max = GROUP_MAX_CHARS) {
  const spans = [];
  // Short word `a` (with `chars` characters shown so far) takes `b` after it.
  const joins = (a, b, chars) =>
    !!b &&
    isShortWord(a) &&
    !closesGroup(a) &&
    b.paragraph === a.paragraph &&
    !groupOpener.test(b.text) &&
    chars + 1 + b.text.length <= max;
  for (let i = 0; i < tokens.length; ) {
    const [a, b, c] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    let end = i;
    if (joins(a, b, a.text.length)) {
      end = i + 1;
      if (joins(b, c, a.text.length + 1 + b.text.length))
        end = isShortWord(c) && !closesGroup(c) ? i + 1 : i + 2;
      else if (
        LEANS.has(b.norm ?? cleanWord(b.text)) &&
        joins(b, c, b.text.length) &&
        (!isShortWord(c) || closesGroup(c))
      )
        end = i;
    }
    spans.push([i, end]);
    i = end + 1;
  }
  return spans;
}
