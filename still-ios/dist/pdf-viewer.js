import { loadPdfjs } from "./pdfjs.js";
import { sourceLocation } from "./pdf-layout.js";
const $ = (id) => document.getElementById(id);
export function createPdfViewer({ getIndex, onRead }) {
  let source = null,
    task = null,
    doc = null,
    renderTask = null,
    generation = 0,
    pageNumber = 1,
    selected = null;
  function select(location) {
    selected = location;
    for (const b of $("pdfHighlights").children)
      b.classList.toggle(
        "selected",
        location &&
          Number(b.dataset.start) <= (location.focusIndex ?? location.start) &&
          Number(b.dataset.end) >= (location.focusIndex ?? location.start),
      );
    $("sourceSelection").textContent = location
      ? location.text
      : "No imported text on this page.";
    $("sourceRead").disabled = !location;
  }
  async function render() {
    if (!doc) return;
    const version = ++generation;
    const previousRender = renderTask;
    previousRender?.cancel();
    await previousRender?.promise.catch(() => {});
    if (version !== generation || !doc) return;
    $("sourceStatus").textContent = "Loading page…";
    $("pdfHighlights").replaceChildren();
    $("sourceRead").disabled = true;
    $("sourcePage").value = pageNumber;
    $("sourceTotal").textContent = `of ${doc.numPages}`;
    $("sourcePrev").disabled = pageNumber <= 1;
    $("sourceNext").disabled = pageNumber >= doc.numPages;
    try {
      const page = await doc.getPage(pageNumber);
      if (version !== generation) return;
      const normal = page.getViewport({ scale: 1 }),
        width =
          Math.min(960, Math.max(220, $("pdfScroll").clientWidth - 24)) *
          Number($("sourceZoom").value);
      const viewport = page.getViewport({ scale: width / normal.width });
      const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16000000 / (viewport.width * viewport.height)),
        ),
        canvas = $("pdfCanvas");
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      $("pdfPageSurface").style.width = viewport.width + "px";
      $("pdfPageSurface").style.height = viewport.height + "px";
      renderTask = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
      });
      await renderTask.promise;
      if (version !== generation) return;
      const lines = source.locations.filter((l) => l.page === pageNumber);
      for (const location of lines) {
        const rect = [
            ...viewport.convertToViewportPoint(
              location.rect[0],
              location.rect[1],
            ),
            ...viewport.convertToViewportPoint(
              location.rect[2],
              location.rect[3],
            ),
          ],
          button = document.createElement("button");
        button.className = "pdf-line";
        button.dataset.start = location.start;
        button.dataset.end = location.end;
        button.style.left = Math.min(rect[0], rect[2]) + "px";
        button.style.top = Math.min(rect[1], rect[3]) + "px";
        button.style.width = Math.max(8, Math.abs(rect[2] - rect[0])) + "px";
        button.style.height = Math.max(8, Math.abs(rect[3] - rect[1])) + "px";
        button.setAttribute("aria-label", "Read line: " + location.text);
        button.onclick = () => select(location);
        $("pdfHighlights").append(button);
      }
      const current = sourceLocation(source.locations, getIndex());
      select(
        selected?.page === pageNumber
          ? selected
          : current?.page === pageNumber
            ? current
            : lines[0],
      );
      $("sourceStatus").textContent = lines.length
        ? "Choose a line on the page to read from there."
        : "This page is outside your imported range or has no selectable text.";
      $("pdfHighlights")
        .querySelector(".selected")
        ?.scrollIntoView({ block: "center" });
    } catch (error) {
      if (
        version !== generation ||
        error?.name === "RenderingCancelledException"
      )
        return;
      $("sourceStatus").textContent =
        "This page could not load. Try another page or reopen the PDF.";
    }
  }
  $("sourceZoom").onchange = () => render();
  $("sourcePrev").onclick = () => {
    pageNumber--;
    render();
  };
  $("sourceNext").onclick = () => {
    pageNumber++;
    render();
  };
  $("sourcePageForm").onsubmit = (e) => {
    e.preventDefault();
    const value = Number($("sourcePage").value);
    if (Number.isInteger(value) && value >= 1 && value <= doc.numPages) {
      pageNumber = value;
      render();
    }
  };
  $("sourceCurrent").onclick = () => {
    selected = sourceLocation(source.locations, getIndex());
    pageNumber = selected?.page || 1;
    render();
  };
  $("sourceRead").onclick = () => {
    if (selected) {
      const index = selected.start;
      $("sourceDialog").close();
      onRead(index);
    }
  };
  $("sourceDialog").addEventListener("close", () => {
    generation++;
    renderTask?.cancel();
    doc = null;
    const old = task;
    task = null;
    void old?.destroy().catch(() => {});
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    if ($("sourceDialog").open) resizeTimer = setTimeout(() => render(), 180);
  });
  return {
    async open(value) {
      source = value;
      selected = sourceLocation(source.locations, getIndex());
      pageNumber = selected?.page || 1;
      $("sourceDialog").showModal();
      $("sourceStatus").textContent = "Opening original PDF…";
      $("sourceRead").disabled = true;
      $("pdfHighlights").replaceChildren();
      $("pdfCanvas").width = 0;
      const version = ++generation;
      try {
        const pdfjs = await loadPdfjs();
        const bytes = new Uint8Array(await source.blob.arrayBuffer());
        if (version !== generation) return;
        const root = new URL("./vendor/pdfjs/", import.meta.url).href;
        task = pdfjs.getDocument({
          data: bytes,
          isEvalSupported: false,
          maxImageSize: 16000000,
          canvasMaxAreaInBytes: 64000000,
          cMapUrl: root + "cmaps/",
          cMapPacked: true,
          standardFontDataUrl: root + "standard_fonts/",
          wasmUrl: root + "wasm/",
        });
        const loaded = await task.promise;
        if (version !== generation) return;
        doc = loaded;
        $("sourcePage").max = doc.numPages;
        await render();
      } catch {
        if (version === generation)
          $("sourceStatus").textContent =
            "The original PDF could not open. Close this view and try again.";
      }
    },
  };
}
