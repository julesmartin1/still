// Where a book's own text begins: past its title page, contents list and
// front matter, at the first chapter. A new reading starts there, and the
// import dialog says what comes before it, so the reader can start earlier.

// Front matter by its usual titles, in the languages Still reads.
const FRONT = new RegExp(
  "^(?:the\\s+)?(?:" +
    [
      "(?:table\\s+of\\s+)?contents",
      "preface",
      "foreword",
      "introduction",
      "introductory",
      "prefatory",
      "editor",
      "translator",
      "author['’]?s?\\s+(?:note|preface)",
      "a\\s+note\\b",
      "notes?\\s+on\\s+the",
      "dedication",
      "epigraph",
      "acknowledg",
      "about\\s+(?:the|this)\\b",
      "also\\s+by\\b",
      "by\\s+the\\s+same\\b",
      "other\\s+books\\b",
      "praise\\b",
      "copyright",
      "title\\s*page",
      "half[-\\s]?title",
      "frontispiece",
      "list\\s+of\\b",
      "illustrations",
      "(?:original\\s+)?transcriber",
      "etymology",
      "extracts",
      "chronology",
      "maps?\\b",
      "cast\\s+of\\b",
      "dramatis\\s+personae",
      "advertisement",
      "to\\s+the\\s+reader",
      "cover\\b",
      "pr[eé]face",
      "avant-propos",
      "[eé]pigraphe",
      "introducci[oó]n",
      "prefacio",
      "pr[oó]logo\\s+del?\\b",
      "nota\\s+del?\\b",
      "vorwort",
      "einleitung",
      "widmung",
      "prefazione",
      "introduzione",
      "dedica",
      "inhalt",
      "[ií]ndice",
      "sum[aá]rio",
      "sommario",
      "sommaire",
      "table\\s+des\\s+mati[eè]res",
    ].join("|") +
    ")",
  "iu",
);
const UNNAMED =
  /^(?:the\s+)?(?:cover|title\s*page|half[-\s]?title|copyright|also\s+by|by\s+the\s+same|other\s+books|praise|list\s+of|(?:table\s+of\s+)?contents|frontispiece)\b/iu;
const CONTENTS =
  /^(?:(?:table\s+of\s+)?contents|inhalt(?:sverzeichnis)?|[ií]ndice|sum[aá]rio|sommario|sommaire|table\s+des\s+mati[eè]res|contenido)\W*$/iu;
// "Chapter 1", "CHAPTER I. Loomings.", "Letter 1", "Book the First",
// "ADVENTURE I. A SCANDAL IN BOHEMIA", "One", "I.", "Prologue", "Erstes
// Kapitel": the first of the book's own parts.
const ONE =
  "(?:1|i|one|first|the\\s+first|premier|premi[eè]re|primer[oa]?|prim[oa]|primeir[oa]|erste[rs]?)";
const FIRST = new RegExp(
  `^(?:(?:chapter|part|book|letter|volume|vol\\.|canto|stave|adventure|story|tale|act|section|chapitre|partie|livre|lettre|cap[ií]tulo|capitolo|libro|parte|livro|carta|kapitel|teil|buch|brief)\\s+${ONE}(?![\\p{L}\\d])` +
    `|(?:erstes|1\\.)\\s*(?:kapitel|teil|buch)` +
    `|${ONE}(?:\\s*[.:)\\]]|\\s*$)` +
    `|pr[oó]log(?:ue|o)?(?!\\p{L}))`,
  "iu",
);
const clean = (title) => (title || "").replace(/\s+/g, " ").trim();
export const isFrontMatter = (title) => FRONT.test(clean(title));
// A numbered entry under a part keeps its part: "Part One · I".
export const isFirstPart = (title) =>
  FIRST.test(clean(title)) || FIRST.test(clean(title).split(" · ").at(-1));
const wordCount = (text) => (text.match(/\S+/g) || []).length;

