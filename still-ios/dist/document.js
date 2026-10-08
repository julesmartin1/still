import { parseText } from "./engine.js";
export const documentTypes = ["book", "academic", "other"];
// Words that open a chapter heading, in English, French, Spanish, Italian,
// German and Portuguese.
const CHAPTER =
  "chapter|part|book|letter|chapitre|partie|livre|cap[ií]tulo|capitolo|libro|parte|livro|kapitel|teil|buch";
// "Chapter 8 At five o'clock…": a chapter number run straight into the first
// sentence (a capitalised word, then a lower-case one), not a titled heading
// like "CHAPTER 2. The Carpet-Bag." or "CHAPTER V. Advice from a Caterpillar".
export const RUN_IN = new RegExp(
  `^(?:${CHAPTER})\\s+[\\p{L}\\d]+\\s+\\p{Lu}\\p{Ll}*\\s+\\p{Ll}`,
  "iu",
);
// Figures, roman numerals, and number words: "Chapter One", "Chapitre
// premier", "Livre troisième", "Libro segundo", "Capitolo primo".
const NUMBER =
  "(?:\\d+|[IVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|the\\s+(?:first|last)" +
  "|premi[eè]re?|seconde?|derni[eè]re?|\\p{L}+i[eè]me" +
  "|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|s[eé]ptim[oa]|octav[oa]|noven[oa]|d[eé]cim[oa]|[uú]ltim[oa]" +
  "|prim[oa]|second[oa]|terz[oa]|quart[oa]|sest[oa]|settim[oa]|ottav[oa]|non[oa]|primeir[oa]|terceir[oa]|s[eé]tim[oa]|oitav[oa])";
