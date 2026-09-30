# Architecture decision — 2026-09-23

Use Capacitor 8.5.2 / WKWebView with bundled assets and a small Swift storage/export plugin. This reuses the tested pacing/extraction code and approved interface while allowing native file selection, protected persistent storage, native sharing and scene handling. It is not a wrapper around the private website. First-run assets ship in the binary. Public policy/support hosting remains a separate release decision.

Native code is in `../still-ios/ios/App/App`; source UI in `../still-ios/dist`; generated bundle in `../still-ios/www`. Package/Swift dependencies are pinned. The starting web revision is bd515492a4849b670a8205fd2feb89d11d07b665. The web project itself is unchanged.

One native serialized queue manages immutable object files and an atomic manifest in Application Support. Writes use complete file protection on iOS. Multi-record restore becomes one manifest commit; summaries/readings/originals are deleted together. Corruption, missing referenced files or a missing manifest never silently reset a library. The Foundation core is compiled/tested on macOS, while actual iOS protection and bridge behavior remain unverified.

The app uses transient WK storage and a native preference mirror. Active document text is loaded from the vault; progress checkpoints contain only metadata. Repeated progress updates are throttled, not indefinitely debounced. Exports are temporary protected JSON files presented through the system share sheet and cleaned up on completion. OS backups are allowed for durable documents. The app does not attempt to delete exported copies or prior device backups.

Native Files selection relies on WebKit's file input handling. Real file providers, security-scoped access lifecycle and offline provider failures must be verified on device. If behavior is insufficient, replace it with a UIDocumentPicker adapter; do not claim it works without that test.

Tradeoffs: base64 PDFs and large JSON bridge messages can raise peak memory; the vault rewrites a reading record at a checkpoint. Test allowed limits on the oldest supported device before freezing limits. No independent security review yet. iOS 18.0 is the provisional minimum; older OS support would need feature polyfills and a new test matrix.
