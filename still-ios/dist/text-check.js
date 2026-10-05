// Spots things in imported text that would read badly one word at a time,
// so the reader can see (and usually fix) them before starting.
//
// checkText(text) returns findings, most important first:
//   { id, message, count, ranges: [[start, end], ...], fix?: (text) => text }
// `ranges` are character offsets of up to 20 examples, for "Show".

const MAX_EXAMPLES = 20;

function collect(text, regex, keep = () => true) {
  const ranges = [];
  let count = 0;
  for (const m of text.matchAll(regex)) {
    if (!keep(m)) continue;
    count++;
    if (ranges.length < MAX_EXAMPLES)
      ranges.push([m.index, m.index + m[0].length]);
  }
  return { count, ranges };
}

// Lines inside paragraphs: text copied from a PDF or a plain-text book keeps
// its printed line breaks. Still treats a blank line as a paragraph break,
// so a wrapped book either becomes a few giant paragraphs or (if every line
// is separated) hundreds of fragments.
export function wrappedLines(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const filled = lines.filter((l) => l.trim());
  if (filled.length < 12) return false;
  const lengths = filled.map((l) => l.trim().length).sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length * 0.75)];
  // Many lines of similar, moderate length that don't end sentences.
  const wrapped = filled.filter(
    (l) => l.trim().length >= typical * 0.8 && !/[.!?:;"”’)\]]$/.test(l.trim()),
  ).length;
  return typical >= 35 && typical <= 110 && wrapped / filled.length > 0.35;
}

