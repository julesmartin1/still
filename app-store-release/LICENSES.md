# Licensing and provenance inventory

The native build copies original upstream notices into its bundled Third-party notices page. `DEPENDENCY_INVENTORY.json` records npm lock integrity and SHA-256 hashes of bundled dictionary/PDF assets. This is an inventory, not a trademark clearance or legal opinion.

- Capacitor core/iOS 8.5.2: MIT; npm lock pins integrity. Swift package uses exact 8.5.2. Preserve upstream notices, including Cordova transitive notices in frameworks; final archive audit pending.
- PDF.js 6.3.289: Apache-2.0; main license and cmap/font/wasm notices retained. Embedded Foxit, Liberation, OpenJPEG, JBIG2 and QCMS notices copied into the app.
- WordNet 3.1 data transformed from wordnet-db 3.1.14: original license and transformation README retained. No implication that Princeton endorses Still.
- Word frequency lists (still/dist/frequency) derived from wordfreq 3.1.1 data: CC BY-SA 4.0; attribution and terms in frequency/README.txt, linked from the About notes. The lists are a separate data file, not mixed into app code.
- Native visuals: simple Still bars icon/launch screen generated for this app; original web brand carried forward. System fonts replace Google Fonts.
- Build-only packages: npm dependency inventory includes licenses; the tools themselves are not intentionally included in the app runtime. Verify bundle contents during archive inspection.
- Imported user content: never package the owner's papers/books as samples. Synthetic sample text and EPUB test fixture are included; confirm publisher rights to all original project contributions.

Unresolved: final app-name/trademark screening in launch markets, publisher code/artwork rights confirmation, signed archive license completeness and jurisdiction-specific obligations. Do not use a user's private document in store screenshots.

Additional notices added during this pass: Capacitor Swift-PM MIT notice and Apache Cordova LICENSE/NOTICE (including the upstream additional license section). Cordova notice sources fetched from https://raw.githubusercontent.com/apache/cordova-ios/master/LICENSE and https://raw.githubusercontent.com/apache/cordova-ios/master/NOTICE on 2026-09-23. Exact framework distribution still needs signed-archive comparison; current upstream notices are not represented as a complete historical provenance audit.
