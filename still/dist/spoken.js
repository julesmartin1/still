// How long a word takes to say, worked out from its letters: the sounds and
// syllables in it, with numbers, symbols and common abbreviations read the
// way a voice reads them ("1984" is "nineteen eighty-four", "Dr." is
// "doctor"). Read aloud uses it to share a clip's time out between its words,
// and silent reading uses it (with what the voice has taught it, see
// voice-timing below) for how long each word stays on screen.
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const vowelGroups = /[aeiouy]+/g;
// Letter pairs that make one sound.
const digraphs =
  /th|sh|ch|ph|wh|ck|ng|gh|qu|ee|oo|ea|ai|ay|oa|ou|ow|oi|oy|au|aw|ie|ei/g;

// Syllables in a plain lower-case word (English spelling rules of thumb).
export function syllables(word) {
  let w = String(word)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // A silent final e ("make"), -ed ("crossed") or -es ("makes"), but not
  // "-le" after a consonant ("table"), "-ted" or "-ches".
  if (!/[^aeiouy]le$/.test(w)) {
    if (/[^aeiouy]e$/.test(w)) w = w.slice(0, -1);
    else if (/[^aeiouytd]ed$/.test(w)) w = w.slice(0, -2) + "d";
    else if (/[^aeiouysxz]es$/.test(w) && !/[cs]hes$/.test(w))
      w = w.slice(0, -2) + "s";
  }
  w = w.replace(/^y/, "");
  const groups = w.match(vowelGroups)?.length || 0;
  return Math.max(1, groups);
}

// Sounds (phonemes, roughly) in a plain word: its letters, less the pairs
// that make one sound, doubled letters and a silent final e.
export function sounds(word) {
  const w = String(word)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!w) return 0;
  let n = w.length;
  n -= (w.match(digraphs) || []).length;
  n -= (w.match(/([b-df-hj-np-tv-z])\1/g) || []).length;
  if (/[^aeiouy]e$/.test(w) && w.length > 3) n--;
  return Math.max(1, n);
}

// ---- Numbers, symbols and abbreviations, as a voice says them ----
const ONES =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(
  " ",
);
function under1000(n) {
  const words = [];
  if (n >= 100) {
    words.push(ONES[Math.floor(n / 100)], "hundred");
    n %= 100;
    if (!n) return words;
  }
  if (n < 20) words.push(ONES[n]);
  else {
    words.push(TENS[Math.floor(n / 10)]);
    if (n % 10) words.push(ONES[n % 10]);
  }
  return words;
}
export function numberWords(n) {
  n = Math.floor(Math.abs(n));
  if (n < 1000) return under1000(n);
  // Years are read in pairs: 1984 is "nineteen eighty-four".
  if (n >= 1100 && n < 2000 && n % 100)
    return [...under1000(Math.floor(n / 100)), ...under1000(n % 100)];
  const words = [];
  for (const [size, name] of [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ])
    if (n >= size) {
      words.push(...under1000(Math.floor(n / size) % 1000), name);
      n %= size;
    }
  if (n) words.push(...under1000(n));
  return words;
}
const ABBREVIATIONS = Object.assign(Object.create(null), {
  mr: "mister",
  mrs: "misses",
  ms: "miz",
  dr: "doctor",
  st: "saint",
  jr: "junior",
  sr: "senior",
  vs: "versus",
  etc: "et cetera",
  eg: "for example",
  ie: "that is",
  no: "number",
});
// Short words often written in capitals that are said, not spelled.
const COMMON_CAPS = new Set(
  "A I OK THE AND BUT FOR NOT YOU ARE WAS HIS HER SHE HIM ONE TWO ALL ANY CAN HAD HAS OUR OUT NEW NOW OLD SEE WAY WHO BOY DID GET LET MAN END YES NO SO TO OF IN ON AT BY UP GO DO IT IS BE WE HE ME MY OR AN AS IF".split(
    " ",
  ),
);
const SYMBOLS = Object.assign(Object.create(null), {
  "&": "and",
  "%": "percent",
  "+": "plus",
  "=": "equals",
  "@": "at",
  "#": "number",
  $: "dollars",
  "£": "pounds",
  "€": "euros",
});

