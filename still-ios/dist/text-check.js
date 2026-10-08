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
// snake_case) is left alone. Links and emphasis may wrap onto the next line
// ("\n(?![ \t\r]*\n)" below), but never across a blank line.
//
// Front matter: a "---" (YAML) or "+++" (TOML) block of "key: value" lines
// at the very top, which blogs and note apps use for the title and date.
const MD_FRONT_MATTER =
  /^\s*(---|\+\+\+)[ \t]*\n[\w.-]+[ \t]*[:=][^\n]*\n(?:[ \t]*\S[^\n]*\n)*?(?:\1|\.\.\.)[ \t]*(?:\n|$)/gu;
const MD_FENCE = /^[ \t]*(?:```|~~~).*$/gmu;
const MD_HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(?=\S)/gmu;
const MD_RULE =
  /^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|=+)[ \t]*$/gmu;
// "> quote", also nested ("> > ") or inside a list item ("1. > ", "    > ").
const MD_QUOTE = /^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(?:>[ \t]?)+/gmu;
const MD_BULLET = /^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?(?=\S)/gmu;
const MD_TABLE_RULE =
  /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gmu;
// Link targets may hold one level of brackets: (https://w.org/wiki/A_(b)).
const MD_IMAGE =
  /!\[((?:[^\]\n]|\n(?![ \t\r]*\n))*)\]\((?:[^()\n]|\n(?![ \t\r]*\n)|\([^()\n]*\))*\)/gu;
const MD_LINK =
  /\[((?:[^[\]\n]|\n(?![ \t\r]*\n))+)\](?:\((?:[^()\n]|\n(?![ \t\r]*\n)|\([^()\n]*\))*\)|\[[^\]\n]*\])/gu;
const MD_LINK_DEF = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]+\S+.*$/gmu;
const MD_AUTOLINK = /<((?:https?:\/\/|mailto:)[^>\s]+)>/gu;
const MD_CODE = /`+([^`\n]+?)`+/gu;
const MD_STRONG = /(\*\*|__)(?=\S)((?:[^\n]|\n(?![ \t\r]*\n))+?)(?<=\S)\1/gu;
// _italics_ must hold a letter, so "__init__"-like runs and blanks ("_ _")
// stay. Plain-text books from Project Gutenberg mark italics this way too.
const MD_UNDERSCORE =
  /(?<![\p{L}\d_])_(?=[^\s_])(?=[^_]*?\p{L})((?:[^_\n]|\n(?![ \t\r]*\n))+?)(?<=[^\s_])_(?![\p{L}\d_])/gu;
const MD_EMPHASIS = new RegExp(
  /(?<![\p{L}\d*])\*(?=[^\s*])((?:[^*\n]|\n(?![ \t\r]*\n))+?)(?<=[^\s*])\*(?![\p{L}\d*])/
    .source +
    "|" +
    MD_UNDERSCORE.source,
  "gu",
);
const MD_STRIKE = /~~(?=\S)((?:[^\n]|\n(?![ \t\r]*\n))+?)(?<=\S)~~/gu;
// Footnotes: "year.[^1]" in the text, "[^1]: The note." at the end.
const MD_FOOTNOTE_REF = /\[\^[^\]\s]+\](?!:)/gu;
const MD_FOOTNOTE_DEF = /^[ \t]{0,3}\[\^[^\]\s]+\]:[ \t]*/gmu;
// HTML and blog templates mixed into Markdown: <!--more-->, {% include %},
// {{ page.title }}, embeds with <script>, and tags around words.
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;
const TEMPLATE_TAG = /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/gu;
const HTML_SCRIPT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
// Only real tag names, so "if x<y and y>z" is left alone.
const HTML_TAG =
  /<\/?(a|abbr|article|aside|audio|b|big|blockquote|br|caption|center|cite|code|dd|del|details|div|dl|dt|em|figcaption|figure|font|footer|h[1-6]|header|hr|i|iframe|img|ins|kbd|li|mark|nav|ol|p|picture|pre|q|s|section|small|source|span|strike|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|time|tr|tt|u|ul|video|wbr)\b(?:[^<>"']|"[^"]*"|'[^']*')*\/?>/giu;
const HTML_BLOCK =
  /^(?:article|aside|blockquote|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|nav|ol|p|pre|section|summary|table|tr|ul)$/iu;
const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
};

function decodeEntities(text) {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z]+));/gu,
    (entity, dec, hex, name) => {
      if (name) return ENTITIES[name] ?? entity;
      const code = dec ? Number(dec) : parseInt(hex, 16);
      if (code === 160) return " ";
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

export function markdownSymbols(text) {
  const syntax = [
    MD_FRONT_MATTER,
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
    MD_FOOTNOTE_REF,
    HTML_COMMENT,
    TEMPLATE_TAG,
  ];
  const found = [];
  let count = 0;
  for (const regex of syntax) {
    const marks = collect(text, regex);
    count += marks.count;
    found.push(...marks.ranges);
  }
  const bullets = collect(text, MD_BULLET);
  // Bullets alone are common in plain text; count them once something
  // plainly Markdown is there too.
  if (!count) return { count: 0, ranges: [] };
  const ranges = [...found, ...bullets.ranges]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_EXAMPLES);
  return { count: count + bullets.count, ranges };
}

