import { sentenceEnd } from "./engine.js";
export function previousSentence(tokens, index) {
  if (!tokens.length || index <= 0) return 0;
  const end = (t) =>
    sentenceEnd.test(t.text) &&
    !/^(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|e\.g|i\.e)\.$/i.test(t.text) &&
    !/^\p{L}\.$/u.test(t.text);
  let start = index;
  while (
    start > 0 &&
    tokens[start - 1].paragraph === tokens[index].paragraph &&
    !end(tokens[start - 1])
  )
    start--;
  if (start < index) return start;
  let previous = Math.max(0, start - 1);
  while (
    previous > 0 &&
    tokens[previous - 1].paragraph === tokens[previous].paragraph &&
    !end(tokens[previous - 1])
  )
    previous--;
  return previous;
}
export function normalizeMarks(marks, max) {
  return Array.isArray(marks)
    ? marks
        .filter(
          (m) =>
            m &&
            typeof m.id === "string" &&
            Number.isInteger(m.start) &&
            Number.isInteger(m.end) &&
            m.start >= 0 &&
            m.end >= m.start &&
            m.end < max &&
            typeof m.quote === "string",
        )
        .slice(0, 1000)
        .map((m) => ({
          id: m.id,
          start: m.start,
          end: m.end,
          quote: m.quote.slice(0, 20000),
          note: typeof m.note === "string" ? m.note.slice(0, 4000) : "",
          createdAt: Number(m.createdAt) || Date.now(),
        }))
    : [];
}
export function shelfMatches(record, query, view) {
  const state = record.shelfState || "active";
  return (
    state === view &&
    record.title.toLowerCase().includes(query.trim().toLowerCase())
  );
}
