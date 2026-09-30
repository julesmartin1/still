import { normalizeMarks } from "./reading-features.js";
import { normalizeSections } from "./document.js";
export async function encodeBackup(snapshot) {
  const sources = [];
  for (const s of snapshot.sources) {
    const bytes = new Uint8Array(await s.blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    sources.push({ ...s, blob: undefined, pdf: btoa(binary) });
  }
  return JSON.stringify({
    format: "still-bookshelf",
    version: 1,
    createdAt: new Date().toISOString(),
    readings: snapshot.readings,
    sources,
  });
}
export function decodeBackup(value) {
  const bad = () => {
    throw Error(
      "This is not a valid Still bookshelf backup. Nothing was imported.",
    );
  };
  if (typeof value === "string" && value.length > 250 * 1024 * 1024) bad();
  let data;
  try {
    data = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    bad();
  }
  if (
    data?.format !== "still-bookshelf" ||
    data.version !== 1 ||
    !Array.isArray(data.readings) ||
    !Array.isArray(data.sources) ||
    data.readings.length > 1000 ||
    data.sources.length > 1000
  )
    bad();
  const ids = new Set(),
    readings = [];
  for (const r of data.readings) {
    if (
      !r ||
      typeof r.id !== "string" ||
      r.id.length > 200 ||
      ids.has(r.id) ||
      typeof r.text !== "string" ||
      !r.text.trim() ||
      r.text.length > 2000000 ||
      typeof r.title !== "string" ||
      !Number.isInteger(r.index) ||
      r.index < 0
    )
      bad();
    ids.add(r.id);
    const count = r.text.trim().split(/\s+/).length;
    const opts = r.readingOptions || {};
    const type = ["book", "academic", "other"].includes(opts.documentType)
      ? opts.documentType
      : "other";
    const paragraphs = r.text.trim().split(/\n\s*\n/).length;
    const range = opts.referenceRange;
    const validRange =
      range &&
      Number.isInteger(range.start) &&
      Number.isInteger(range.end) &&
      range.start >= 1 &&
      range.end >= range.start &&
      range.end <= paragraphs;
    readings.push({
      id: r.id,
      title: r.title.slice(0, 240),
      text: r.text,
      index: Math.min(r.index, count - 1),
      sourceIndex: Math.max(
        0,
        Math.min(
          Number.isInteger(r.sourceIndex) ? r.sourceIndex : r.index,
          count - 1,
        ),
      ),
      wordCount: Number.isInteger(r.wordCount)
        ? Math.max(0, Math.min(r.wordCount, count))
        : count,
      finished: !!r.finished,
      shelfState: ["active", "archived", "trash"].includes(r.shelfState)
        ? r.shelfState
        : "active",
      updatedAt: Date.now(),
      base: Number.isFinite(r.base) ? Math.max(80, Math.min(600, r.base)) : 260,
      profile: {
        slowdown: Math.max(0, Math.min(0.2, Number(r.profile?.slowdown) || 0)),
        lookups:
          r.profile?.lookups && typeof r.profile.lookups === "object"
            ? Object.fromEntries(
                Object.entries(r.profile.lookups)
                  .filter(
                    ([k, v]) => k.length <= 100 && Number.isFinite(v) && v >= 0,
                  )
                  .slice(0, 5000),
              )
            : {},
        rewinds: [],
      },
      readingOptions: {
        documentType: type,
        skipCitations: type !== "book" && !!opts.skipCitations,
        skipReferences: type !== "book" && !!opts.skipReferences,
        ...(validRange ? { referenceRange: range } : {}),
        sections: normalizeSections(opts.sections, r.text),
        marks: normalizeMarks(opts.marks, count),
        readingMode: opts.readingMode === "text" ? "text" : "word",
      },
    });
  }
  const sourceIds = new Set();
  const sources = data.sources.map((s) => {
    if (
      !s ||
      !ids.has(s.id) ||
      sourceIds.has(s.id) ||
      typeof s.pdf !== "string" ||
      s.pdf.length > 70000000 ||
      !Array.isArray(s.locations) ||
      s.locations.length > 200000
    )
      bad();
    sourceIds.add(s.id);
    let bytes;
    try {
      bytes = Uint8Array.from(atob(s.pdf), (c) => c.charCodeAt(0));
    } catch {
      bad();
    }
    if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-"))
      bad();
    const reading = readings.find((r) => r.id === s.id),
      count = reading.text.trim().split(/\s+/).length;
    let previous = -1;
    for (const l of s.locations) {
      if (
        !l ||
        !Number.isInteger(l.page) ||
        l.page < 1 ||
        l.page > 1000 ||
        !Number.isInteger(l.start) ||
        !Number.isInteger(l.end) ||
        l.start < previous ||
        l.start < 0 ||
        l.end < l.start ||
        l.end >= count ||
        !Array.isArray(l.rect) ||
        l.rect.length !== 4 ||
        !l.rect.every(Number.isFinite) ||
        typeof l.text !== "string" ||
        l.text.length > 20000
      )
        bad();
      previous = l.start;
    }
    return {
      id: s.id,
      blob: new Blob([bytes], { type: "application/pdf" }),
      locations: s.locations,
      fingerprint:
        typeof s.fingerprint === "string" ? s.fingerprint : undefined,
    };
  });
  return { readings, sources };
}