// The words a voice says for one written word, e.g. "$5" → five dollars.
export function spokenWords(word) {
  const text = String(word);
  const out = [];
  const abbreviation = text
    .toLowerCase()
    .replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "");
  if (/\.$/.test(abbreviation)) {
    const key = abbreviation.replace(/\./g, "");
    if (key in ABBREVIATIONS && !(key === "no" && !/\d/.test(text)))
      return ABBREVIATIONS[key].split(" ");
  }
  for (const piece of text.match(
    /\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th)?|\p{L}+|[&%+=@#$£€]/gu,
  ) || []) {
    if (/^\d/.test(piece)) {
      const [whole, fraction] = piece
        .replace(/,/g, "")
        .replace(/(st|nd|rd|th)$/, "")
        .split(".");
      out.push(...numberWords(Number(whole)));
      if (fraction) out.push("point", ...[...fraction].map((d) => ONES[d]));
    } else if (piece in SYMBOLS) out.push(SYMBOLS[piece]);
    // Short capitals ("FBI", "BBC") and ones with no vowel ("HTML") are
    // spelled out, a letter a beat; "NASA" and capitalised words are not.
    else if (
      /^\p{Lu}{2,5}$/u.test(piece) &&
      (piece.length <= 3 ? !COMMON_CAPS.has(piece) : !/[AEIOU]/.test(piece))
    )
      out.push(...[...piece].map(() => "bee"));
    else out.push(piece);
  }
  return out;
}

// How long a word takes to say, in "beats" (about one short sound each):
// consonants count a little less than vowels, which carry the syllable.
// Words in other alphabets fall back to their letters.
function countBeats(word) {
  const said = spokenWords(word);
  let beats = 0;
  for (const w of said) {
    if (/^[a-z]+$/i.test(w)) {
      const s = sounds(w),
        v = syllables(w);
      beats += 0.7 * s + 0.6 * v;
    } else beats += 0.85 * (w.match(/[\p{L}\p{N}]/gu) || []).length;
  }
  return Math.max(1, beats);
}
// Words repeat a lot in a book, so each one is worked out once.
const beatCache = new Map();
export function spokenBeats(word) {
  word = String(word);
  let beats = beatCache.get(word);
  if (beats === undefined) {
    if (beatCache.size > 20000) beatCache.clear();
    beats = countBeats(word);
    beatCache.set(word, beats);
  }
  return beats;
}

