import { isSentenceEnd as end } from "./engine.js";
export function previousSentence(tokens, index) {
  if (!tokens.length || index <= 0) return 0;
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
// Start of the next sentence after `index` (the last word if there is none).
// Paragraph ends count as sentence ends.
export function nextSentence(tokens, index) {
  if (!tokens.length) return 0;
  let i = Math.max(0, index);
  while (
    i < tokens.length - 1 &&
    tokens[i + 1].paragraph === tokens[i].paragraph &&
    !end(tokens[i])
  )
    i++;
  return Math.min(tokens.length - 1, i + 1);
}
