import { cleanWord, clamp } from "./engine.js";
export function buildParagraphIndex(tokens) {
  const groups = [];
  for (const token of tokens) (groups[token.paragraph] ||= []).push(token);
  return groups;
}
export function paragraphStart(groups, number) {
  if (!Number.isInteger(number) || number < 1 || number > groups.length)
    return null;
  return groups[number - 1][0].index;
}
export function findPassages(groups, query, limit = 20) {
  const needle = query
    .trim()
    .split(/\s+/)
    .map(cleanWord)
    .filter(Boolean)
    .join(" ");
  if (!needle) return [];
  const result = [];
  for (let paragraph = 0; paragraph < groups.length; paragraph++) {
    const tokens = groups[paragraph];
    const normalized = tokens.map((t) => t.norm).join(" ");
    const match = normalized.indexOf(needle);
    if (match < 0) continue;
    const wordOffset = normalized.slice(0, match).split(" ").length - 1;
    const token = tokens[clamp(wordOffset, 0, tokens.length - 1)];
    const start = Math.max(0, wordOffset - 5),
      end = Math.min(tokens.length, wordOffset + 12);
    result.push({
      paragraph,
      index: token.index,
      excerpt:
        (start ? "… " : "") +
        tokens
          .slice(start, end)
          .map((t) => t.text)
          .join(" ") +
        (end < tokens.length ? " …" : ""),
    });
    if (result.length >= limit) break;
  }
  return result;
}
