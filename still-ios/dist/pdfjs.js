// Loads the bundled PDF.js with the compatibility shims from pdf-compat.js
// installed on the page and in its worker. Use this instead of importing
// vendor/pdfjs directly.
let loading;
export function loadPdfjs() {
  loading ||= (async () => {
    await import("./pdf-compat.js");
    const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "./pdf-worker.mjs",
      import.meta.url,
    ).href;
    return pdfjs;
  })();
  loading.catch(() => (loading = null));
  return loading;
}