// German puts the number first: "Erstes Kapitel", "2. Teil".
const BOOK = new RegExp(
  `^(?:(?:${CHAPTER})\\s+${NUMBER}|(?:(?:erst|zweit|dritt|viert|fünft|sechst|siebt|siebent|acht|neunt|zehnt|letzt)e[rs]?|(?:\\d+|[IVXLC]+)\\.)\\s*(?:kapitel|teil|buch)|pr[oó]log(?:ue|o)|[eé]p[ií]log(?:ue|o))(?![\\p{L}\\d])`,
  "iu",
);
// "Chapter 3", "CHAPITRE XXXVI.", "Prologue in Heaven". A keyword that runs
// on in lower case is a sentence unless the line is short and unpunctuated:
// "Epilogue to Beaumont and Fletcher's Honest Man's Fortune." credits an
// epigraph. A roman numeral after a word in another language must be in
// capitals, since "Parte di Roma" and "Teil im Ganzen" are sentences.
// In `prose`, a chapter mentioned in a sentence ("Chapter 3 is about…")
// still counts.
export function bookHeading(line, prose = false) {
  const match = BOOK.exec(line);
  if (!match || !/^[\p{Lu}\d]/u.test(line)) return null;
  const roman = /\s([ivxlcdm]+)$/i.exec(match[0])?.[1];
  if (
    roman &&
    roman !== roman.toUpperCase() &&
    !/^(?:chapter|part|book|letter)\s/i.test(line)
  )
    return null;
  if (
    !(prose && !/^(?:pr|[eé]p)/i.test(line)) &&
    /^\s+\p{Ll}/u.test(line.slice(match[0].length)) &&
    (line.split(/\s+/).length > 5 || /[.,;:]$/.test(line))
  )
    return null;
  return match;
}
// A short line set like a title, not a sentence: in capitals, in title case
// ("Of Unity in Religion") or in Gutenberg's _italics_.
function titleLike(line) {
  const plain = line.replace(/^_(.+)_$/, "$1");
  const words = plain.split(/\s+/);
  return (
    line.length <= 70 &&
    words.length <= 10 &&
    /^[\p{Lu}\d]/u.test(plain) &&
    !/[,;:—–-]$/.test(plain) &&
    (plain !== line ||
      !/\p{Ll}/u.test(plain) ||
      words.every(
        (w) => (w.match(/\p{L}/gu) || []).length < 4 || /^\P{Ll}/u.test(w),
      ))
  );
}
export function inferType(text) {
  const sample = text.slice(0, 22000);
  if (
    /\babstract\b/i.test(sample) &&
    /\b(?:references|bibliography|doi|methodology|methods)\b/i.test(text)
  )
    return "academic";
  for (const [line] of text.matchAll(
    /^[ \t]*(?:chapter|chapitre|cap[ií]tulo|capitolo|kapitel|pr[oó]log|[eé]p[ií]log|\p{L}+[ \t]+kapitel)[^\n]*/gimu,
  ))
    if (bookHeading(line.trim(), true)) return "book";
  return "other";
}
export function suggestTitle({
  metadata = "",
  pages = [],
  filename = "Untitled reading",
}) {
  const clean = (s) =>
    s
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const title = clean(metadata);
  if (
    title.length >= 6 &&
    title.length <= 240 &&
    !/^(?:untitled|microsoft|document|word\b|[\w-]+\.pdf$)/i.test(title) &&
    !/^\d|^1-s2\./.test(title)
  )
    return title.slice(0, 240);
  const lines = pages[0]?.lines || [];
  const candidates = lines.filter(
    (l) =>
      l.text.length >= 12 &&
      l.text.length <= 160 &&
      l.y > (pages[0]?.height || 792) * 0.45 &&
      !/https?:|www\.|doi|copyright|elsevier|contents lists|journal homepage|volume|article history/i.test(
        l.text,
      ),
  );
  const longest = candidates.filter(
    (l) =>
      l.text.split(/\s+/).length >= 4 &&
      l.height >= Math.max(0, ...candidates.map((c) => c.height)) * 0.85,
  );
  const lead = (longest.length ? longest : candidates).sort(
    (a, b) => b.height - a.height || b.y - a.y,
  )[0];
  if (lead) {
    const at = lines.indexOf(lead),
      next = lines[at + 1];
    return clean(
      lead.text +
        (next &&
        Math.abs(next.height - lead.height) < lead.height * 0.15 &&
        lead.y - next.y > 0 &&
        lead.y - next.y < lead.height * 2
          ? " " + next.text
          : ""),
    ).slice(0, 240);
  }
  return (
    clean(filename.replace(/\.pdf$/i, "").replace(/_/g, " ")).slice(0, 240) ||
    "Untitled reading"
  );
}
export function detectSections(text, type = "other") {
  const parsed = parseText(text);
  const paragraphs = parsed.paragraphs.map((p) => p.trim());
  const result = [];
  const paper =
    /^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:abstract|introduction|background|literature review|methods?|methodology|materials(?: and methods)?|results|discussion|conclusions?|references|bibliography|acknowledg(?:e)?ments?|appendix)\b/i;
  const heading = (line) =>
    (type !== "academic" && bookHeading(line)) ||
    (type !== "book" && paper.exec(line));
  // "Chapter 1 ....... 5" or "CHAPITRE IV.--De la diuersion.      158": a
  // contents entry, not the chapter itself.
  const contents = (line) => {
    const spaced = /^(.*\S)[ \t]{3,}(?:\d{1,4}|[ivxlcdm]{1,7})\s*$/i.exec(line);
    return (
      /(?:\s?[.…·]){4,}\s?(?:\d{1,4}|[ivxlcdm]{1,7})\s*$/i.test(line) ||
      (spaced && spaced[1].trim().split(/\s+/).length >= 3)
    );
  };
  paragraphs.forEach((p, i) => {
    const lines = p.split("\n");
    const first = lines[0].trim();
    // Headings start with a capital or a number; a paragraph that starts
    // "part of the…" or "method provides…" is running text.
    if (!/^[\p{Lu}\d]/u.test(first)) return;
    // The page number of an entry that wraps comes after its last line.
    const tail = p.slice(-200).replace(/[ \t]*\n[ \t]*/g, " ");
    if (contents(first) || contents(tail)) {
      if (heading(first)) result.push({ paragraph: i + 1, contents: true });
      return;
    }
    let title = first.length <= 130 ? first : "";
    const match = title && heading(title);
    if (title && !match) return;
    // A heading run into its first sentence ("Chapter 8 At five o'clock…",
    // or any heading that opens a long paragraph) is titled by its number.
    if (!title || RUN_IN.test(title)) {
      // Straight into a capitalised word or a quotation: "Chapter 2 Mr.
      // Bennet…", not "BOOK I. (Folio), CHAPTER I. (Sperm Whale).—This…"
      const number = /^\s+["“‘]?\p{Lu}/u.test(first.replace(BOOK, ""))
        ? bookHeading(first)
        : null;
      if (!number || type === "academic") return;
      title = number[0];
    }
    const alone = p === first && title === first;
    let end = i + 1;
    // "CHAPTER X" with its name in the next paragraph, "OF MANAGING THE
    // WILL" or "_Des plus excellens hommes._", takes the name along.
    const next = paragraphs[i + 1];
    const named = alone && bookHeading(title);
    if (
      named &&
      /^[\s.:]*$/.test(title.slice(named[0].length)) &&
      next &&
      !next.includes("\n") &&
      (titleLike(next) ||
        // A Gutenberg name once its italics are removed: "Des plus
        // excellens hommes." standing alone before the chapter's prose.
        (/^\p{Lu}[^.!?]*\.$/u.test(next) &&
          next.split(/\s+/).length <= 6 &&
          (paragraphs[i + 2] || "").split(/\s+/).length >= 30)) &&
      !heading(next)
    ) {
      title = `${title.replace(/[\s.:]*$/, ".")} ${next.replace(/^_(.+)_$/, "$1")}`;
      end++;
    }
    result.push({ title: title.slice(0, 120), paragraph: i + 1, end, alone });
  });
  // With fewer than three headings found, look for a run of untitled ones.
  if (type !== "academic" && result.filter((r) => !r.contents).length < 3) {
    const words = paragraphs.map(() => 0);
    for (const t of parsed.tokens) words[t.paragraph]++;
    result.push(...titleRuns(paragraphs, words));
    result.sort((a, b) => a.paragraph - b.paragraph);
  }
  // A contents list without dot leaders: three or more headings, each a
  // paragraph of its own, one straight after another with no text between.
  // The chapters themselves come later. A heading just before a contents
  // entry ("LIVRE TROISIÈME." above its chapters' page numbers) is part of
  // the list too.
  const listed = new Set();
  for (let i = 0; i < result.length; ) {
    let j = i;
    while (
      j + 1 < result.length &&
      result[j].alone &&
      result[j + 1].alone &&
      result[j + 1].paragraph === result[j].end + 1
    )
      j++;
    if (j - i >= 2) for (let k = i; k <= j; k++) listed.add(k);
    i = j + 1;
  }
  result.forEach((r, i) => {
    const next = result[i + 1];
    if (r.contents || (next?.contents && next.paragraph - r.paragraph <= 3))
      listed.add(i);
  });
  return result
    .filter((_, i) => !listed.has(i))
    .slice(0, 200)
    .map(({ title, paragraph }) => ({ title, paragraph }));
}
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const romanValue = (s) =>
  [...s].reduce(
    (sum, c, i) =>
      sum + (ROMAN[c] < (ROMAN[s[i + 1]] || 0) ? -1 : 1) * ROMAN[c],
    0,
  );
