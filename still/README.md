# Still

A responsive reading prototype with one word at a fixed central point, adaptive timing, paragraph review, word definitions, and device-local reading progress.

## Run

Requires Node.js 20 or newer. No installation is needed.

```sh
npm start
```

Open http://127.0.0.1:4173. Run `npm test` for the deterministic behavior checks.

## Reading

Choose **Add reading** to import a PDF or paste a passage, or start with the included sample. Set a starting pace, then start reading. **Review paragraph** pauses playback and opens the surrounding paragraph. Choose a word and select **Read from here**, or look up its definition. Escape closes a dialog without resuming playback. Space pauses active playback; after starting or resuming, focus stays on the playback button so Space toggles predictably. R opens review outside text inputs. Switching away from the tab pauses playback.

Text, position, base speed and learned preferences are stored in this browser's localStorage. Opening a new passage keeps the previous reading and its place in the device-local bookshelf. Storage is device- and origin-specific; there is no account or synchronization. Reset adjustments clears learned slowdown, rewind history and looked-up words, preserving text and base speed.

## Pacing defaults

The slider specifies a target average WPM for a full paragraph. The engine computes relative weights, then divides the paragraph time budget proportionally among words:

- Length weight: clamp(1 + 0.04 × max(0, Unicode letter count − 5), 1, 1.5).
- Obscurity heuristic: +0.16; sentence complexity: up to +0.18.
- Looked-up words: +0.25, fading over 30 days.
- Comma/colon/semicolon: +0.35; sentence ending: +0.7; paragraph ending: +0.6.
- Start with proportional allocation, then pin any word below its minimum and redistribute the remaining budget among the other words.
- Minimum time = max(85% of the average word time, min(140 ms, 95% of the average word time)). At 300 WPM every word gets at least 170 ms. The floor scales at high WPM so the paragraph target stays feasible.

Thus punctuation and difficult words redistribute time rather than silently lowering the average. A one-word paragraph receives exactly one word's budget. Whole-book difficulty does not add a uniform penalty, which would cancel during normalization.

Repeated rewinds across distinct paragraphs retain the existing gradual adjustment (up to 20% extra time). The target average becomes chosen WPM / (1 + slowdown). Replayed paragraphs receive another 16% extra time. The interface shows the current target. Manual speed changes clear both gradual and replay slowdown; reset also clears word lookups. No acceleration is inferred from an absence of rewinds.

Plans are computed on load and pacing changes, not on each displayed word. Playback gives every word its full planned duration; late browser timers never trigger catch-up flashes. Browser scheduling can still introduce delays; pauses, mid-paragraph speed changes, and partial replays are outside the complete-paragraph average guarantee.

## Dictionary

The site bundles 77,568 alphabetic English WordNet headwords, with one leading sense per part of speech and simple inflection handling. It loads only the relevant alphabetical data shard. Definitions do not require a third-party dictionary API, and looked-up words are not sent to one. The site still needs to be reachable to load uncached assets; this is not a fully offline app.

Source: WordNet 3.1 via wordnet-db 3.1.14, https://github.com/moos/wordnet-db. License and transformation notes are in `dist/dictionary/`. Regenerate with `scripts/build-dictionary.py` and an extracted copy of that package. WordNet does not cover every inflection, proper name, technical term, or newly coined word. Meanings are not selected by sentence context.

## Original verification

Ten deterministic tests cover token order, paragraph mapping, punctuation and complexity timing, bounded rewind adaptation, lookup decay, pace bounds, pause/resume, exact restart/end behavior, dictionary data/inflections, and safe timing for object-property names. Browser checks covered paste/load, play/pause, paragraph selection, exact restart, dictionary success and missing-word states, reload persistence, keyboard review, and phone layout at 390×844. Both WebMCP tools were invoked, including invalid pace rejection and unchanged state read-back. No new console errors remained after the timer binding fix.

No build step is needed: `dist/` is the complete static app. The private Sites manifest lives in `.openai/hosting.json`. Kindle/library import, EPUB handling, account sync, and trained personalization models are future work.

## PDF import

Add reading → Import a PDF extracts selectable text entirely in the browser using bundled PDF.js 6.3.289 (Apache-2.0 license in `dist/vendor/pdfjs/LICENSE`). The extracted title and text can be edited before opening the reader. Imports show page progress and can be cancelled. Existing reading and draft text remain intact on failure. PDF bytes are not uploaded or saved; extracted text uses the existing device-local storage. Only the position is written during playback, avoiding repeatedly serializing a large document.

Current limits: 50 MB, 1,000 pages, two million extracted characters per import. Image-only pages require OCR elsewhere; mixed PDFs report pages with no selectable text. Password-protected PDFs require an unlocked copy. Complex columns, tables and headers may need cleanup in the text preview.

Validation: 15 automated tests pass, including PDF fragment spacing, paragraph breaks, page order, empty-page reporting, invalid/oversized/cancelled input, and password failure messages. Browser-tested a real two-page PDF through import, playback and paragraph review, plus an image-only PDF error preserving the previous text and a 390px mobile import layout.

## Completed prototype improvement loop

- Bookshelf: readings are stored in IndexedDB on this device and origin, with separate text and summary stores. Existing active readings migrate automatically. Each reading resumes at its own position; the finished state survives reload. The active position still uses localStorage for immediate persistence, and library snapshots are written at pauses/switches/completion.
- Navigation: review includes phrase search, direct paragraph jumping and Back to my place. Search and explicit jumps do not train the rewind slowdown. Search returns the first match in each of up to 20 matching paragraphs.
- Pace: type an exact WPM, drag the slider or use ±10 buttons. Input is constrained to 80–600. The short-word timing floor and average-pacing algorithm remain unchanged.
- Usability: playback receives keyboard focus after resume; browser modifier shortcuts remain available; word selection preserves paragraph scroll; consecutive long words are refitted correctly; storage errors remain visible on mobile.

