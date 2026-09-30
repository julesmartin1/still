import {
  mkdir,
  readFile,
  readdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
const escape = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="style.css"><title>${title} — Still</title></head><body><main><a href="index.html">Back to Still</a><h1>${title}</h1>${body}</main></body></html>`;
await writeFile(
  "dist/privacy.html",
  page(
    "Privacy information — draft",
    `<p>This development draft describes the intended local app behavior. It is not the final publisher policy. Publisher identity, support contact, effective date and launch countries must be completed before release.</p><h2>Documents and reading preferences</h2><p>Imported documents, notes, saved places and pace preferences are processed on your device. The app has no account, advertising, analytics or cloud document-sync service. The reader and dictionary are bundled. Native network verification is still pending.</p><h2>Storage and backups</h2><p>The iOS app stores its library in its app sandbox using iOS file protection. Files may be included in device backups under your Apple backup settings. This is not a promise of protection on an unlocked or compromised device.</p><p>Exported bookshelf backups contain document text, original PDFs, notes and settings in readable JSON. They are not password protected. Sharing a backup gives the chosen recipient or app access to its contents. The recipient's practices apply.</p><h2>Deletion</h2><p>Moving an item to Trash retains it. Delete permanently removes that reading and its original from this app's library. Erase all saved readings removes library data and reading preferences. Neither action deletes copies you exported or device backups. Reinstalling or restoring an older device backup may restore older data.</p><h2>Support and external links</h2><p>External links open only when selected. Those sites may receive network information such as your IP address and have separate privacy policies. A public support channel and its retention practices have not yet been selected. Do not send private books or notes in an unsolicited support message.</p><h2>Apple services</h2><p>Apple handles App Store distribution, device backups and any diagnostics you opt to share with Apple under its own settings and policies. Final App Store privacy disclosures must be checked against the signed build.</p>`,
  ),
);
await writeFile(
  "dist/help.html",
  page(
    "Help and limitations",
    `<h2>Bring your reading</h2><p>Use Add reading to choose a downloaded PDF, DRM-free EPUB or plain text file, or paste text. Documents are parsed on-device. Image-only scans need OCR elsewhere. Encrypted files and unusual layouts may be unsupported. Check the extracted text before reading.</p><h2>Read and review</h2><p>Set an average WPM. Longer words and punctuation receive more of the paragraph's time budget. Review opens surrounding text; sentence rewind returns to a sentence start. Normal text lets you read continuously and choose a restart word. No comprehension score or quiz is used.</p><h2>Move from the website</h2><p>In the website's Bookshelf, export a backup. On this device, choose that JSON file in Bookshelf → Backup &amp; restore. Check the contents before confirming. Matching IDs become copies rather than overwriting readings.</p><h2>Keep a backup</h2><p>Store exported copies somewhere you control. The app cannot recover documents after deletion if no backup exists. If storage is unavailable, keep the app installed, unlock the device and retry; do not erase the app to troubleshoot missing documents.</p><h2>Research papers</h2><p>Citation skipping is optional and heuristic. Original text is retained. Unusual citation styles, tables and equations may require manual review. Dictionary entries are English and may not match the context.</p><h2>Support</h2><p>This is a development build. The publisher and public support contact have not yet been selected. They are required before App Store submission.</p>`,
  ),
);
await mkdir("dist/notices", { recursive: true });
const paths = [
  "licenses/Cordova-LICENSE.txt",
  "licenses/Cordova-NOTICE.txt",
  "licenses/Capacitor-SPM-LICENSE.txt",
  "dist/dictionary/LICENSE.txt",
  "dist/dictionary/README.txt",
  "node_modules/@capacitor/core/LICENSE",
  "node_modules/@capacitor/ios/LICENSE",
];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + entry.name;
    if (entry.isDirectory()) await walk(p);
    else if (/LICENSE|NOTICE/.test(entry.name)) paths.push(p);
  }
}
await walk("dist/vendor/pdfjs");
const entries = [];
for (let i = 0; i < paths.length; i++) {
  const filename = "notice-" + i + ".txt";
  await copyFile(paths[i], "dist/notices/" + filename);
  entries.push(
    `<li><a href="notices/${filename}">${escape(paths[i].replace(/^dist\//, ""))}</a></li>`,
  );
}
await writeFile(
  "dist/licenses.html",
  page(
    "Third-party notices",
    `<p>Still uses Capacitor 8.5.2, PDF.js 6.3.289 and WordNet 3.1 data (transformed from wordnet-db 3.1.14). These notices preserve the upstream distribution terms. System fonts are used; no remote font service is loaded.</p><ul>${entries.join("")}</ul><p>Imported books remain the property of their rights holders. Import only files you are entitled to use. Still does not bypass DRM or provide publisher/library integrations.</p>`,
  ),
);
