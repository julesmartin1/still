import { countWords } from "./engine.js";
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
function columnLines(rows, split) {
  // Entire spanning rows form boundaries; never split a row by individual PDF fragments.
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
  for (const row of rows) {
    if (
      row.items.some(
        (i) => i.transform[4] < split && i.transform[4] + i.width > split,
      )
    ) {
      flush();
      lines.push(...makeLines(row.items));
    } else band.push(...row.items);
  }
  flush();
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
      return { lines: columnLines(rows, gutter.split), columns: 2 };
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
  if (split === null) return { lines: makeLines(items), columns: 1 };
  return { lines: columnLines(rows, split), columns: 2 };
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
export function composePdf(
  pages,
  { from = 1, to = pages.length, removeMargins = false } = {},
) {
  const chosen = pages.filter((p) => p.number >= from && p.number <= to),
    counts = new Map();
  const signature = (l) => l.text.toLowerCase().replace(/\d+/g, "#");
  for (const p of pages) {
    for (const key of new Set(
      p.lines
        .filter((l) => l.y > p.height * 0.92 || l.top < p.height * 0.08)
        .map(signature),
    ))
      counts.set(key, (counts.get(key) || 0) + 1);
  }
  let text = "",
    wordIndex = 0;
  const locations = [];
  let removed = 0,
    last = null; // previous retained line, across pages
  for (const page of chosen) {
    let previous = null;
    for (const line of page.lines) {
      if (
        removeMargins &&
        (line.y > page.height * 0.92 || line.top < page.height * 0.08) &&
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
          (sentenceEnded && (indented || shortBefore)));
      const join = !paragraph ? previous?.joinNext : false;
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
      previous = { ...line, heading };
      last = previous;
    }
  }
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

export async function markLineJoins(pages, lookup, { signal } = {}) {
  let count = 0;
  for (const page of pages)
    for (let i = 0; i < page.lines.length - 1; i++) {
      signal?.throwIfAborted();
      const line = page.lines[i],
        next = page.lines[i + 1];
      delete line.joinNext;
      const a = line.text.match(/([\p{L}]+)-$/u),
        b = next.text.match(/^([\p{Ll}][\p{L}]+)/u);
      if (
        !a ||
        !b ||
        Math.abs(next.x - line.x) > Math.max(18, line.height * 2) ||
        line.y - next.y <= 0 ||
        line.y - next.y > Math.max(line.height, next.height) * 1.65
      )
        continue;
      try {
        if (await lookup(a[1] + "-" + b[1])) line.joinNext = "keep";
        else if (await lookup(a[1] + b[1])) line.joinNext = "remove";
        if (line.joinNext) count++;
      } catch {
        /* Without a dictionary, preserve the original spelling. */
      }
    }
  return count;
}