// Paragraph numbers (from 1) where a book starts, by what is known of it:
// `body` is where the book says its main text starts (an EPUB's bodymatter),
// `guide` a weaker hint (an EPUB 2 guide's "text"). Without them, the first
// chapter one, or (in a book) the first section that is neither front matter
// nor hardly more than a title. Never far into the book: a "Part One" half
// way through is not where it starts.
export function findStart(
  paragraphs,
  sections = [],
  { body = 0, guide = 0, book = true } = {},
) {
  const n = paragraphs.length;
  const before = [0];
  for (const p of paragraphs) before.push(before.at(-1) + p.length);
  const total = before[n] || 1;
  const within = (paragraph, share) =>
    Number.isInteger(paragraph) &&
    paragraph >= 1 &&
    paragraph <= n &&
    before[paragraph - 1] <= total * share;
  const list = sections
    .filter((s) => within(s.paragraph, 1))
    .sort((a, b) => a.paragraph - b.paragraph);
  const words = (from, to) => {
    let count = 0;
    for (let i = from - 1; i < to - 1 && i < n; i++)
      count += wordCount(paragraphs[i]);
    return count;
  };
  let start = 1;
  // A book marked as starting on its first page says nothing.
  if (body > 1 && within(body, 0.5)) start = body;
  else {
    const first = list.find(
      (s) => within(s.paragraph, 0.3) && isFirstPart(s.title),
    );
    if (first) start = first.paragraph;
    else if (within(guide, 0.3)) start = guide;
    else if (book && list.length)
      for (let k = 0; k < list.length; k++) {
        const s = list[k];
        if (!within(s.paragraph, 0.3)) break;
        const end = list[k + 1]?.paragraph ?? n + 1;
        if (isFrontMatter(s.title) || words(s.paragraph, end) < 40) continue;
        // Past at least one opening section, or a few lines with no title
        // (a title page and dedication left out of the book's contents).
        if (
          k > 0 ||
          words(1, s.paragraph) < Math.max(100, words(1, n + 1) * 0.02)
        )
          start = s.paragraph;
        break;
      }
  }
  // Front matter before the start, by its titles in the sections or as
  // lines of their own ("ETYMOLOGY.").
  // A line is a title when short and without figures: "Copyright © 2019
  // by…" is not. Title and copyright pages go unnamed: nobody misses them.
  const named = list.filter((s) => s.paragraph < start);
  for (let i = 0; i < start - 1 && i < 3000; i++)
    if (
      paragraphs[i].length <= 60 &&
      wordCount(paragraphs[i]) <= 6 &&
      !/\d/.test(paragraphs[i])
    )
      named.push({ title: paragraphs[i], paragraph: i + 1 });
  named.sort((a, b) => a.paragraph - b.paragraph);
  const front = [];
  for (const s of named) {
    const title = displayTitle(s.title);
    if (isFrontMatter(title) && !UNNAMED.test(title) && !front.includes(title))
      front.push(title);
  }
  return {
    paragraph: start,
    title: list.find((s) => s.paragraph === start)?.title || "",
    before: front,
    // Words before the start, left for the reader to go back to.
    skipped: words(1, start),
  };
}

// "ETYMOLOGY." reads as "Etymology"; long titles are cut at a word.
export function displayTitle(title) {
  // "EXTRACTS (Supplied by a Sub-Sub-Librarian)." is the Extracts.
  let t = clean(title)
    .replace(/(?<=\S)\s*\(.*$/, "")
    .replace(/[\s.:;,]+$/, "");
  t = t.replace(/^(?:\p{Lu}[\p{Lu}'’-]+\s*)+/u, (caps) =>
    caps
      .toLowerCase()
      .replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase()),
  );
  if (t.length > 48) t = t.slice(0, 48).replace(/\s+\S*$/, "") + "…";
  return t;
}

// Indexes (from 0) of the paragraphs that make a contents list: three or
// more lines in a row that link into the book (`links[i]` says paragraph i
// is a link), or, under a "Contents" heading, short lines that name the
// book's later headings. The heading goes too. Only near the start.
export function contentsLists(paragraphs, links = []) {
  const drop = new Set();
  const n = paragraphs.length;
  let reach = 0,
    characters = 0;
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0);
  while (reach < n && characters <= total * 0.3)
    characters += paragraphs[reach++].length;
  const short = (i, max = 150) => i < n && paragraphs[i].length <= max;
  const heading = (i) => i >= 0 && CONTENTS.test(clean(paragraphs[i]));
  // Words in lower case, so "Chapter 1" is found in "CHAPTER 1." but not
  // in "Chapter 10".
  const norm = (s) =>
    ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  let headings = null;
  // Line i names a heading that comes later in the book.
  const named = (i) => {
    headings ??= paragraphs.flatMap((p, k) =>
      p.length <= 150 ? [{ k, text: norm(p) }] : [],
    );
    // Without its page number: "Loomings ....... 1".
    const entry = norm(
      paragraphs[i].replace(/(?:\s*[.…·]{2,}\s*|\s{2,})\d{1,4}$/, ""),
    );
    return (
      entry.length > 3 &&
      headings.some(
        (h) =>
          h.k > i &&
          h.text.length <= entry.length + 30 &&
          h.text.includes(entry),
      )
    );
  };
  for (let i = 0; i < reach; ) {
    // Lines that link into the book, perhaps with a short unlinked line
    // among them ("VOLUME I").
    if (links[i] && short(i)) {
      let j = i,
        linked = 0;
      while (
        j < n &&
        short(j) &&
        (links[j] || (short(j, 60) && links[j + 1] && j > i))
      )
        linked += links[j++] ? 1 : 0;
      if (linked >= 3) {
        for (let k = i; k < j; k++) drop.add(k);
        if (heading(i - 1)) drop.add(i - 1);
      }
      i = Math.max(j, i + 1);
      continue;
    }
    if (heading(i) && !links[i + 1]) {
      // Short lines under it, each naming a heading that comes later. The
      // first that doesn't ends the list: the first chapter's own heading
      // may follow straight on.
      let j = i + 1;
      while (j < n && j - i <= 400 && short(j, 100) && named(j)) j++;
      if (j - i > 3) for (let k = i; k < j; k++) drop.add(k);
      i = j;
      continue;
    }
    i++;
  }
  return drop;
}
export const isContentsTitle = (title) => CONTENTS.test(clean(title));