// ---- What the voice has taught us ----
// Measured from the natural voice as it reads (see natural-voice.js): how
// long a word takes, as a fixed part plus a part per beat, and how long the
// voice pauses at a comma and at a full stop, all at speed 1 in ms. These
// defaults are a typical narrator's (about 160 words a minute).
export const DEFAULT_VOICE_TIMING = {
  perWord: 95,
  perBeat: 48,
  comma: 180,
  stop: 360,
  samples: 0,
};
// Folds one measured stretch of speech into the timing: `words` words with
// `beats` beats took `ms` (at speed 1). Least squares over everything heard,
// with the defaults counted as a few stretches so early numbers stay sane.
export function learnSpeech(timing, { words, beats, ms }) {
  if (!(words > 0 && beats > 0 && ms > 0)) return timing;
  const t = { ...DEFAULT_VOICE_TIMING, ...timing };
  // Sums for the fit ms ≈ perWord·words + perBeat·beats.
  // Older stretches count a little less each time, so a new voice or pace
  // takes over within a few minutes of reading.
  const s = t.sums || priorSums();
  const next = {
    ww: 0.98 * s.ww + words * words,
    wb: 0.98 * s.wb + words * beats,
    bb: 0.98 * s.bb + beats * beats,
    wm: 0.98 * s.wm + words * ms,
    bm: 0.98 * s.bm + beats * ms,
  };
  const det = next.ww * next.bb - next.wb * next.wb;
  let perWord = t.perWord,
    perBeat = t.perBeat;
  if (det > 1e-6) {
    perWord = (next.wm * next.bb - next.bm * next.wb) / det;
    perBeat = (next.bm * next.ww - next.wm * next.wb) / det;
  }
  return {
    ...t,
    sums: next,
    perWord: clamp(perWord, 20, 260),
    perBeat: clamp(perBeat, 25, 110),
    samples: t.samples + 1,
  };
}
function priorSums() {
  // The defaults, as if heard over a few typical stretches.
  const d = DEFAULT_VOICE_TIMING;
  const sums = { ww: 0, wb: 0, bb: 0, wm: 0, bm: 0 };
  for (const [words, beats] of [
    [6, 28],
    [9, 36],
    [12, 60],
  ]) {
    const ms = d.perWord * words + d.perBeat * beats;
    sums.ww += words * words;
    sums.wb += words * beats;
    sums.bb += beats * beats;
    sums.wm += words * ms;
    sums.bm += beats * ms;
  }
  return sums;
}
// Folds a measured pause (ms, at speed 1) after a comma or a full stop.
export function learnPause(timing, kind, ms) {
  const t = { ...DEFAULT_VOICE_TIMING, ...timing };
  if (!(ms > 0) || !(kind === "comma" || kind === "stop")) return t;
  const range = kind === "comma" ? [80, 700] : [150, 1400];
  return { ...t, [kind]: clamp(t[kind] * 0.85 + ms * 0.15, ...range) };
}
// How long the voice takes over a word at speed 1, in ms (the pause after it
// not included), and over an average word (3.4 beats, measured over the
// starter shelf).
export const AVERAGE_BEATS = 3.4;
export const spokenMs = (word, timing = DEFAULT_VOICE_TIMING) =>
  timing.perWord + timing.perBeat * spokenBeats(word);
export const averageSpokenMs = (timing = DEFAULT_VOICE_TIMING) =>
  timing.perWord + timing.perBeat * AVERAGE_BEATS;

// What one clip played by the natural voice teaches (see
// natural-voice.alignedWordStarts): each stretch of speech between pauses
// with no punctuation inside it, and each pause after a comma or full stop,
// scaled to speed 1.
const stopMark = /[.!?。！？][”’"')\]」』）】》]*$/u;
const commaMark = /[,;:、，；：][”’"')\]」』）】》]*$/u;
export function learnFromClip(
  timing,
  { words = [], speed = 1, stretches = [], matches = [] },
) {
  let t = { ...DEFAULT_VOICE_TIMING, ...timing };
  if (!(speed > 0)) return t;
  for (const [from, to, start, end] of stretches) {
    const inside = words.slice(from, to);
    if (inside.length < 3) continue;
    if (inside.slice(0, -1).some((w) => stopMark.test(w) || commaMark.test(w)))
      continue;
    const beats = inside.reduce((sum, w) => sum + spokenBeats(w), 0);
    t = learnSpeech(t, {
      words: inside.length,
      beats,
      ms: (end - start) * speed,
    });
  }
  for (const { word, gap } of matches) {
    const before = words[word - 1] || "";
    const kind = stopMark.test(before)
      ? "stop"
      : commaMark.test(before)
        ? "comma"
        : "";
    if (kind) t = learnPause(t, kind, (gap.to - gap.from) * speed);
  }
  return t;
}
// Keeps a stored timing usable: known fields only, in range.
export function normalVoiceTiming(stored) {
  const t = { ...DEFAULT_VOICE_TIMING };
  if (!stored || typeof stored !== "object") return t;
  const pick = (key, low, high) => {
    const v = Number(stored[key]);
    if (Number.isFinite(v)) t[key] = clamp(v, low, high);
  };
  pick("perWord", 20, 260);
  pick("perBeat", 25, 110);
  pick("comma", 80, 700);
  pick("stop", 150, 1400);
  pick("samples", 0, 1e9);
  const s = stored.sums;
  if (s && ["ww", "wb", "bb", "wm", "bm"].every((k) => Number.isFinite(s[k])))
    t.sums = { ww: s.ww, wb: s.wb, bb: s.bb, wm: s.wm, bm: s.bm };
  return t;
}
