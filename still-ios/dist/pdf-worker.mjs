// PDF.js worker entry point: install compatibility shims first, then start
// the bundled worker. Static imports run in order, so the shims are in place
// before any PDF.js code executes.
import "./pdf-compat.js";
import "./vendor/pdfjs/pdf.worker.min.mjs";
