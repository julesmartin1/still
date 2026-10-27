import { tidyPunctuation } from "./text-repair.js";
import { contentsLists, findStart, isContentsTitle } from "./front-matter.js";
const MAX_BOOK_CHARACTERS = 20000000;
const decoder = new TextDecoder();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function unzipEpub(buffer, { signal } = {}) {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  if (bytes.length > 50 * 1024 * 1024)
    throw Error("Choose an EPUB smaller than 50 MB.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("This file is not a readable EPUB archive.");
  const count = view.getUint16(end + 10, true);
  if (
    count > 5000 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    throw Error("This EPUB archive is too large or unsupported.");
  const centralEnd =
    view.getUint32(end + 16, true) + view.getUint32(end + 12, true);
  if (
    centralEnd > end ||
    view.getUint16(end + 8, true) !== count ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )
    throw Error("The EPUB archive is damaged.");
  let offset = view.getUint32(end + 16, true),
    total = 0;
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw Error("The EPUB archive is damaged.");
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true),
      packed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true),
      nameLength = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true),
      local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extra + comment > centralEnd)
      throw Error("The EPUB directory is incomplete.");
    const crc = view.getUint32(offset + 16, true);
    total += size;
    if (total > 100 * 1024 * 1024 || size > 20 * 1024 * 1024)
      throw Error("The expanded EPUB is too large.");
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    offset += 46 + nameLength + extra + comment;
    if (flags & 1)
      throw Error("This EPUB is encrypted. Import an unlocked, DRM-free copy.");
    if (
      name.includes("\u0000") ||
      name.startsWith("/") ||
      name.split("/").includes("..") ||
      name.includes("\\") ||
      entries.has(name)
    )
      throw Error("The EPUB contains invalid file paths.");
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
      throw Error("The EPUB archive is damaged.");
    const dataStart =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    if (dataStart + packed > bytes.length)
      throw Error("The EPUB archive is incomplete.");
    const localName = decoder.decode(
      bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)),
    );
    if (
      localName !== name ||
      view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 6, true) !== flags ||
      dataStart + packed > view.getUint32(end + 16, true)
    )
      throw Error("The EPUB file headers do not match.");
    entries.set(name, {
      method,
      size,
      crc,
      data: bytes.subarray(dataStart, dataStart + packed),
    });
  }
  if (offset !== centralEnd) throw Error("The EPUB directory is damaged.");
  const read = async (path) => {
    const e = entries.get(path);
    if (!e) throw Error("An EPUB chapter is missing: " + path);
    let result;
    if (e.method === 0) result = e.data;
    else if (e.method === 8) {
      const reader = new Blob([e.data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > e.size || length > 20 * 1024 * 1024) {
          await reader.cancel();
          throw Error("The EPUB expands beyond its stated size.");
        }
        chunks.push(value);
      }
      result = new Uint8Array(length);
      let n = 0;
      for (const chunk of chunks) {
        result.set(chunk, n);
        n += chunk.length;
      }
    } else throw Error("Unsupported EPUB compression.");
    if (result.length !== e.size)
      throw Error("The EPUB contains an incomplete chapter.");
    if (crc32(result) !== e.crc)
      throw Error("The EPUB chapter failed its integrity check.");
    return decoder.decode(result);
  };
  return { entries, read };
}
function xml(value) {
  if (value.length > 4000000 || /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(value))
    throw Error("The EPUB contains unsupported or oversized XML.");
  if (/<!DOCTYPE/i.test(value)) value = value.replace(/<!DOCTYPE[^>]*>/gi, "");
  const doc = new DOMParser().parseFromString(value, "application/xml");
  if (doc.querySelector("parsererror"))
    throw Error("This EPUB contains unreadable chapter markup.");
  return doc;
}
// A chapter that isn't well-formed XML (a stray "<Your Name Here>" in an
// otherwise fine book) is read the forgiving HTML way rather than failing
// the whole import.
function chapter(value) {
  try {
    return xml(value);
  } catch (error) {
    if (!/unreadable/.test(error.message)) throw error;
    return new DOMParser().parseFromString(value, "text/html");
  }
}
// Parts of a book that aren't read straight through: covers, title and
// copyright pages, colophons, indexes, tables of contents, and notes. Note
// numbers in the text ("ashamed.2"), the "↩" links back from notes and the
// printed book's page numbers go too, since a reader can't follow them one
// word at a time.
const SKIPPED = new Set([
  "cover",
  "titlepage",
  "halftitlepage",
  "imprint",
  "colophon",
  "copyright-page",
  "toc",
  "loi",
  "lot",
  "index",
  "footnotes",
  "endnotes",
  "rearnotes",
  "footnote",
  "endnote",
  "rearnote",
  "noteref",
  "backlink",
  "pagebreak",
]);
// What the import dialog says was left out, by kind.
const LEFT_OUT = {
  cover: "the cover",
  titlepage: "the title page",
  halftitlepage: "the title page",
  imprint: "the copyright page",
  "copyright-page": "the copyright page",
  colophon: "the copyright page",
  toc: "the contents list",
  index: "the index",
  footnotes: "the notes",
  endnotes: "the notes",
  rearnotes: "the notes",
  footnote: "the notes",
  endnote: "the notes",
  rearnote: "the notes",
  pagebreak: "page numbers",
};
const NOTE_MARK = /^\s*(?:\[\s*\d{1,3}\s*\]|\d{1,3}|[*†‡§])\s*$/u;
const kindsOf = (el) =>
  `${el.getAttribute("epub:type") || ""} ${(el.getAttribute("role") || "").replace(/\bdoc-/g, "")}`
    .toLowerCase()
    .split(/\s+/);
