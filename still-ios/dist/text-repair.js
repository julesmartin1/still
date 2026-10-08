// Repairs text whose fonts label some glyphs with the wrong characters.
//
// Many book PDFs (and text copied out of them) do this with ligatures: the
// single glyph for "fi" comes out as "ɹ", "ff" as "ʃ", "ffi" as "ɽ", and so
// on, so "first" reads "ɹrst". The wrong characters differ between fonts, so
// nothing is hard-coded. Instead, for each unusual character, Still tries each
// ligature in a sample of the words that contain it and keeps the one that
// turns most of them into dictionary words. Text that really uses those
// characters (phonetic transcriptions, other languages) does not produce
// dictionary words, so it is left alone.
//
// Control characters between letters are a related fault: a hyphen glyph with
// no text label. They become hyphens.
//
// Note numbers lose their superscript when text is extracted, so "garden³"
// becomes "garden3". Numbers glued to the end of words are removed only when
// they count up through the text (1, 2, 3...), which is what note markers do
// and what postcodes, model numbers and dates don't. Names like "SHA-1",
// "v2", "1.E.1" or "md5" are left alone: a note follows a word of two or more
// letters and at most closing punctuation, and never repeats word for word.

const LIGATURES = ["fi", "fl", "ff", "ffi", "ffl", "ft", "st", "ct", "Th"];
// IPA letters and private-use code points: where mislabelled glyphs land.
const SUSPECT = /[ɐ-ʯ-]/u;
const SUSPECTS = /[ɐ-ʯ-]/gu;
const SAMPLE = 30;

// Real ligature characters, stray controls and control-character hyphens.
export function normalizeGlyphs(text) {
  return text
    .replace(/[ﬀ-ﬆ]/g, (c) => c.normalize("NFKC"))
    .replace(/(\p{L})[\u0001-\u0008\u000e-\u001f]+(?=\p{L}|\s|$)/gu, "$1-")
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, "");
}

// Learns which ligature each unusual character stands for.
// `texts` is an array of strings; `lookup` resolves a word or returns null.
export async function learnGlyphMap(texts, lookup, { signal } = {}) {
  const words = new Map(); // character -> Set of words containing it
  for (const text of texts) {
    if (!SUSPECT.test(text)) continue;
    for (const word of text.match(/[\p{L}-]+/gu) || []) {
      const odd = new Set(word.match(SUSPECTS) || []);
      // Only words with a single kind of unusual character and otherwise
      // plain letters, so each test isolates one character.
      if (odd.size !== 1) continue;
      const [c] = odd;
      if (!/^[A-Za-z]*$/.test(word.replaceAll(c, ""))) continue;
      if (!words.has(c)) words.set(c, new Set());
      const set = words.get(c);
      if (set.size < SAMPLE) set.add(word);
    }
  }
  const map = new Map();
  for (const [c, sample] of words) {
    if (sample.size < 2) continue;
    const scores = [];
    for (const ligature of LIGATURES) {
      let hits = 0;
      for (const word of sample) {
        signal?.throwIfAborted();
        const candidate = word.replaceAll(c, ligature);
        try {
          if (await lookup(candidate)) hits++;
        } catch {
          return map; // no dictionary: change nothing
        }
      }
      scores.push({ ligature, hits });
    }
    // Stable sort: on a tie the more common ligature (earlier in the list)
    // wins, but only the five f-ligatures may win a tie.
    scores.sort((a, b) => b.hits - a.hits);
    const [best, next] = scores;
    const tieOk = LIGATURES.indexOf(best.ligature) < 5;
    if (
      best.hits >= 2 &&
      best.hits >= sample.size * 0.4 &&
      (best.hits > next.hits || tieOk)
    )
      map.set(c, best.ligature);
  }
  return map;
}

export function applyGlyphMap(text, map) {
  if (!map.size) return text;
  return text.replace(SUSPECTS, (c) => map.get(c) ?? c);
}

