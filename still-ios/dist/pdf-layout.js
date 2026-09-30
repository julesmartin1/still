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
  const box = bounds(items),
    span = box.right - box.x;
  let split = null,
    best = -Infinity;
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
    }
  }
  if (best < 1 && mode !== "two") split = null;
  if (split === null && mode === "two") split = box.x + span / 2;
  if (split === null) return { lines: makeLines(items), columns: 1 };
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
  return { lines, columns: 2 };
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
  let removed = 0;
  for (const page of chosen) {
    let previous = null;
    for (const line of page.lines) {
      if (
        removeMargins &&
        pages.length >= 3 &&
        (line.y > page.height * 0.92 || line.top < page.height * 0.08) &&
        (/^\d+$/.test(line.text) ||
          (counts.get(signature(line)) || 0) >=
            Math.max(3, Math.ceil(pages.length * 0.5)))
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
      const paragraph =
        heading ||
        previous?.heading ||
        !previous ||
        gap < 0 ||
        gap > Math.max(previous.height, line.height) * 1.65 ||
        Math.abs(line.x - previous.x) > page.width * 0.25;
      const join = !paragraph ? previous?.joinNext : false;
      if (join === "remove") text = text.slice(0, -1);
      if (text && !join) text += paragraph ? "\n\n" : " ";
      const count = line.text.split(/\s+/).length;
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
    }
  }
  return { text, locations, removed };
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
