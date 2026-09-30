const decoder = new TextDecoder();
export async function unzipEpub(buffer) {
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
    entries.set(name, {
      method,
      size,
      data: bytes.subarray(dataStart, dataStart + packed),
    });
  }
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
    return decoder.decode(result);
  };
  return { entries, read };
}
function xml(value) {
  if (/<!DOCTYPE|<!ENTITY/i.test(value))
    value = value.replace(/<!DOCTYPE[^>]*>/gi, "");
  const doc = new DOMParser().parseFromString(value, "application/xml");
  if (doc.querySelector("parsererror"))
    throw Error("This EPUB contains unreadable chapter markup.");
  return doc;
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
  const zip = await unzipEpub(await file.arrayBuffer());
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
    sections = [],
    anchors = new Map();
  let characters = 0;
  const spine = [...pkg.querySelectorAll("spine > itemref")].filter(
    (i) => i.getAttribute("linear") !== "no",
  );
  for (let n = 0; n < spine.length; n++) {
    signal?.throwIfAborted();
    onProgress(n + 1, spine.length);
    const item = manifest.get(spine[n].getAttribute("idref"));
    if (!item) throw Error("An EPUB chapter is missing from the manifest.");
    const path = resolvePath(packagePath, item.getAttribute("href")).path;
    const doc = xml(await zip.read(path));
    doc
      .querySelectorAll("script,style,nav,iframe,object,noscript")
      .forEach((e) => e.remove());
    const body = doc.querySelector("body");
    if (!body) continue;
    const first = paragraphs.length + 1;
    anchors.set(path, first);
    let pending = "",
      ids = [];
    const flush = () => {
      const text = pending.replace(/\s+/g, " ").trim();
      if (text) {
        for (const id of ids)
          anchors.set(path + "#" + id, paragraphs.length + 1);
        paragraphs.push(text);
        characters += text.length;
      }
      pending = "";
      ids = [];
    };
    const walk = (node) => {
      if (node.nodeType === 3) {
        pending += node.textContent;
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
      for (const child of node.childNodes) walk(child);
      if (block) flush();
    };
    walk(body);
    flush();
    const heading = [...body.querySelectorAll("h1,h2,h3")]
      .map((h) => h.textContent.replace(/\s+/g, " ").trim())
      .find(Boolean);
    if (paragraphs.length >= first)
      sections.push({
        title: (heading || "Chapter " + (n + 1)).slice(0, 120),
        paragraph: first,
      });
    if (characters > 2000000)
      throw Error("This EPUB contains too much text. Import a smaller book.");
  }
  if (!paragraphs.length)
    throw Error("No readable text was found in this EPUB.");
  let toc = [];
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
        title: a.textContent.trim(),
        ...resolvePath(path, a.getAttribute("href")),
      }));
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
  const mapped = toc
    .map((t) => ({
      title: t.title.slice(0, 120),
      paragraph:
        anchors.get(t.path + (t.anchor ? "#" + t.anchor : "")) ||
        anchors.get(t.path),
    }))
    .filter((t) => t.title && t.paragraph);
  return {
    text: paragraphs.join("\n\n"),
    title: (
      pkg.getElementsByTagNameNS("*", "title")[0]?.textContent ||
      file.name.replace(/\.epub$/i, "")
    )
      .trim()
      .slice(0, 240),
    sections: mapped.length ? mapped : sections,
    chapters: spine.length,
  };
}