// A number glued to the end of a word, optionally after closing punctuation
// and a footnote symbol: "garden3", "Wahlheim.∗12", "‘Albert19". The word
// stands on its own and has a lower-case letter, and the number isn't part of
// a longer one, so "SHA-1", "4.0", "WSL2", "open3_detach" and "v1.8-rc2" stay.
const NOTE =
  /(?<=(?:^|[\s"'“‘(\[—–])((?=\p{L}{2})\p{L}*\p{Ll}\p{L}*[.,;:!?"'”’)\]»]{0,4}))([∗*†‡]?)(\d{1,3})(?![\p{L}\d_@/=-]|[.,:]\d)/gu;

// Removes note markers from an array of strings (lines or whole texts, in
// reading order). Returns the new strings and how many markers were removed.
export function stripNoteMarkers(texts) {
  const found = [];
  const seen = new Map(); // "word3" -> how often it occurs
  texts.forEach((text, t) => {
    for (const m of text.matchAll(NOTE)) {
      const key = m[1].replace(/\P{L}/gu, "").toLowerCase() + m[3];
      seen.set(key, (seen.get(key) || 0) + 1);
      found.push({
        t,
        index: m.index,
        length: m[0].length,
        n: Number(m[3]),
        key,
      });
    }
  });
  // Longest-running count: each marker 1-5 above the last, or a restart at 1.
  // A restart counts only if it goes on to 2 (notes numbered per chapter),
  // so a "1" that keeps coming back on its own is not a note.
  let last = 0;
  const runs = [[]];
  for (const f of found) {
    if (seen.get(f.key) > 1) continue;
    if (f.n === 1 && last > 0) runs.push([]);
    else if (!(f.n > last && f.n <= last + 5)) continue;
    runs.at(-1).push(f);
    last = f.n;
  }
  const chain = runs.filter((r) => r.length >= 2).flat();
  if (chain.length < 3) return { texts, removed: 0 };
  const out = [...texts];
  for (let i = chain.length - 1; i >= 0; i--) {
    const { t, index, length } = chain[i];
    out[t] = out[t].slice(0, index) + out[t].slice(index + length);
  }
  // Footnote symbols left on their own after a word ("told.∗").
  for (let t = 0; t < out.length; t++)
    out[t] = out[t].replace(/(?<=\S)[∗†‡]/g, "");
  return { texts: out, removed: chain.length };
}

// Whole-text convenience for pasted text and text files.
// One word on screen at a time means punctuation set apart by spaces would
// flash on its own ("tolerate ,", ". . ."), and words a dash glues together
// ("government--what", "belt—one") would show as one long, shrunken word.
// The dash stays with the word before it, like a comma.
export function tidyPunctuation(text) {
  return (
    text
      // Word joiners (Standard Ebooks puts one before each dash) and the
      // "↩" links back from endnotes.
      .replace(/\u2060/gu, "")
      .replace(/[ \t]*↩\uFE0E?/gu, "")
      .replace(/\.(?:[ \t]+\.){2,3}/gu, "…")
      .replace(/(?<=\S)[ \t]+(?:--|—|–)(?=[ \t]+\S)/gu, "—")
      .replace(
        /(\p{L}[.,;:!?'’"”)\]]*)(?:--|—)[ \t]*(?=["“‘(¿¡]?\p{L})/gu,
        "$1— ",
      )
      .replace(/(?<=\S)[ \t]+([,.;:!?…»”)\]]+)(?=\s|$)/gu, "$1")
      .replace(/(^|[ \t])([(\[“«¿¡]+)[ \t]+(?=\S)/gmu, "$1$2")
  );
}

export async function repairText(text, lookup, options) {
  const normalized = tidyPunctuation(normalizeGlyphs(text));
  const map = await learnGlyphMap([normalized], lookup, options);
  const notes = stripNoteMarkers([applyGlyphMap(normalized, map)]);
  return { text: notes.texts[0], map, notes: notes.removed };
}

// Short description for status messages, e.g. "ɹ → fi, ʃ → ff".
export function describeGlyphMap(map) {
  return [...map].map(([c, l]) => `${c} → ${l}`).join(", ");
}

// Same repairs for an imported PDF, applied line by line to its page models
// so the links from words back to their place on the page stay correct.
export async function repairPdfLines(pages, lookup, options) {
  const lines = pages.flatMap((p) => p.lines);
  for (const line of lines)
    line.text = tidyPunctuation(normalizeGlyphs(line.text));
  const map = await learnGlyphMap(
    lines.map((l) => l.text),
    lookup,
    options,
  );
  for (const line of lines) line.text = applyGlyphMap(line.text, map);
  const notes = stripNoteMarkers(lines.map((l) => l.text));
  lines.forEach((line, i) => (line.text = notes.texts[i].trim()));
  return { map, notes: notes.removed };
}