// Joins printed lines back into paragraphs. A line ends a paragraph when it
// ends a sentence and is noticeably short, or when a blank line follows.
export function rejoinLines(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const filled = lines.filter((l) => l.trim());
  const lengths = filled.map((l) => l.trim().length).sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length * 0.75)] || 60;
  const paragraphs = [];
  let current = "";
  const end = () => {
    if (current.trim()) paragraphs.push(current.trim());
    current = "";
  };
  let gap = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      gap = true;
      continue;
    }
    // A blank line ends the paragraph unless the sentence plainly carries on
    // (a page break in the middle of a sentence).
    if (gap) {
      gap = false;
      const carriesOn = /[\p{L},;—–-]$/u.test(current) && /^\p{Ll}/u.test(line);
      if (!carriesOn) end();
    }
    const headingLike =
      line.length <= 40 &&
      /^[\p{Lu}\d]/u.test(line) &&
      !/[,;:—–.!?-]$/.test(line);
    if (headingLike && /[.!?"”’)\]…]$/.test(current)) end();
    if (
      current.endsWith("-") &&
      /^\p{Ll}/u.test(line) &&
      /\p{L}-$/u.test(current)
    )
      current = current.slice(0, -1) + line; // re-join a hyphenated word
    else current += (current ? " " : "") + line;
    const short = line.length < typical * 0.75;
    if (short && /[.!?:"”’)\]…]$/.test(line)) end();
    // A short line that doesn't end a sentence is usually a heading or date.
    else if (short && line.length <= 40 && /^[\p{Lu}\d]/u.test(line)) end();
  }
  end();
  return paragraphs.join("\n\n");
}

// Markdown: notes and drafts often carry #, **, - and [links](...), which
// would otherwise be shown as words. These patterns only match Markdown's own
// syntax, so ordinary punctuation (a dash mid-sentence, a lone asterisk,
// snake_case) is left alone.
const MD_FENCE = /^[ \t]*(?:```|~~~).*$/gmu;
const MD_HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(?=\S)/gmu;
const MD_RULE =
  /^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|=+)[ \t]*$/gmu;
const MD_QUOTE = /^[ \t]{0,3}>[ \t]?/gmu;
const MD_BULLET = /^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?(?=\S)/gmu;
const MD_TABLE_RULE =
  /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gmu;
const MD_IMAGE = /!\[([^\]\n]*)\]\([^)\n]*\)/gu;
const MD_LINK = /\[([^\]\n]+)\](?:\([^)\n]*\)|\[[^\]\n]*\])/gu;
const MD_LINK_DEF = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]+\S+.*$/gmu;
const MD_AUTOLINK = /<((?:https?:\/\/|mailto:)[^>\s]+)>/gu;
const MD_CODE = /`+([^`\n]+?)`+/gu;
const MD_STRONG = /(\*\*|__)(?=\S)([^\n]+?)(?<=\S)\1/gu;
const MD_EMPHASIS =
  /(?<![\p{L}\d*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\p{L}\d*])|(?<![\p{L}\d_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\p{L}\d_])/gu;
const MD_STRIKE = /~~(?=\S)([^\n]+?)(?<=\S)~~/gu;

export function markdownSymbols(text) {
  const kinds = [
    MD_FENCE,
    MD_HEADING,
    MD_QUOTE,
    MD_TABLE_RULE,
    MD_IMAGE,
    MD_LINK,
    MD_CODE,
    MD_STRONG,
    MD_EMPHASIS,
    MD_STRIKE,
  ];
  const found = [];
  for (const regex of kinds) found.push(...collect(text, regex).ranges);
  const bullets = collect(text, MD_BULLET);
  const count = found.length;
  // Bullets alone are common in plain text; count them once something
  // plainly Markdown is there too.
  if (!count) return { count: 0, ranges: [] };
  const ranges = [...found, ...bullets.ranges]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_EXAMPLES);
  return { count: count + bullets.count, ranges };
}

// Removes Markdown syntax and keeps the words: "## Notes" becomes "Notes",
// "[the paper](https://...)" becomes "the paper", "**very**" becomes "very".
export function stripMarkdown(text) {
  // A backslash escapes punctuation in Markdown ("\\*" means "*"). Hide
  // escaped characters while the syntax is removed, then put them back.
  const escaped = [];
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>|~])/gu, (_, c) => {
      escaped.push(c);
      return "\uE000";
    });
  let i = 0;
  return (
    lines
      .replace(MD_FENCE, "")
      .replace(MD_LINK_DEF, "")
      .replace(MD_TABLE_RULE, "")
      .replace(MD_RULE, "")
      .replace(MD_HEADING, "")
      .replace(/^([^\n]*?)[ \t]+#+[ \t]*$/gmu, (line, body) =>
        /\S/.test(body) ? body : line,
      )
      .replace(MD_QUOTE, "")
      .replace(MD_BULLET, "")
      // Table rows: "| a | b |" reads as "a, b".
      .replace(/^[ \t]*\|(.*\|.*)\|[ \t]*$/gmu, (_, row) =>
        row
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join(", "),
      )
      .replace(MD_IMAGE, "$1")
      .replace(MD_LINK, "$1")
      .replace(MD_AUTOLINK, "$1")
      .replace(MD_CODE, "$1")
      .replace(MD_STRONG, "$2")
      .replace(MD_STRIKE, "$1")
      .replace(MD_EMPHASIS, (_, a, b) => a ?? b)
      .replace(/\uE000/gu, () => escaped[i++])
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function checkText(text) {
  const findings = [];
  if (!text.trim()) return findings;

  const odd = collect(text, /\S*[ɐ-ʯ-�\u0000-\u0008\u000e-\u001f]\S*/gu);
  if (odd.count)
    findings.push({
      id: "odd",
      message: `${odd.count} ${odd.count === 1 ? "word has" : "words have"} unusual characters, often letters the file labelled wrongly.`,
      ...odd,
    });

  if (wrappedLines(text))
    findings.push({
      id: "wrapped",
      message:
        "The text keeps its printed line breaks, so paragraphs may be split or run together.",
      count: 1,
      ranges: [],
      fix: rejoinLines,
      fixLabel: "Rejoin lines",
    });

  const markdown = markdownSymbols(text);
  if (markdown.count >= 3)
    findings.push({
      id: "markdown",
      message: `${markdown.count} Markdown ${markdown.count === 1 ? "mark" : "marks"} (like #, ** or [links]) would be shown as words.`,
      ...markdown,
      fix: stripMarkdown,
      fixLabel: "Remove the symbols",
    });

  const pageNumbers = collect(text, /^[ \t]*(?:page\s+)?\d{1,4}[ \t]*$/gimu);
  if (pageNumbers.count >= 3)
    findings.push({
      id: "pages",
      message: `${pageNumbers.count} lines are just a number, probably page numbers.`,
      ...pageNumbers,
      fix: (t) =>
        t.replace(/^[ \t]*(?:page\s+)?\d{1,4}[ \t]*(?:\r?\n|$)/gimu, ""),
      fixLabel: "Remove them",
    });

  // Short lines repeated many times: running headers and footers.
  const counts = new Map();
  for (const m of text.matchAll(/^[ \t]*(\S[^\n]{2,60}?)[ \t]*$/gmu)) {
    const key = m[1].replace(/\d+/g, "#");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const MONTH =
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
  const repeated = [...counts].filter(
    ([k, n]) =>
      n >= 6 && (k.match(/\p{L}/gu) || []).length >= 6 && !MONTH.test(k),
  );
  if (repeated.length) {
    const keys = new Set(repeated.map(([k]) => k));
    const isHeader = (line) => keys.has(line.trim().replace(/\d+/g, "#"));
    const found = collect(text, /^[^\n]+$/gmu, (m) => isHeader(m[0]));
    findings.push({
      id: "headers",
      message: `${found.count} repeated lines look like page headers, such as “${repeated[0][0].replace(/#/g, "1").slice(0, 40)}”.`,
      ...found,
      fix: (t) =>
        t
          .split("\n")
          .filter((line) => !isHeader(line))
          .join("\n"),
      fixLabel: "Remove them",
    });
  }

  const split = collect(text, /\p{L}+-[ \t]+\p{Ll}+/gu);
  if (split.count >= 3)
    findings.push({
      id: "split",
      message: `${split.count} words look split by a line-end hyphen, like “exam- ple”.`,
      ...split,
    });

  const long = collect(text, /[^\s—–-]{30,}/gu, (m) => !/^https?:/i.test(m[0]));
  if (long.count)
    findings.push({
      id: "long",
      message: `${long.count} very long ${long.count === 1 ? "word" : "words"}, often words run together without spaces.`,
      ...long,
    });

  const glued = collect(text, /(?<![\p{L}\d])\p{Ll}{3,}\d{1,3}(?![\p{L}\d])/gu);
  if (glued.count >= 3)
    findings.push({
      id: "notes",
      message: `${glued.count} words end in a number, probably note markers.`,
      ...glued,
      fix: (t) =>
        t.replace(/(?<![\p{L}\d])(\p{Ll}{3,})\d{1,3}(?![\p{L}\d])/gu, "$1"),
      fixLabel: "Remove the numbers",
    });

  return findings;
}
