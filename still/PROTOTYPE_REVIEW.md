# Still: prototype review and improvement loop

Completed September 23, 2026.

The finish line was a working loop from importing a reading through paced reading, reviewing, switching readings, and coming back later. The pacing behavior already approved by the user was preserved.

## Findings and changes

| Observed friction | Delivered improvement | Verification |
| --- | --- | --- |
| Loading a new passage replaced the only saved reading. | A device-local bookshelf preserves readings and their separate positions. Existing active reading migrates automatically. | Switched between two readings and reloaded; each resumed at its own word. Imported the supplied 17-page paper into the same library. |
| Long papers required stepping through paragraphs one at a time. | Phrase search, direct paragraph jump, and Back to my place in review. | Found a phrase, resumed at its word, jumped to another paragraph, and returned to the original position. |
| Deliberate navigation could be interpreted as difficulty. | Search and explicit paragraph jumps do not train rewind slowdown. | Navigation logic keeps deliberate jumps separate from ordinary review/replay. |
| Resume returned keyboard focus to Review paragraph. | Playback takes focus after starting/resuming, and Space pauses active playback reliably. | Reviewed, resumed, and used Space to pause without reopening review. |
| Fine speed changes required dragging a slider. | Exact WPM entry and ±10 controls. | Entered 257 WPM, verified target and slider, then stepped to 267. An input-update mismatch discovered in testing was fixed and retested. |
| Finished readings looked unfinished after reload. | Completion state persists in the active reading and bookshelf. | Finished a short passage and reloaded; Read again and Finished were retained. |
| Word selection could disturb scroll, and successive long words could inherit wrapping state. | Preserve paragraph scroll on selection and reset text-fit state before measuring each word. | Code-path review, existing long-word checks, and mobile layout inspection. |

## Checks completed

- 25 automated checks: timing budgets and floors, delayed timers, playback, rewind bounds, dictionary handling, PDF extraction and errors, search, paragraph indexing, and library summary data.
- Browser checks of the complete import/read/review/switch/reload flow.
- Actual supplied PDF: all 17 pages and 17,537 extracted words imported into the bookshelf.
- Narrow layouts checked at 390×844 and 320×740.
- No browser runtime errors during the final checks.

This is verification of behavior and layout, not a claim about how comfortable every reader will find the experience. The next meaningful pacing input is the user's experience with a full reading session.

## Suggested next additions, in priority order

1. **EPUB import.** Add books with chapter boundaries and a table of contents. This is the most direct extension of the existing bookshelf.
2. **Better research-PDF preparation.** Preview reading order for columns and let the reader choose sections or exclude references/tables. Keep this explicit; silently removing text can remove something the reader needs.
3. **Library export and restore.** A downloadable backup would make device-local reading data portable before introducing accounts or synchronization.
4. **Optional offline/mobile installation.** Cache the app and dictionary so an already imported reading remains available without connectivity. Decide this with the user's preferred device in mind.

## Current boundaries

- The bookshelf is local to this browser and site origin; there is no account sync or backup yet. Clearing browser data removes it.
- PDFs must contain selectable text. Scans need OCR elsewhere. Complex layouts may require cleanup in the import preview.
- PDF import is limited to 50 MB, 1,000 pages and two million extracted characters.
- The dictionary is English, and the pacing model remains a tunable heuristic.
- Search shows up to 20 matching paragraphs and selects the first match in each.
- Browser scheduling, pauses and navigation can make elapsed wall-clock pace slower than the planned average. Words are not rushed to catch up.
- Shelf rename/removal and export are not part of this prototype pass.

No quizzes, comprehension scores, speed competitions, accounts, analytics or third-party reading-content uploads were added.

## Research PDF upgrade — September 23
Completed column-aware extraction (with overrides), page-range selection, repeated margin cleanup, local original PDF storage, and a source-page viewer with current-line highlight, line restart, page controls, and zoom. Tested with the supplied research PDF and 30 automated checks. Existing saved readings survive the IndexedDB upgrade; earlier PDF imports need re-importing to retain source pages. Complex tables/equations, semantic section selection, and OCR remain future work. EPUB and library export/restore remain next priorities.