Validation: 25 automated checks pass. Browser checks covered migration, two-reading position isolation, reload recovery, search/restart, paragraph jump and return, exact pace entry and increments, finished-state persistence, full 17-page PDF import into the library, 320px/390px layouts, and no runtime errors. See PROTOTYPE_REVIEW.md for the loop and deferred suggestions.

### Research PDF reading (September 23)
PDF imports now detect a recurring column gap and read each column in order, with explicit one-column/two-column overrides. Spanning lines divide reading sections. Import controls select a page range and optionally remove repeated outer-margin headers/footers and page numbers. The text preview remains editable; editing it disables source linking for that reading because positions would no longer be reliable.

New PDF imports save their original file and line-to-token mapping in a separate IndexedDB `sources` store (database version 2, preserving existing readings). The original-page dialog renders the PDF locally with PDF.js, highlights the current line, provides page navigation and 150–300% zoom, and resumes from a selected line. Source navigation does not train rewind slowdown. Original bytes are not sent to the server or stored in localStorage. Previously imported PDFs must be imported again to retain their originals.

Extraction is geometric, not semantic: tables, unusual layouts, rotated text, and equations can need review. There is no OCR and no automatic section classification. Source highlights identify lines, not individual words. Storage remains device-local and subject to browser quota/clearing.

### Optional citations and research reading quality
Each reading now stores independent Skip inline citations and Skip reference list preferences. Filtering derives visible tokens from immutable original text and keeps original token indices for PDF mapping and saved positions. The reference section has a preview and an editable original-paragraph range; detected appendix headings end the proposed range. Filter changes pause playback. Timing and progress count only visible tokens; source navigation and filter changes do not train slowdown. Paragraph review can show the original paragraph with its citations.

The local citation recognizer supports conservative comma-separated author/year groups, narrative author/year forms and bracketed numeric citations. It retains mixed explanatory parentheses, ordinary dates and common mathematical/statistical forms. Superscript citations, unusual styles and ambiguous constructions are not comprehensively classified. The fixture results are bounded checks, not a universal accuracy guarantee.

PDF layout is partitioned into horizontal regions before gutter detection, and baselines are assembled before column boundaries are applied. This fixes the supplied paper's abstract/sidebar interleaving and displaced font fragments. Dictionary-backed line-end repairs retain genuine compounds and leave unknown forms unchanged. Joined words retain overlapping source-line ranges, so both original lines can be highlighted. Re-import is required to apply extraction changes to existing readings.

### Reading organization and portable bookshelf
- Import suggests Book / Academic paper / Other, with a manual override. Academic imports offer citation/reference switches. Reading settings contains those controls afterward; Books hide them and Other collapses them. Existing active readings retain their citation preferences through type migration.
- Useful PDF metadata or prominent first-page text suggests an editable title (up to 240 characters). Existing titles can be edited in Reading settings.
- A SHA-256 fingerprint detects the same PDF independently of filename. Reopen preserves the saved reading; Import separate copy creates a new entry. Older sources acquire fingerprints lazily. Where multiple copies exist, the most recently updated matching entry is offered.
- Suggested paper sections and book chapters navigate using original paragraph anchors. Headings and their paragraph numbers can be edited, added or removed. Type changes preserve saved heading edits. Detection is heuristic; unusual typography may need correction.
- Starting-point controls preview a chosen heading or original paragraph. Earlier text remains available. Reading pace and adaptive profile are stored per bookshelf entry; old entries without a pace adopt the current pace on first opening.
- Bookshelf Backup & restore exports a versioned JSON file containing text, PDFs, source mapping, preferences, headings, pace and progress. Restore validates before writing all entries in one IndexedDB transaction. Conflicting IDs become separately named restored copies. Existing entries are never overwritten. Export and restore are bounded to 250 MB per backup; source PDFs remain subject to the 50 MB import bound. Backups are ordinary local files, not encrypted cloud sync.

### Reading modes, EPUBs and offline use
Normal text and the word display share the same source position. Tap a word to set the position; scrolling updates it to the first visible line. Large readings load in expandable chunks. Left Arrow or the Sentence button returns to the sentence start (or previous sentence when already at a start).

EPUB import supports DRM-free text EPUBs, deflate/stored ZIP entries, spine order and EPUB 2/3 contents. Images and fixed-layout formatting are not reproduced. Imported markup is never injected into the app. Size/path limits guard extraction. Standard font obfuscation is tolerated; content encryption is rejected.

Saved passages preserve original token ranges and optional notes across citation filtering, reloads and backup/restore. Bookshelf search is title-based. Archive and Trash are recoverable states with Undo; neither deletes original files. Appearance persists per browser.

Reading settings → Appearance & offline reading → Make available offline caches the app, dictionary and PDF assets. Books remain in IndexedDB. Offline availability is device/browser-specific and can be lost if browser storage is cleared. After changes, regenerate the service-worker manifest with `node scripts/offline-assets.mjs` before publishing.

Acceptance verified: mode position continuity, sentence rewind, EPUB spine and TOC order, passage range highlighting and persisted notes, archive/undo/trash restore, dark/mobile layout, and actual app/dictionary/original-PDF use with the localhost server stopped. Automated suite includes the prior citation/PDF/pacing regressions.
