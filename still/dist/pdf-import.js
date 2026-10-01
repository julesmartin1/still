import { loadPdfjs } from "./pdfjs.js";
import { suggestTitle } from "./document.js";
import { layoutPage, composePdf } from "./pdf-layout.js";
// Text extraction only. PDF bytes stay on the device; PDF scripts are never run.
export function pageText(items) {
  const paragraphs = [];
  let lines = [],
    line = "",
    previous = null;
  const endLine = () => {
    if (line.trim()) lines.push(line.trim());
    line = "";
  };
  const endParagraph = () => {
    endLine();
    if (lines.length) paragraphs.push(lines.join(" "));
    lines = [];
  };
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const value = item.str.replace(/\u00ad/g, "").replace(/[\t\r\n]+/g, " ");
    if (previous && value.trim()) {
      const gap = Math.abs(item.transform[5] - previous.transform[5]);
      const height = Math.max(
        Math.abs(item.height || item.transform[3]),
        Math.abs(previous.height || previous.transform[3]),
        1,
      );
      if (gap > height * 1.65) endParagraph();
      else if (gap > height * 0.5) endLine();
      else if (line && !/\s$/.test(line) && !/^\s/.test(value)) {
        const right = previous.transform[4] + (previous.width || 0);
        if (item.transform[4] - right > height * 0.12) line += " ";
      }
    }
    line += value;
    if (item.hasEOL) endLine();
    if (value.trim()) previous = item;
  }
  endParagraph();
  return paragraphs
    .join("\n\n")
    .replace(/\u0000/g, "")
    .trim();
}
export function pdfErrorMessage(error) {
  if (error?.userMessage) return error.userMessage;
  if (error?.name === "NotReadableError" || error?.name === "NotFoundError")
    return "Your browser could not open this file. Make sure it is downloaded to your device, then choose it again.";
  if (
    /fetch|dynamically imported|module script|worker|network|load failed/i.test(
      error?.message || "",
    )
  )
    return "The PDF reader could not finish loading. Check your connection and retry. If it still fails, refresh Still and choose the PDF again.";

  if (error?.name === "PasswordException")
    return "This PDF is password-protected. Open it in your PDF app and save an unlocked copy to import.";
  if (error?.name === "InvalidPDFException")
    return "This file could not be read as a PDF. Try another PDF or paste its text.";
  return "The PDF import stopped unexpectedly. Retry this file. If it fails again, refresh Still and choose the PDF again.";
}
function fail(message) {
  const error = new Error(message);
  error.userMessage = message;
  throw error;
}
export async function extractPdf(
  file,
  { signal, onProgress = () => {}, getDocument, mode = "auto" } = {},
) {
  if (file.size > 50 * 1024 * 1024)
    fail(
      "Choose a PDF smaller than 50 MB. You can split a larger book into chapters first.",
    );
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf")
    fail("Choose a PDF file. You can paste other text below.");
  signal?.throwIfAborted();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-"))
    fail(
      "This file could not be read as a PDF. Try another PDF or paste its text.",
    );
  if (!getDocument) {
    const pdfjs = await loadPdfjs();
    getDocument = pdfjs.getDocument;
  }
  signal?.throwIfAborted();
  const root = new URL("./vendor/pdfjs/", import.meta.url).href;
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    maxImageSize: 16000000,
    canvasMaxAreaInBytes: 64000000,
    cMapUrl: root + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: root + "standard_fonts/",
    wasmUrl: root + "wasm/",
  });
  const abort = () => {
    void task.destroy().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 60000);
  try {
    const doc = await task.promise;
    let metadata;
    try {
      metadata = await doc.getMetadata?.();
    } catch {}
    if (doc.numPages > 1000)
      fail(
        "This PDF has more than 1,000 pages. Split it into smaller parts to import.",
      );
    const pages = [],
      pageModels = [];
    let blankPages = 0,
      characters = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      signal?.throwIfAborted();
      onProgress(pageNumber, doc.numPages);
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport?.({ scale: 1 });
      const model = {
        number: pageNumber,
        ...layoutPage(content.items, {
          mode,
          width: viewport?.width,
          height: viewport?.height,
        }),
      };
      pageModels.push(model);
      const text = composePdf([model], {
        from: pageNumber,
        to: pageNumber,
      }).text;
      page.cleanup();
      if (!text.trim()) blankPages++;
      else pages.push(text);
      characters += text.length;
      if (characters > 2000000)
        fail(
          "There is too much text to import at once. Split the PDF into smaller parts.",
        );
    }
    if (!pages.length)
      fail(
        "No selectable text found. This PDF may be scanned images. Use a PDF with selectable text, or copy text from an OCR tool.",
      );
    signal?.throwIfAborted();
    let outline = [];
    try {
      outline = await readOutline(doc);
    } catch {
      /* A broken table of contents should not stop the import. */
    }
    return {
      outline,
      ...composePdf(pageModels),
      pageModels,
      text: composePdf(pageModels).text,
      title: suggestTitle({
        metadata: metadata?.info?.Title,
        pages: pageModels,
        filename: file.name,
      }),
      pages: doc.numPages,
      blankPages,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}

// The PDF's own table of contents (its "bookmarks"), as
// [{ title, page, top, depth }]. `top` is the y position the entry points at,
// in PDF units, or null when it points at the whole page. Two levels deep
// covers "Part / Chapter" without listing every subsection.
export async function readOutline(doc, { maxDepth = 1, limit = 200 } = {}) {
  const items = await doc.getOutline?.();
  if (!Array.isArray(items) || !items.length) return [];
  const out = [];
  const walk = async (list, depth) => {
    for (const item of list) {
      if (out.length >= limit) return;
      let dest = item.dest;
      if (typeof dest === "string") dest = await doc.getDestination(dest);
      const title = (item.title || "").replace(/\s+/g, " ").trim();
      if (title && Array.isArray(dest) && dest[0] != null) {
        const pageIndex =
          typeof dest[0] === "number"
            ? dest[0]
            : await doc.getPageIndex(dest[0]);
        const kind = dest[1]?.name;
        const top =
          kind === "XYZ" ? dest[3] : /^FitB?H$/.test(kind || "") ? dest[2] : null;
        out.push({
          title: title.slice(0, 120),
          page: pageIndex + 1,
          top: typeof top === "number" ? top : null,
          depth,
        });
      }
      if (item.items?.length && depth < maxDepth)
        await walk(item.items, depth + 1);
    }
  };
  await walk(items, 0);
  return out;
}