function skipped(el, left = new Set()) {
  const kind = kindsOf(el).find((k) => SKIPPED.has(k));
  if (kind) {
    // A page number marker is often empty; only say so when one was read.
    if (LEFT_OUT[kind] && (kind !== "pagebreak" || el.textContent.trim()))
      left.add(LEFT_OUT[kind]);
    return true;
  }
  // Project Gutenberg's header and licence.
  if (
    /^pg-(?:header|footer)$/.test(el.getAttribute("id") || "") ||
    /\bpg-boilerplate\b/.test(el.getAttribute("class") || "")
  ) {
    left.add("the Project Gutenberg header and licence");
    return true;
  }
  // A bare note number linking to a note ("<a href='#fn3'>3</a>") or
  // marking where one starts ("<a name='note1'>[1]</a>").
  if (el.localName?.toLowerCase() === "a" && NOTE_MARK.test(el.textContent)) {
    const href = el.getAttribute("href") || "";
    return (
      (!href && (el.hasAttribute("name") || el.hasAttribute("id"))) ||
      (href.includes("#") &&
        (/note|fn|foot/i.test(href) ||
          /note|foot/i.test(el.getAttribute("class") || "") ||
          el.parentElement?.localName?.toLowerCase() === "sup"))
    );
  }
  return false;
}
// A table-of-contents entry that is only a number ("I", "2") under a part or
// story is named with it: "Part I: A Voyage to Lilliput · I".
function tocTitle(a) {
  const title = a.textContent.replace(/\s+/g, " ").trim();
  if (!/^(?:[ivxlcdm]+|\d+)\.?$/i.test(title)) return title;
  const parent = a.parentElement?.parentElement?.parentElement;
  if (parent?.localName?.toLowerCase() !== "li") return title;
  const label = [...parent.children].find((c) =>
    /^(?:a|span)$/i.test(c.localName),
  );
  const name = label?.textContent.replace(/\s+/g, " ").trim();
  return name ? `${name} · ${title}` : title;
}
function resolvePath(base, href) {
  const u = new URL(href, "https://epub.invalid/" + base);
  if (u.origin !== "https://epub.invalid")
    throw Error("External EPUB chapters are not supported.");
  return {
    path: decodeURIComponent(u.pathname.slice(1)),
    anchor: decodeURIComponent(u.hash.slice(1)),
  };
}
export async function extractEpub(
  file,
  { signal, onProgress = () => {} } = {},
) {
  if (file.size > 50 * 1024 * 1024)
    throw Error("Choose an EPUB smaller than 50 MB.");
  signal?.throwIfAborted();
  const zip = await unzipEpub(await file.arrayBuffer(), { signal });
  if (zip.entries.has("META-INF/encryption.xml")) {
    const encryption = xml(await zip.read("META-INF/encryption.xml"));
    const algorithms = [
      ...encryption.getElementsByTagNameNS("*", "EncryptionMethod"),
    ].map((e) => e.getAttribute("Algorithm"));
    if (
      !algorithms.length ||
      algorithms.some(
        (a) =>
          ![
            "http://www.idpf.org/2008/embedding",
            "http://ns.adobe.com/pdf/enc#RC",
          ].includes(a),
      )
    )
      throw Error(
        "This EPUB declares encrypted content. Use an unlocked, DRM-free EPUB.",
      );
  }
  const container = xml(await zip.read("META-INF/container.xml")),
    packagePath = container
      .querySelector("rootfile")
      ?.getAttribute("full-path");
  if (!packagePath) throw Error("The EPUB has no book package.");
  const pkg = xml(await zip.read(packagePath)),
    manifest = new Map(
      [...pkg.querySelectorAll("manifest > item")].map((i) => [
        i.getAttribute("id"),
        i,
      ]),
    );
  const paragraphs = [],
    // Whether each paragraph is all a link into the book, as the lines of a
    // contents list are.
    links = [],
    sections = [],
    anchors = new Map(),
    left = new Set();
  let characters = 0,
    // The first chapter file the book marks as its main text.
    bodyPath = null;
  const spine = [...pkg.querySelectorAll("spine > itemref")].filter(
    (i) => i.getAttribute("linear") !== "no",
  );
  for (let n = 0; n < spine.length; n++) {
    signal?.throwIfAborted();
    onProgress(n + 1, spine.length);
    const item = manifest.get(spine[n].getAttribute("idref"));
    if (!item) throw Error("An EPUB chapter is missing from the manifest.");
    const path = resolvePath(packagePath, item.getAttribute("href")).path;
    const doc = chapter(await zip.read(path));
    doc
      .querySelectorAll("script,style,nav,iframe,object,noscript")
      .forEach((e) => e.remove());
    for (const el of doc.querySelectorAll("*"))
      if (skipped(el, left)) el.remove();
    const body = doc.querySelector("body");
    if (!body) continue;
    const marked = [body, ...body.children].some((el) =>
      kindsOf(el).includes("bodymatter"),
    );
    const first = paragraphs.length + 1;
    anchors.set(path, first);
    let pending = "",
      ids = [],
      linked = 0,
      inLink = 0;
    const flush = () => {
      const text = pending.replace(/\s+/g, " ").trim();
      if (text) {
        for (const id of ids)
          anchors.set(path + "#" + id, paragraphs.length + 1);
        paragraphs.push(text);
        links.push(linked >= 0.8 * text.replace(/\s/g, "").length);
        characters += text.length;
      }
      pending = "";
      ids = [];
      linked = 0;
    };
    let visited = 0;
    const walk = (node, depth = 0) => {
      if (++visited > 200000 || depth > 128)
        throw Error("The EPUB chapter is too complex.");
      signal?.throwIfAborted();
      if (node.nodeType === 3) {
        pending += node.textContent;
        if (inLink) linked += node.textContent.replace(/\s/g, "").length;
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.localName.toLowerCase(),
        block =
          /^(p|h[1-6]|div|section|article|li|blockquote|pre|tr|br|hr)$/.test(
            tag,
          );
      if (block) flush();
      const id = node.getAttribute("id");
      if (id) {
        anchors.set(path + "#" + id, paragraphs.length + 1);
        ids.push(id);
      }
      // A link to another place in the book, not out of it.
      const inside =
        tag === "a" && !/^[a-z][\w+.-]*:/i.test(node.getAttribute("href") ?? "x:");
      if (inside) inLink++;
      for (const child of node.childNodes) walk(child, depth + 1);
      if (inside) inLink--;
      if (block) flush();
    };
    walk(body);
    flush();
    // Nothing left to read (a title page): links to it lead nowhere.
    if (paragraphs.length < first)
      for (const key of anchors.keys())
        if (key === path || key.startsWith(path + "#")) anchors.delete(key);
    if (marked && paragraphs.length >= first) bodyPath ??= path;
    const heading = [...body.querySelectorAll("h1,h2,h3")]
      .map((h) => h.textContent.replace(/\s+/g, " ").trim())
      .find(Boolean);
    if (paragraphs.length >= first)
      sections.push({
        title: (heading || "Chapter " + (n + 1)).slice(0, 120),
        paragraph: first,
      });
    // Longer than one reading is fine (the app offers it in parts); this
    // only guards memory.
    if (characters > MAX_BOOK_CHARACTERS)
      throw Error("This EPUB contains too much text. Import a smaller book.");
  }
  // Project Gutenberg EPUBs without marked-up boilerplate still carry the
  // START / END lines around the book.
  const start = paragraphs.findIndex((p) =>
      /^\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG/i.test(p),
    ),
    end = paragraphs.findIndex((p) =>
      /^\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG/i.test(p),
    );
  if (start >= 0 || end > 0) {
    const from = start + 1,
      to = end > from ? end : paragraphs.length;
    left.add("the Project Gutenberg header and licence");
    paragraphs.splice(to);
    paragraphs.splice(0, from);
    links.splice(to);
    links.splice(0, from);
    for (const [key, value] of anchors) {
      if (value <= from || value > to) anchors.delete(key);
      else anchors.set(key, value - from);
    }
    for (let i = sections.length - 1; i >= 0; i--) {
      sections[i].paragraph -= from;
      if (
        sections[i].paragraph < 1 ||
        sections[i].paragraph > paragraphs.length
      )
        sections.splice(i, 1);
    }
  }
  if (!paragraphs.length)
    throw Error("No readable text was found in this EPUB.");
  // A contents list written out in the text (as Project Gutenberg's are)
  // goes; links and sections that led to it lead on to what follows.
  const drop = contentsLists(paragraphs, links);
  if (drop.size) {
    left.add("the contents list");
    const next = [];
    let kept = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      next.push(kept + 1);
      if (!drop.has(i)) paragraphs[kept++] = paragraphs[i];
    }
    paragraphs.length = kept;
    for (const [key, value] of anchors) {
      const moved = next[value - 1];
      if (moved > kept) anchors.delete(key);
      else anchors.set(key, moved);
    }
    for (let i = sections.length - 1; i >= 0; i--) {
      sections[i].paragraph = next[sections[i].paragraph - 1];
      if (sections[i].paragraph > kept) sections.splice(i, 1);
    }
  }
  let toc = [],
    landmark = null;
  const nav = [...manifest.values()].find((i) =>
    (i.getAttribute("properties") || "").split(/\s+/).includes("nav"),
  );
  const ncx = [...manifest.values()].find(
    (i) => i.getAttribute("media-type") === "application/x-dtbncx+xml",
  );
  try {
    if (nav) {
      const path = resolvePath(packagePath, nav.getAttribute("href")).path,
        doc = xml(await zip.read(path));
      const tocNav =
        [...doc.querySelectorAll("nav")].find(
          (n) =>
            (n.getAttribute("epub:type") || n.getAttribute("type") || "") ===
            "toc",
        ) || doc.querySelector("nav");
      toc = [...(tocNav?.querySelectorAll("a[href]") || [])].map((a) => ({
        title: tocTitle(a),
        ...resolvePath(path, a.getAttribute("href")),
      }));
      // Where the landmarks say the main text starts.
      const main = [...doc.querySelectorAll("nav a[href]")].find(
        (a) =>
          a.closest("nav") !== tocNav &&
          kindsOf(a).includes("bodymatter"),
      );
      if (main) landmark = resolvePath(path, main.getAttribute("href"));
    } else if (ncx) {
      const path = resolvePath(packagePath, ncx.getAttribute("href")).path,
        doc = xml(await zip.read(path));
      toc = [...doc.querySelectorAll("navPoint")].map((n) => ({
        title: n.querySelector("navLabel > text")?.textContent || "",
        ...resolvePath(
          path,
          n.querySelector("content")?.getAttribute("src") || "",
        ),
      }));
    }
  } catch {
    /* Spine headings remain a usable fallback. */
  }
  const at = (place) =>
    place &&
    (anchors.get(place.path + (place.anchor ? "#" + place.anchor : "")) ||
      anchors.get(place.path));
  const mapped = toc
    .map((t) => ({ title: t.title.slice(0, 120), paragraph: at(t) }))
    .filter((t) => t.title && t.paragraph && !isContentsTitle(t.title));
  const chapters = sections.filter((s) => !isContentsTitle(s.title));
  const guide = [...pkg.querySelectorAll("guide > reference")].find((r) =>
    /^(?:text|start|bodymatter)$/i.test(r.getAttribute("type") || ""),
  );
  let guideAt = 0;
  try {
    guideAt =
      (guide && at(resolvePath(packagePath, guide.getAttribute("href")))) || 0;
  } catch {}
  const opening = findStart(
    paragraphs,
    mapped.length ? mapped : chapters,
    {
      body: at(landmark) || (bodyPath && anchors.get(bodyPath)) || 0,
      guide: guideAt,
    },
  );
  return {
    text: paragraphs.map(tidyPunctuation).join("\n\n"),
    title: (
      pkg.getElementsByTagNameNS("*", "title")[0]?.textContent ||
      file.name.replace(/\.epub$/i, "")
    )
      .trim()
      .slice(0, 240),
    sections: mapped.length ? mapped : chapters,
    // Where each chapter file starts, for splitting a long book into parts.
    chapterStarts: chapters,
    chapters: spine.length,
    // Where the book's own text starts (a paragraph number, from 1), the
    // front matter before it, and what was left out of the text.
    start: opening.paragraph,
    before: opening.before,
    left: [...left],
  };
}