// Pasted text is cleaned without asking only when it is plainly Markdown:
// front matter, or two different sorts of syntax that plain text rarely has
// (say a heading and a link). Italics, quotes and backticks don't count:
// books use _italics_, "> " starts quoted email, ``this'' is an old quote
// style. Project Gutenberg's "*** START ... ***" looks bold, so bold alone
// is never enough.
const MD_TELLING = [
  MD_FENCE,
  MD_HEADING,
  MD_TABLE_RULE,
  MD_IMAGE,
  MD_LINK,
  MD_STRONG,
  MD_STRIKE,
  MD_FOOTNOTE_REF,
  TEMPLATE_TAG,
];

export function looksLikeMarkdown(text) {
  text = text.replace(/\r\n?/g, "\n");
  if (text.search(MD_FRONT_MATTER) !== -1) return true;
  return MD_TELLING.filter((regex) => text.search(regex) !== -1).length >= 2;
}

// Plain-text books (Project Gutenberg's .txt files) mark italics with
// underscores: "_at once_" becomes "at once". snake_case is left alone.
// An italic verse quotation can run over several stanzas, so a mark that
// opens a line may also close at the end of a later paragraph.
export function stripItalics(text) {
  return text
    .replace(MD_UNDERSCORE, "$1")
    .replace(
      /^([ \t]*)_(?=[^\s_])(?=[^_]*?\p{L})([^_]{0,3000}?[^\s_])_(?=[ \t\r]*$)/gmu,
      "$1$2",
    );
}