// Chapters with no word like "Chapter": bare numerals ("I", "II", or "I.
// HISTORY."), essay titles that open the same way ("Of Truth", "Of Death"),
// or titles in capitals ("SELF-RELIANCE."). Each stands alone, is followed
// by real text, and the kind comes three or more times, so a stray "I" or a
// line in capitals is never a chapter.
function titleRuns(paragraphs, words) {
  const kinds = { numbered: [], of: [], capitals: [] };
  paragraphs.forEach((p, i) => {
    if (p.includes("\n") || p.length > 80) return;
    const numeral = /^([IVXLC]+)(?:\.?|\.\s+(\S.*))$/u.exec(p);
    if (numeral && (!numeral[2] || titleLike(numeral[2])))
      kinds.numbered.push({ i, value: romanValue(numeral[1]) });
    else if (!titleLike(p)) return;
    else if (/^(?:of|on)\s/i.test(p)) kinds.of.push({ i });
    else if (!/[\p{Ll}\d]/u.test(p) && /(?:\p{Lu}.*){3}/u.test(p))
      kinds.capitals.push({ i });
  });
  // Words before each paragraph, to count the text between two lines.
  const before = [0];
  words.forEach((n, i) => before.push(before[i] + n));
  const between = (a, b) => before[b] - before[a + 1];
  for (const [kind, found] of Object.entries(kinds)) {
    // Real text after each one, and none directly before: the end of a
    // contents list is not a chapter.
    let kept = found.filter(
      (f, k) =>
        between(f.i, found[k + 1]?.i ?? paragraphs.length) >= 100 &&
        (k === 0 || between(found[k - 1].i, f.i) > 0),
    );
    if (kind === "numbered") {
      // Numerals count up one at a time, I, II, III, perhaps starting again
      // at I for a new part.
      const chains = [];
      for (const f of kept) {
        const chain = chains.findLast((c) => c.at(-1).value === f.value - 1);
        if (chain) chain.push(f);
        else chains.push([f]);
      }
      kept = chains
        .filter((c) => c.length >= 3)
        .flat()
        .sort((a, b) => a.i - b.i);
    } else {
      // A title comes once (a name that keeps coming back is a speaker in a
      // play), and the titles share one style: "OF FRANCIS Ld. VERULAM" on
      // the title page is not one of the "Of Truth" essays.
      const count = new Map();
      for (const { i } of kept)
        count.set(paragraphs[i], (count.get(paragraphs[i]) || 0) + 1);
      kept = kept.filter(({ i }) => count.get(paragraphs[i]) === 1);
      const capitals = kept.filter(({ i }) =>
        /^\S+\s+\P{Ll}+(?:\s|$)/u.test(paragraphs[i]),
      );
      kept =
        capitals.length * 2 > kept.length
          ? capitals
          : kept.filter((f) => !capitals.includes(f));
    }
    // Chapters run through the book, from its first half on: not a handful
    // of lines in capitals scattered through a long manual.
    if (
      kept.length >= 3 &&
      before.at(-1) / kept.length <= 20000 &&
      before[kept[0].i] <= before.at(-1) / 2
    )
      return kept.map(({ i }) => ({
        title: paragraphs[i].slice(0, 120),
        paragraph: i + 1,
        end: i + 1,
        alone: true,
      }));
  }
  return [];
}
export function paragraphAnchor(text, number) {
  const data = parseText(text);
  return data.tokens.find((t) => t.paragraph === number - 1)?.index ?? 0;
}
export function normalizeSections(sections, text) {
  const max = parseText(text).paragraphs.length;
  return Array.isArray(sections)
    ? sections
        .filter(
          (s) =>
            s &&
            typeof s.title === "string" &&
            Number.isInteger(s.paragraph) &&
            s.paragraph >= 1 &&
            s.paragraph <= max,
        )
        .slice(0, 200)
        .map((s) => ({ title: s.title.slice(0, 120), paragraph: s.paragraph }))
    : [];
}
export async function fileFingerprint(file) {
  const bytes = await file.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
