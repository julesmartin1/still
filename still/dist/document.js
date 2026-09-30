import { parseText } from "./engine.js";
export const documentTypes = ["book", "academic", "other"];
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
  parsed.paragraphs.forEach((p, i) => {
    const first = p.trim().split("\n")[0].trim();
    const book =
      /^(?:chapter\s+(?:\d+|[IVXLCDM]+|[A-Za-z]+)|prologue|epilogue|part\s+(?:\d+|[IVXLCDM]+|[A-Za-z]+))\b/i;
    const paper =
      /^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:abstract|introduction|background|literature review|methods?|methodology|materials(?: and methods)?|results|discussion|conclusions?|references|bibliography|acknowledg(?:e)?ments?|appendix)\b/i;
    if (
      first.length <= 130 &&
      (type === "book"
        ? book
        : type === "academic"
          ? paper
          : new RegExp(book.source + "|" + paper.source, "i")
      ).test(first)
    )
      result.push({ title: first.slice(0, 120), paragraph: i + 1 });
  });
  return result.slice(0, 200);
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
