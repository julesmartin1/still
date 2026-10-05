import { parseText } from "./engine.js";
export const documentTypes = ["book", "academic", "other"];
// "Chapter 8 At five o'clock…": a chapter number run straight into the first
// sentence (a capitalised word, then a lower-case one), not a titled heading
// like "CHAPTER 2. The Carpet-Bag." or "CHAPTER V. Advice from a Caterpillar".
export const RUN_IN =
  /^(?:chapter|part|book|letter)\s+[\p{L}\d]+\s+\p{Lu}\p{Ll}*\s+\p{Ll}/iu;
export function inferType(text) {
  const sample = text.slice(0, 22000);
  if (
    /\babstract\b/i.test(sample) &&
    /\b(?:references|bibliography|doi|methodology|methods)\b/i.test(text)
  )
    return "academic";
  if (/(?:^|\n)\s*(?:chapter|prologue|epilogue)\b/im.test(text)) return "book";
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
  const result = [];
  const number =
    "(?:\\d+|[IVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|the\\s+(?:first|last))";
  const book = new RegExp(
    `^(?:(?:chapter|part|book|letter)\\s+${number}|prologue|epilogue)\\b`,
    "i",
  );
  const paper =
    /^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:abstract|introduction|background|literature review|methods?|methodology|materials(?: and methods)?|results|discussion|conclusions?|references|bibliography|acknowledg(?:e)?ments?|appendix)\b/i;
  const pattern =
    type === "book"
      ? book
      : type === "academic"
        ? paper
        : new RegExp(book.source + "|" + paper.source, "i");
  // "Chapter 1 ....... 5": a contents entry, not the chapter itself.
  const contents = /(?:\s?[.…·]){4,}\s?(?:\d{1,4}|[ivxlcdm]{1,7})\s*$/i;
  parsed.paragraphs.forEach((p, i) => {
    const first = p.trim().split("\n")[0].trim();
    // Headings start with a capital or a number; a paragraph that starts
    // "part of the…" or "method provides…" is running text.
    if (!/^[\p{Lu}\d]/u.test(first) || contents.test(first)) return;
    let title = first.length <= 130 ? first : "";
    if (title && !pattern.test(title)) return;
    // A heading run into its first sentence ("Chapter 8 At five o'clock…",
    // or any heading that opens a long paragraph) is titled by its number.
    if (!title || RUN_IN.test(title)) {
      // Straight into a capitalised word or a quotation: "Chapter 2 Mr.
      // Bennet…", not "BOOK I. (Folio), CHAPTER I. (Sperm Whale).—This…"
      const number = /^\s+["“‘]?\p{Lu}/u.test(first.replace(book, ""))
        ? first.match(book)
        : null;
      if (!number || type === "academic") return;
      title = number[0];
    }
    result.push({
      title: title.slice(0, 120),
      paragraph: i + 1,
      alone: p.trim() === first && title === first,
    });
  });
  // A contents list without dot leaders: three or more headings, each a
  // paragraph of its own, one straight after another with no text between.
  // The chapters themselves come later.
  const listed = new Set();
  for (let i = 0; i < result.length; ) {
    let j = i;
    while (
      j + 1 < result.length &&
      result[j].alone &&
      result[j + 1].alone &&
      result[j + 1].paragraph === result[j].paragraph + 1
    )
      j++;
    if (j - i >= 2) for (let k = i; k <= j; k++) listed.add(k);
    i = j + 1;
  }
  return result
    .filter((_, i) => !listed.has(i))
    .slice(0, 200)
    .map(({ title, paragraph }) => ({ title, paragraph }));
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