// Removes Markdown syntax and keeps the words: "## Notes" becomes "Notes",
// "[the paper](https://...)" becomes "the paper", "**very**" becomes "very".
// Front matter, footnote markers, HTML tags and note numbers like "[1]" go;
// footnotes themselves stay, as plain paragraphs without their markers.
export function stripMarkdown(text) {
  // A backslash escapes punctuation in Markdown ("\\*" means "*"). Hide
  // escaped characters while the syntax is removed, then put them back.
  const escaped = [];
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(MD_FRONT_MATTER, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>|~])/gu, (_, c) => {
      escaped.push(c);
      return "\uE000";
    });
  const code = [];
  let i = 0;
  let j = 0;
  return decodeEntities(
    lines
      .replace(HTML_COMMENT, "")
      .replace(HTML_SCRIPT, "")
      .replace(TEMPLATE_TAG, "")
      .replace(MD_FENCE, "")
      .replace(MD_FOOTNOTE_DEF, "\n")
      .replace(MD_LINK_DEF, "")
      .replace(MD_TABLE_RULE, "")
      .replace(MD_RULE, "")
      .replace(MD_HEADING, "")
      .replace(/^([^\n]*?)[ \t]+#+[ \t]*$/gmu, (line, body) =>
        /\S/.test(body) ? body : line,
      )
      .replace(MD_QUOTE, "$1")
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
      // Code is kept as written, so "`<div>`" is not taken for a tag.
      .replace(MD_CODE, (_, c) => {
        code.push(c);
        return "";
      })
      .replace(HTML_TAG, (_, name) =>
        /^br$/i.test(name) ? "\n" : HTML_BLOCK.test(name) ? "\n\n" : "",
      )
      .replace(//gu, () => code[j++])
      .replace(MD_STRONG, "$2")
      .replace(MD_STRIKE, "$1")
      .replace(MD_EMPHASIS, (_, a, b) => a ?? b)
      .replace(MD_FOOTNOTE_REF, "")
      .replace(/\uE000/gu, () => escaped[i++])
      // Note numbers, often escaped ("\[1\]"): "year.[1]" becomes "year.",
      // and a note that starts "[1] Actually" becomes its own paragraph.
      // Other brackets, like "[sic]", stay.
      .replace(/^[ \t]*\[\d{1,3}\][ \t]*(?:\n|$)/gmu, "")
      .replace(/^[ \t]*\[\d{1,3}\][ \t]+(?=\S)/gmu, "\n")
      .replace(/[ \t]*\[\d{1,3}\](?![\p{L}\d([])/gu, ""),
  )
    .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n")
    .trim();
}

// Text files are usually UTF-8, but older ones (many Project Gutenberg
// files among them) are Latin-1 / Windows-1252, where UTF-8 decoding turns
// every accented letter into "�".
export function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Project Gutenberg files wrap the book in a header and a long licence
// (about a quarter of a short essay). The book lies between the START and
// END markers; the header names its title.
const PG_START =
  /^[ \t]*\*{3}[ \t]*START OF (?:THE|THIS) PROJECT GUTENBERG E-?BOOK\b[^\n]*$/im;
const PG_END =
  /^[ \t]*\*{3}[ \t]*END OF (?:THE|THIS) PROJECT GUTENBERG E-?BOOK\b[^\n]*$/im;
// Plain-text books (Project Gutenberg's among them) wrap every line at about
// 70 characters and put a blank line between paragraphs. Each paragraph
// becomes one line; verse, lists and headings (indented or short lines)
// keep their breaks, and rows of asterisks between sections are dropped.
export function unwrapParagraphs(text) {
  // Some books indent their prose a little; only deeper lines count.
  const depth = (l) => /^[ \t]*/.exec(l)[0].length;
  const tally = new Map();
  for (const l of text.split("\n"))
    if (l.trim()) tally.set(depth(l), (tally.get(depth(l)) || 0) + 1);
  const usual = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  return text
    .split(/\n[ \t]*\n/)
    .map((block) => {
      const lines = block.split("\n").filter((l) => l.trim());
      // A row of asterisks marks a break between sections, not words.
      if (/^[\s*]*\*[\s*]*\*[\s*]*\*[\s*]*$/.test(block)) return "";
      if (lines.length < 2) return block.trim();
      const indented = lines.filter(
        (l) => depth(l) > Math.max(usual, 2),
      ).length;
      const short = lines.filter((l) => l.trim().length < 45).length;
      if (indented > lines.length / 2 || short > lines.length / 2)
        return lines.map((l) => l.trimEnd()).join("\n");
      return lines.map((l) => l.trim()).join(" ");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function gutenbergBook(text) {
  text = text.replace(/\r\n?/g, "\n");
  const start = PG_START.exec(text);
  if (!start) return null;
  const header = text.slice(0, start.index);
  let body = text.slice(start.index + start[0].length);
  const end = PG_END.exec(body);
  if (end) body = body.slice(0, end.index);
  // Credits just inside the markers ("Produced by…", "End of the Project
  // Gutenberg EBook of…") belong to the edition, not the book.
  body = body
    .trim()
    .replace(
      /^(?:(?:Produced|Typed|Transcribed|Prepared|Scanned)[^\n]*\bby\b[^]*?)(?:\n[ \t]*\n|$)/i,
      "",
    )
    .replace(/\n[ \t]*End of (?:the |this )?Project Gutenberg[^]*$/i, "")
    .trim();
  // The first line only: indented lines under it are a subtitle.
  const title = /^Title:[ \t]*(.+)/m.exec(header)?.[1].trim();
  return { text: body, title: title || "" };
}

// "exam- ple" becomes "example" when the dictionary knows the whole word;
// "well- known" keeps its hyphen ("well-known"). A
// hyphen before "and" or "to" is meant ("independent- and free-minded").
const SUSPENDED = /^(?:and|or|nor|to|but|than|as|then|versus|vs)$/i;
export async function rejoinSplitWords(text, lookup) {
  const known = async (word) => {
    try {
      return !!(lookup && (await lookup(word)));
    } catch {
      return false;
    }
  };
  const replacements = [];
  for (const m of text.matchAll(/(\p{L}+)-[ \t]+(\p{Ll}+)/gu)) {
    const [, left, right] = m;
    if (SUSPENDED.test(right)) continue;
    const whole = await known(left + right);
    replacements.push([
      m.index,
      m[0].length,
      whole ? left + right : `${left}-${right}`,
    ]);
  }
  for (const [index, length, value] of replacements.reverse())
    text = text.slice(0, index) + value + text.slice(index + length);
  return text;
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
      message: `${markdown.count} formatting ${markdown.count === 1 ? "mark" : "marks"} (like _, ** or #) would be shown as words.`,
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
  const counts = new Map(),
    variants = new Map();
  for (const m of text.matchAll(/^[ \t]*(\S[^\n]{2,60}?)[ \t]*$/gmu)) {
    const key = m[1].replace(/\d+/g, "#");
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!variants.has(key)) variants.set(key, new Set());
    variants.get(key).add(m[1]);
  }
  const MONTH =
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
  // Numbered headings ("Section 5.1", "Chapter 12") repeat their shape but
  // not their number; a running header repeats the same words page after page.
  const NUMBERED =
    /^(?:section|chapter|part|book|lecture|letter|essay|canto|act|scene|article|lesson|stave|sect\.|chap\.|§)\s*#(?:\.#)*\.?$/iu;
  const repeated = [...counts].filter(
    ([k, n]) =>
      n >= 6 &&
      (k.match(/\p{L}/gu) || []).length >= 6 &&
      !MONTH.test(k) &&
      !(NUMBERED.test(k) && variants.get(k).size >= n * 0.8),
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

  const split = collect(
    text,
    /\p{L}+-[ \t]+(\p{Ll}+)/gu,
    (m) => !SUSPENDED.test(m[1]),
  );
  if (split.count >= 3)
    findings.push({
      id: "split",
      message: `${split.count} words look split by a line-end hyphen, like “exam- ple”.`,
      ...split,
      fix: rejoinSplitWords,
      fixLabel: "Join them",
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
