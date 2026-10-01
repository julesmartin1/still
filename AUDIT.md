# Audit and fixes

The web app was tested in Chromium on 29–30 September 2026. The testing combined 17 automated browser sessions, a read of the full source, the existing test suites and a review of the iOS and release notes. This file records every finding and what happened to it. The commit history has the detail.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | One reading over 2,000,000 characters made the whole backup unrestorable, and pasted text had no limit. | **Fixed.** Paste and text files use the same limit as EPUB and PDF. Restore skips and names oversized readings instead of failing. Export refuses a backup that restore would reject. |
| 2 | High | "View original PDF" failed on browsers before early 2026 and on iOS before 26.2, while the iOS app targets iOS 18. The cause is PDF.js 6.3 calling `Map.getOrInsertComputed` and other new built-ins. | **Fixed.** `pdf-compat.js` shims each built-in PDF.js calls directly, on the page and in its worker. Verified rendering in Chromium 141. Not yet verified on a real iOS 18 device. |
| 3 | High | Chinese, Japanese and Thai text showed a whole paragraph as one "word". | **Fixed.** `engine.sourceWords()` segments scripts written without spaces using `Intl.Segmenter` and keeps Japanese particles with their word. Citations, backups and PDF links count words the same way. |
| 4 | Medium | Space re-opened the last dialog instead of playing. | **Fixed.** Focus returns to Play after actions that go back to reading. |
| 5 | Medium | R (and Left Arrow) crashed when citation filtering hid every word. | **Fixed.** |
| 6 | Medium | Very long readings overflowed localStorage, stalled playback about 240 ms per word, and reopened the wrong reading after a reload. | **Fixed.** Readings over 500k characters keep their text only in the bookshelf. A failed save is not retried on every word. |
| 7 | Medium | Bookmarks couldn't be deleted (and duplicated), and the Trash couldn't be emptied. | **Fixed.** Delete asks for confirmation in place, saving the same passage again edits it, and the Trash has Empty Trash and Delete permanently. |
| 8 | Medium | Two-column PDFs came out in the wrong order when paragraph gaps lined up across columns. | **Fixed.** A page-wide gutter is found before splitting at gaps, and sentences continue across column and page breaks. Tested on generated papers only, not real journal PDFs yet. |
| 9 | Medium | Right-to-left text was laid out left-to-right. | **Fixed** with `dir="auto"` on every text surface. |
| 10 | Medium | Screen readers heard nothing during playback. | **Fixed.** Play and pause announce the position, and the progress bar is a real progressbar. |
| 11 | Low | Old offline caches were never deleted. | **Fixed.** |
| 12 | Low | The web app loaded Google Fonts: a privacy leak, render-blocking, and broken offline. | **Fixed** by the shared iOS code (system fonts). Bundling Literata and DM Sans (both OFL) would restore the original look. |
| 13 | Low | The theme ignored the device's dark mode. | **Fixed.** The default is now Follow device. |
| 14 | Low | Muted text contrast was 4.35:1. | **Fixed.** Now at least 4.5:1 on every light surface. |
| 15 | Low | Reduced motion was ignored. | **Fixed.** The shared CSS removes transitions, and the soft fade turns off. |
| 16 | Low | Tap targets were under 44 px. | **Fixed.** |
| 17 | Low | The import dialog had two PDF pickers and the paste box sat below the fold on phones. | **Fixed.** The paste box comes first, then one button each for text, EPUB and PDF. |
| 18 | Low | The pace box applied 100 while you were typing 1000. | **Fixed.** It applies on Enter or when you leave the box. |
| 19 | Low | Bookshelf search matched titles only. | **Fixed.** It matches text too. |
| 20 | Low | Page numbers stayed in 2-page PDFs. | **Fixed.** |
| 21 | Low | Trashing the open reading left it open. | **Fixed.** The app opens the next reading. |
| 22 | Low | Plural wording ("1 words"). | **Fixed.** |
| 23 | Low | A title edit is lost when Settings is closed with Escape. | **Kept.** Escape means cancel. |
| 24 | Nit | Markdown symbols are read aloud as-is. | Not done. |
| 25 | Structural | The web and iOS apps had drifted apart as two copies. | **Fixed.** There is one shared source plus `scripts/sync-shared.mjs`, with a check that fails if they differ. |
| 26 | Structural | There were no interface tests, which is where most bugs were. | **Fixed.** `still/tests/ui/run.py` has 19 browser checks. |