// A book longer than one reading is offered in parts. Parts break at
// table-of-contents entries where possible, and between paragraphs when a
// single chapter is itself too long.
export function bookParts(book, limit) {
  if (book.text.length <= limit) return [book];
  const paragraphs = book.text.split("\n\n");
  const marks = book.sections.map((s) => ({ ...s }));
  const chapters = (book.chapterStarts || []).map((s) => ({ ...s }));
  const starts = new Set();
  const markStarts = () => {
    starts.clear();
    for (const s of [...marks, ...chapters]) starts.add(s.paragraph - 1);
  };
  markStarts();
  const budget = Math.floor(limit * 0.95);
  const parts = [];
  let from = 0;
  while (from < paragraphs.length) {
    let size = 0,
      to = from,
      lastBreak = -1;
    while (to < paragraphs.length) {
      const next = size + paragraphs[to].length + (to > from ? 2 : 0);
      if (next > budget && to > from) break;
      size = next;
      to++;
      if (starts.has(to)) lastBreak = to;
    }
    // Prefer ending at a chapter, unless that would leave the part short.
    if (to < paragraphs.length && lastBreak > from) {
      let kept = 0;
      for (let i = from; i < lastBreak; i++) kept += paragraphs[i].length + 2;
      if (kept >= budget / 2) to = lastBreak;
    }
    // One paragraph longer than a reading: cut it at a sentence or space.
    if (to === from + 1 && paragraphs[from].length > budget) {
      const long = paragraphs[from];
      let cut = long.lastIndexOf(". ", budget - 1);
      if (cut < budget / 2) cut = long.lastIndexOf(" ", budget - 1);
      if (cut < budget / 2) cut = budget;
      paragraphs.splice(
        from,
        1,
        long.slice(0, cut + 1).trim(),
        long.slice(cut + 1).trim(),
      );
      for (const s of [...marks, ...chapters])
        if (s.paragraph - 1 > from) s.paragraph++;
      markStarts();
      continue;
    }
    const inPart = (list) =>
      list
        .filter((s) => s.paragraph - 1 >= from && s.paragraph - 1 < to)
        .map((s) => ({ ...s, paragraph: s.paragraph - from }));
    const start = (book.start || 1) - 1;
    parts.push({
      ...book,
      text: paragraphs.slice(from, to).join("\n\n"),
      sections: inPart(marks),
      chapterStarts: inPart(chapters),
      start: start >= from && start < to ? start - from + 1 : 1,
      before: start >= from && start < to ? book.before || [] : [],
    });
    from = to;
  }
  return parts;
}
