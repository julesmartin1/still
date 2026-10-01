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
    (l) =>
      l.trim().length >= typical * 0.8 &&
      !/[.!?:;"”’)\]]$/.test(l.trim()),
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
      const carriesOn =
        /[\p{L},;—–-]$/u.test(current) && /^\p{Ll}/u.test(line);
      if (!carriesOn) end();
    }
    const headingLike =
      line.length <= 40 &&
      /^[\p{Lu}\d]/u.test(line) &&
      !/[,;:—–.!?-]$/.test(line);
    if (headingLike && /[.!?"”’)\]…]$/.test(current)) end();
    if (current.endsWith("-") && /^\p{Ll}/u.test(line) && /\p{L}-$/u.test(current))
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

export function checkText(text) {
  const findings = [];
  if (!text.trim()) return findings;

  const odd = collect(
    text,
    /\S*[ɐ-ʯ-�\u0000-\u0008\u000e-\u001f]\S*/gu,
  );
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

  const pageNumbers = collect(text, /^[ \t]*(?:page\s+)?\d{1,4}[ \t]*$/gimu);
  if (pageNumbers.count >= 3)
    findings.push({
      id: "pages",
      message: `${pageNumbers.count} lines are just a number, probably page numbers.`,
      ...pageNumbers,
      fix: (t) => t.replace(/^[ \t]*(?:page\s+)?\d{1,4}[ \t]*(?:\r?\n|$)/gimu, ""),
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

  const glued = collect(
    text,
    /(?<![\p{L}\d])\p{Ll}{3,}\d{1,3}(?![\p{L}\d])/gu,
  );
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
