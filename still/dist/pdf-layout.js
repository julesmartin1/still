import { countWords, parseText } from "./engine.js";
// Geometry-based reading order. Every retained line carries its source rectangle.
function bounds(items) {
  return {
    x: Math.min(...items.map((i) => i.transform[4])),
    y: Math.min(...items.map((i) => i.transform[5])),
    right: Math.max(...items.map((i) => i.transform[4] + i.width)),
    top: Math.max(...items.map((i) => i.transform[5] + i.height)),
  };
}
function makeLines(items) {
  const lines = [];
  for (const item of [...items].sort(
    (a, b) =>
      b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  )) {
    let line = lines.find(
      (l) =>
        Math.abs(l.y - item.transform[5]) <
        Math.max(
          2,
          Math.max(...l.items.map((p) => p.height), item.height) * 0.45,
        ),
    );
    if (!line) {
      line = { y: item.transform[5], items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .flatMap((line) => {
      const chunks = [[]];
      let last;
      for (const item of line.items.sort(
        (a, b) => a.transform[4] - b.transform[4],
      )) {
        if (
          last &&
          item.transform[4] - (last.transform[4] + last.width) >
            Math.max(30, item.height * 3)
        )
          chunks.push([]);
        chunks.at(-1).push(item);
        last = item;
      }
      return chunks.map((items) => {
        const parts = items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = "",
          previous;
        for (const p of parts) {
          if (
            previous &&
            p.transform[4] - (previous.transform[4] + previous.width) >
              p.height * 0.12 &&
            !/\s$/.test(text) &&
            !/^\s/.test(p.str)
          )
            text += " ";
          text += p.str;
          previous = p;
        }
        return {
          ...bounds(parts),
          text: text.replace(/\u00ad|\u0000/g, "").trim(),
          height: Math.max(...parts.map((p) => p.height)),
        };
      });
    })
    .filter((l) => l.text);
}
// Finds the best vertical gutter between two columns: an x position that
// many rows have text on both sides of, and few rows cross.
function findGutter(rows, items) {
  const box = bounds(items),
    span = box.right - box.x;
  let split = null,
    best = -Infinity,
    bestShared = 0;
  for (let ratio = 0.15; ratio <= 0.85; ratio += 0.01) {
    const x = box.x + span * ratio;
    let shared = 0,
      cross = 0;
    for (const row of rows) {
      const left = row.items.some((i) => i.transform[4] + i.width <= x - 3),
        right = row.items.some((i) => i.transform[4] >= x + 3);
      const crossing = row.items.some(
        (i) => i.transform[4] < x + 3 && i.transform[4] + i.width > x - 3,
      );
      if (left && right && !crossing) shared++;
      if (crossing) cross++;
    }
    const score = shared - cross * 2 - Math.abs(ratio - 0.5) * 0.5;
    if (shared >= 3 && score > best) {
      best = score;
      split = x;
      bestShared = shared;
    }
  }
  return { split, best, shared: bestShared, box, span };
}
function columnLines(rows, split, span) {
  // Entire spanning rows form boundaries; never split a row by individual PDF fragments.
  // A short row centred on the gutter below both columns (a page number, a
  // centred footer) also spans the page: it belongs after both columns, not
  // at the foot of the left one.
  const centred = (row) => {
    const box = bounds(row.items);
    const both =
      row.items.some((i) => i.transform[4] + i.width <= split - 3) &&
      row.items.some((i) => i.transform[4] >= split + 3);
    return (
      !both &&
      Math.abs((box.x + box.right) / 2 - split) < span * 0.06 &&
      box.right - box.x < span * 0.4
    );
  };
  const lastRight = rows.findLastIndex(
    (row) => !centred(row) && row.items.some((i) => i.transform[4] >= split),
  );
  const lines = [];
  let band = [];
  const flush = () => {
    if (!band.length) return;
    lines.push(
      ...makeLines(band.filter((i) => i.transform[4] < split)),
      ...makeLines(band.filter((i) => i.transform[4] >= split)),
    );
    band = [];
  };
  for (const [index, row] of rows.entries()) {
    if (
      row.items.some(
        (i) => i.transform[4] < split && i.transform[4] + i.width > split,
      ) ||
      (index > lastRight && centred(row))
    ) {
      flush();
      lines.push(...makeLines(row.items));
    } else band.push(...row.items);
  }
  flush();
  return lines;
}
// A narrow block beside the text, such as a figure caption in the margin,
// sits on its own baselines, so sorting lines top to bottom interleaves it
// with the text line by line. Finds a stretch of lines that a vertical
// gutter separates into two sides, both several lines long, and reads the
// left side, then the right.
function untangleSideBlocks(lines) {
  const starts = [...new Set(lines.map((l) => Math.round(l.x)))];
  for (const start of starts) {
    let run = [];
    const finish = (end) => {
      const left = run.filter((i) => lines[i].right <= start - 6),
        right = run.filter((i) => lines[i].x >= start - 1);
      let switches = 0;
      for (let k = 1; k < run.length; k++)
        if (left.includes(run[k]) !== left.includes(run[k - 1])) switches++;
      if (left.length >= 3 && right.length >= 3 && switches >= 3) {
        const from = run[0];
        lines.splice(
          from,
          end - from,
          ...left.map((i) => lines[i]),
          ...right.map((i) => lines[i]),
        );
        return true;
      }
      return false;
    };
    for (let i = 0; i <= lines.length; i++) {
      const line = lines[i];
      const sideways = line && (line.right <= start - 6 || line.x >= start - 1);
      if (sideways) run.push(i);
      else {
        if (run.length >= 6 && finish(i)) return untangleSideBlocks(lines);
        run = [];
      }
    }
  }
  return lines;
}
function orderedRegions(items, mode, depth = 0) {
  if (!items.length) return { lines: [], columns: 1 };
  // Reassemble complete baselines before classifying gutters, including font/ligature fragments.
  const rows = [];
  for (const item of [...items].sort(
    (a, b) => b.transform[5] - a.transform[5],
  )) {
    let row = rows.find(
      (r) =>
        Math.abs(r.y - item.transform[5]) <
        Math.max(2, Math.max(r.height, item.height) * 0.45),
    );
    if (!row) {
      row = { y: item.transform[5], height: item.height, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.height = Math.max(row.height, item.height);
  }
  rows.sort((a, b) => b.y - a.y);
  // A clear gutter running down most of the region means ordinary columns.
  // Read them whole before looking at horizontal gaps: gaps between
  // paragraphs often line up across both columns, and cutting there would
  // interleave pieces of the left and right columns.
  if (mode !== "single") {
    const gutter = findGutter(rows, items);
    if (
      gutter.split !== null &&
      gutter.best >= 3 &&
      gutter.shared >= rows.length * 0.3
    )
      return {
        lines: columnLines(rows, gutter.split, gutter.span),
        columns: 2,
      };
  }
  // Wide horizontal whitespace separates layouts, e.g. an abstract sidebar from the body.
  const heights = items.map((i) => i.height).sort((a, b) => a - b),
    typical = heights[Math.floor(heights.length / 2)];
  const bands = [[]];
  rows.forEach((r, i) => {
    if (
      i &&
      rows[i - 1].y - r.y > Math.max(typical * 1.9, rows[i - 1].height * 1.5)
    )
      bands.push([]);
    bands.at(-1).push(...r.items);
  });
  if (bands.length > 1 && depth < 8) {
    const regions = bands.map((b) => orderedRegions(b, mode, depth + 1));
    return {
      lines: regions.flatMap((r) => r.lines),
      columns: Math.max(...regions.map((r) => r.columns)),
    };
  }
  if (mode === "single") return { lines: makeLines(items), columns: 1 };
  let { split, best, box, span } = findGutter(rows, items);
  if (best < 1 && mode !== "two") split = null;
  if (split === null && mode === "two") split = box.x + span / 2;
  if (split === null)
    return { lines: untangleSideBlocks(makeLines(items)), columns: 1 };
  return { lines: columnLines(rows, split, span), columns: 2 };
}
export function layoutPage(
  raw,
  { mode = "auto", width = 612, height = 792 } = {},
) {
  const items = raw
    .filter(
      (i) =>
        typeof i.str === "string" && i.str.trim() && i.transform?.length >= 6,
    )
    .map((i) => ({
      ...i,
      width: Math.abs(i.width || 0),
      height: Math.max(1, Math.abs(i.height || i.transform[3] || 10)),
    }));
  return { width, height, ...orderedRegions(items, mode) };
}
// Running headers sit above the body; footers and page numbers sit on a
// baseline in the bottom margin (often 7–8% up, so their top edge can reach
// into the last 10%).
function marginLine(line, page) {
  return line.y > page.height * 0.92 || line.y < page.height * 0.08;
}
// Footnotes at the foot of a column: smaller type, starting with a note
// marker ("3The distribution…", "* Work done while…"). Cached per page.
const footnoteCache = new WeakMap();
function footnoteLines(page) {
  if (footnoteCache.has(page)) return footnoteCache.get(page);
  const weights = new Map();
  for (const l of page.lines) {
    const h = Math.round(l.height * 2) / 2;
    weights.set(h, (weights.get(h) || 0) + l.text.length);
  }
  const body = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  const notes = new Set();
  let inNote = null;
  for (const l of page.lines) {
    const small = l.height <= body * 0.9;
    if (inNote && small && l.y <= inNote.y + 2) {
      notes.add(l);
      inNote = l;
      continue;
    }
    inNote = null;
    if (
      small &&
      l.y < page.height * 0.35 &&
      /^(?:\d{1,3}|[*†‡§¶])\s?\p{L}/u.test(l.text)
    ) {
      notes.add(l);
      inNote = l;
    }
  }
  footnoteCache.set(page, notes);
  return notes;
}
export function composePdf(
  pages,
  { from = 1, to = pages.length, removeMargins = false } = {},
) {
  const chosen = pages.filter((p) => p.number >= from && p.number <= to),
    counts = new Map();
  const signature = (l) => l.text.toLowerCase().replace(/\d+/g, "#");
  for (const p of pages) {
    for (const key of new Set(
      p.lines.filter((l) => marginLine(l, p)).map(signature),
    ))
      counts.set(key, (counts.get(key) || 0) + 1);
  }
  let text = "",
    wordIndex = 0;
  const locations = [];
  let removed = 0,
    last = null; // previous retained line, across pages
  // Margin lines that interrupt a sentence (a first-page footer, a header
  // seen only once) wait until that sentence's paragraph ends.
  let deferred = [];
  const emit = (line, page, { paragraph, join }) => {
    if (join === "remove") text = text.slice(0, -1);
    if (text && !join) text += paragraph ? "\n\n" : " ";
    const count = countWords(line.text);
    locations.push({
      page: page.number,
      start: wordIndex - (join ? 1 : 0),
      end: wordIndex + count - 1 - (join ? 1 : 0),
      rect: [line.x, line.y, line.right, line.top],
      text: line.text,
    });
    wordIndex += count - (join ? 1 : 0);
    text += line.text;
  };
  const flushDeferred = () => {
    // Each footer and each footnote is its own paragraph.
    deferred.forEach(({ line, page, note }, i) => {
      const before = deferred[i - 1];
      emit(line, page, {
        paragraph:
          !before ||
          before.page !== page ||
          before.note !== note ||
          (note && /^(?:\d{1,3}|[*†‡§¶])\s?\p{L}/u.test(line.text)),
      });
    });
    deferred = [];
  };
  for (const page of chosen) {
    let previous = null;
    for (const line of page.lines) {
      const margin = marginLine(line, page);
      if (
        removeMargins &&
        margin &&
        // A bare page number is safe to drop on any multi-page PDF; other
        // repeated lines need 3+ pages before they count as a header/footer.
        ((pages.length >= 2 && /^\d+$/.test(line.text)) ||
          (pages.length >= 3 &&
            (counts.get(signature(line)) || 0) >=
              Math.max(3, Math.ceil(pages.length * 0.5))))
      ) {
        removed++;
        continue;
      }
      const note = footnoteLines(page).has(line);
      const aside = margin || note;
      if (
        aside &&
        last &&
        !last.heading &&
        !last.aside &&
        !/[.!?:;。！？]["”’)\]]*$/u.test(last.text)
      ) {
        deferred.push({ line, page, note });
        continue;
      }
      const gap = previous ? previous.y - line.y : Infinity;
      const heading =
        line.text.length <= 130 &&
        /^(?:(?:\d+(?:\.\d+)*[.)]?\s+)?(?:abstract|introduction|background|methods?|methodology|results|discussion|conclusions?|references|bibliography|works cited)\b|(?:chapter|part)\s+\S+|prologue\b|epilogue\b|appendix\b)/i.test(
          line.text,
        );
      const jumped =
        !previous ||
        gap < 0 ||
        Math.abs(line.x - previous.x) > page.width * 0.25;
      // A sentence that runs from the bottom of one column or page to the
      // top of the next is one paragraph, not two.
      const continues =
        jumped &&
        !heading &&
        last &&
        !last.heading &&
        !last.aside &&
        !/[.!?:;。！？]["”’)\]]*$/u.test(last.text) &&
        /^["“‘(]?\p{Ll}/u.test(line.text);
      // Books mark paragraphs with a first-line indent or a short last line,
      // not a gap. Both need the previous line to end a sentence.
      const sentenceEnded =
        previous && /[.!?:;。！？…]["”’)\]]*$/u.test(previous.text);
      const indent = previous ? line.x - previous.x : 0;
      const indented =
        indent > Math.max(line.height * 0.7, 4) && indent < page.width * 0.2;
      const shortBefore =
        previous &&
        previous.right <
          columnRight(page, previous) - Math.max(previous.height * 3, 20);
      const paragraph =
        !continues &&
        (heading ||
          previous?.heading ||
          jumped ||
          gap > Math.max(previous.height, line.height) * 1.65 ||
          (sentenceEnded && (indented || shortBefore)) ||
          // A short line standing alone, like "10 May" or a chapter title.
          (shortBefore &&
            previous.start &&
            previous.text.length <= 80 &&
            /^["“‘(]?\p{Lu}/u.test(line.text)));
      const join = !paragraph ? (previous || last)?.joinNext : false;
      if (paragraph && deferred.length) flushDeferred();
      emit(line, page, { paragraph, join });
      previous = { ...line, heading, aside, start: paragraph };
      last = previous;
    }
  }
  flushDeferred();
  return { text, locations, removed };
}
// Right edge of the text column a line belongs to (the widest line that
// starts near it), cached per page.
const columnRights = new WeakMap();
function columnRight(page, line) {
  if (!columnRights.has(page)) columnRights.set(page, new Map());
  const cache = columnRights.get(page);
  const key = Math.round(line.x / 20);
  if (!cache.has(key))
    cache.set(
      key,
      Math.max(
        ...page.lines
          .filter((l) => Math.abs(l.x - line.x) < page.width * 0.1)
          .map((l) => l.right),
      ),
    );
  return cache.get(key);
}
export function sourceLocation(locations, index) {
  let low = 0,
    high = locations.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1,
      l = locations[middle];
    if (index < l.start) high = middle - 1;
    else if (index > l.end) low = middle + 1;
    else return { ...l, focusIndex: index };
  }
  return null;
}

// How to rejoin a word split by a hyphen at the end of a line: "keep" the
// hyphen (a compound), "remove" it (a word broken across lines), or null to
// leave it alone. The dictionary decides when it knows either spelling.
// Otherwise two known words make a compound ("hand-tagged", "n-gram",
// "HMM-based"), and anything else is a broken word ("pro-jectivized"),
// except very short pieces, which are too often words the dictionary lacks
// ("state-of", "language-to").
async function hyphenJoin(first, second, lookup) {
  if (await lookup(first + "-" + second)) return "keep";
  if (await lookup(first + second)) return "remove";
  const known = await lookup(second);
  if (
    known &&
    (first.length === 1 ||
      /\p{Lu}/u.test(first) ||
      (first.length >= 3 && (await lookup(first))))
  )
    return "keep";
  if (first.length >= 2 && second.length >= 3) return "remove";
  return null;
}
export async function markLineJoins(pages, lookup, { signal } = {}) {
  let count = 0;
  // Body text in reading order across pages, so a word hyphenated at the
  // foot of one column or page joins the start of the next; footnotes
  // separately, line by line.
  const pairs = [];
  let body = null;
  for (const page of pages) {
    const notes = footnoteLines(page);
    let note = null;
    for (const line of page.lines) {
      delete line.joinNext;
      if (marginLine(line, page)) continue;
      if (notes.has(line)) {
        if (note)
          pairs.push({
            line: note,
            next: line,
            page,
            nextPage: page,
            jumps: false,
          });
        note = line;
        continue;
      }
      if (body)
        pairs.push({
          line: body.line,
          next: line,
          page: body.page,
          nextPage: page,
          jumps: true,
        });
      body = { line, page };
    }
  }
  for (const { line, next, page, nextPage, jumps } of pairs) {
    signal?.throwIfAborted();
    const a = line.text.match(/([\p{L}]+)-$/u),
      b = next.text.match(/^([\p{Ll}][\p{L}]+)/u);
    const below =
      page === nextPage &&
      Math.abs(next.x - line.x) <= Math.max(18, line.height * 2) &&
      line.y - next.y > 0 &&
      line.y - next.y <= Math.max(line.height, next.height) * 1.65;
    // The next column (back up the page) or the next page.
    const jumped =
      jumps && (page !== nextPage || (next.y > line.y && next.x > line.x));
    if (!a || !b || !(below || jumped)) continue;
    try {
      line.joinNext = await hyphenJoin(a[1], b[1], lookup);
      if (line.joinNext) count++;
    } catch {
      /* Without a dictionary, preserve the original spelling. */
    }
  }
  return count;
}

// Turns PDF table-of-contents entries into reading sections
// ([{ title, paragraph }], paragraph 1-based) for composed text. Each entry
// lands on the first line at or below the point it links to; entries outside
// the chosen pages are dropped.
export function outlineSections(outline, { text, locations }) {
  if (!outline?.length || !locations?.length) return [];
  const tokens = parseText(text).tokens;
  const sections = [];
  for (const entry of outline) {
    const onPage = locations.filter((l) => l.page === entry.page);
    let target =
      entry.top == null
        ? onPage[0]
        : (onPage.find((l) => l.rect[3] <= entry.top + 2) ?? null);
    // Pointing below the last line, or at a page with no text: the next text.
    if (!target) target = locations.find((l) => l.page > entry.page);
    if (!target || entry.page < locations[0].page) continue;
    const token = tokens[Math.max(0, target.start)];
    if (!token) continue;
    const paragraph = token.paragraph + 1;
    if (sections.some((s) => s.paragraph === paragraph)) continue;
    sections.push({ title: entry.title, paragraph });
  }
  return sections.sort((a, b) => a.paragraph - b.paragraph);
}