One early finding was withdrawn: "offline download fails". It came from an incomplete copy of the app made for testing, not from the app.

## Word transition: what the research supports

The request was for a fade instead of words "popping up". The research points in two directions:

- **Don't fade slowly, and never cross-fade.**
  - In one-word-at-a-time reading, each word visually masks the one before and after it, and that masking is one of the main limits on reading speed (Primativo et al., 2016).
  - Overlapping two words makes the masking worse.
  - Readers also need roughly the first 50–60 ms of a word in clear view to recognise it (disappearing-text studies, Liversedge et al.). A long fade would eat into that time: at 260 WPM a word is only on screen for about 230 ms.
- **Keep the eye still.**
  - A word is recognised fastest when the eye lands slightly left of its centre, the "optimal viewing position" (O'Regan and Jacobs).
  - Centring every word moves the letters under the eye each time the word length changes, which is part of what reads as a "pop".

What changed:

1. **Each word fades in over 12–40 ms** (default), which is 1–2 frames and at most 12% of the word's time. This softens the onset without cutting into recognition time, and it turns off under reduced motion. The fade is a comfort choice: no evidence shows it changes comprehension.
2. **Words can be anchored on a focus letter** (optional). The letter about a third of the way into each word sits exactly between the two marks and is tinted.

Both are in Reading settings, under Appearance. "Instant" turns off the fade.

Anchoring was the default at first. In use, it made longer words look off-centre, because nothing showed why they had moved. Words are now centred by default. Choosing "Anchored" tints the focus letter so the shift reads as deliberate.

## Comprehension check-ins: design notes

The handoff says "do not introduce comprehension quizzes", so check-ins aren't quizzes. Nothing is graded and there are no right answers.

- **Recap before rating.** Recalling a passage in your own words improves retention more than re-reading it (Roediger and Karpicke, 2006). Writing a few keywords before judging your own understanding also makes that judgment more accurate (Thiede, Anderson and Therriault, 2003).
- **Lost the thread → slower replay.** One-word reading removes the quick glances back that normally repair missed meaning (Rayner et al., 2016), so the fix offered is to reread that stretch, slower.
- **Three clear check-ins in a row → +10 WPM offered.** It is offered, never applied automatically.
- **Timing.** Check-ins come every ~3 minutes of reading, at a paragraph end, snapping to a section end when one is close. They can be set to happen only at section ends, or turned off.

Worth measuring next, with users' consent: whether people who use check-ins rate "Lost" less often over time, and whether the pace suggestions get accepted.

## Still open

- **The iOS app has never been compiled.** It needs a Mac with enough disk space and an Xcode-compatible macOS. After that:
  - run `npm run build` (esbuild) to confirm the new shared files bundle for the `safari18` target;
  - test the PDF page view on an iOS 18 simulator.
- **Two-column PDF order** should be checked against a handful of real journal articles.
- **Bundle the original fonts** (Literata and DM Sans) if the pre-change look matters.

## Sources

- Rayner, Schotter, Masson, Potter and Treiman (2016). *So much to read, so little time.* Psychological Science in the Public Interest.
- Primativo, Spinelli, Zoccolotti, De Luca and Martelli (2016). *Perceptual and cognitive factors imposing "speed limits" on reading rate: a study with the rapid serial visual presentation.* PLoS ONE. https://pmc.ncbi.nlm.nih.gov/articles/PMC4835101
- Liversedge et al. *Reading disappearing text: cognitive control of eye movements.*
- O'Regan and Jacobs (1992). Optimal viewing position effect in word recognition.
- Roediger and Karpicke (2006). *Test-enhanced learning.* Psychological Science.
- Thiede, Anderson and Therriault (2003). *Accuracy of metacognitive monitoring affects learning of texts.* Journal of Educational Psychology.
- Can I use: `Map.prototype.getOrInsertComputed`. https://caniuse.com/mdn-javascript_builtins_map_getorinsertcomputed
