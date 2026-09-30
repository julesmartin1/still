# Still — cofounder handoff

This folder contains editable source, not an installed iPhone app. Open the entire folder in your coding assistant so it can read both projects and the release notes.

## Start with the working website

In a terminal, enter `still`, then run `npm start` (Node.js 20+). Open http://127.0.0.1:4173. Run `npm test` to check the reader logic. No dependency installation is needed. `dist/` contains the editable static application, including its bundled dictionary and PDF library.

The original private hosting configuration is omitted. Choose your own hosting destination if deploying a copy. This ZIP does not grant access to the owner's hosted site.

## Work on the iPhone/iPad version

Use a Mac with full Xcode and Node.js 24+. Enter `still-ios`, run `npm ci`, `npm test`, and `npm run sync`. Open `ios/App/App.xcodeproj` in Xcode, select the App scheme and an iPhone simulator, then build/run. Keep `app-store-release` beside `still-ios`; supporting scripts rely on that layout. `npm run test:native-core` checks the storage core on macOS. Read the native README for simulator commands and real-device checks.

The native project is a development candidate. It has not yet been compiled or tested in an iOS runtime. Its provisional bundle identifier must be replaced before distribution. Signing, publisher facts, device tests and release reviews are still outstanding. `npm run check:release` intentionally fails while these remain unresolved; do not bypass it.

At handoff on 2026-09-27, the owner's Mac had less than 300 MB free and macOS 26.2. The App Store Xcode listing required macOS 26.6+. Xcode installation has not been completed. Free space and a compatible macOS/Xcode combination are required before continuing native verification.

## Give your coding assistant this prompt

“Read START-HERE.md, still-ios/README.md, and app-store-release/STATUS.md. Help me develop Still with my cofounder. First inspect the current implementation and run the relevant existing tests. Preserve the average-WPM pacing and short-word timing floor, paragraph review, local document storage and optional academic citation filtering. Do not introduce comprehension quizzes. For iOS, compile and test the actual native project before claiming it works on an iPhone. Keep release blockers and evidence honest. Ask which feature we are collaborating on before changing behavior.”

## Collaborating without overwriting each other

This ZIP is a snapshot, not live synchronization. For ongoing work, put this folder in a private shared Git repository and give each person a separate branch. Review and merge changes before starting overlapping work. Agree whether a change targets the web app, native app, or both: they currently contain separate copies of shared reader code. Existing Git history is not included; source revisions are recorded in SOURCE-MANIFEST.json.

No personal reading library, signing credentials, node_modules, or local build caches are included. Original third-party licenses are retained. Release documents are development records and drafts, not security certification or legal clearance.

Some older web README sections describe earlier prototypes; inspect the code and later sections for current features. Test receipts in app-store-release describe the recorded checkpoint, not a fresh native build on your machine.
