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
| 8 | Medium | Two-column PDFs came out in the wrong order when paragraph gaps lined up across columns. | **Fixed.** A page-wide gutter is found before splitting at gaps, and sentences continue across column and page breaks. Since checked on 11 real papers (findings 48–53). |
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
| 24 | Nit | Markdown symbols are read aloud as-is. | **Fixed.** "Worth a look" flags Markdown (#, **, [links], lists, tables, code) and offers "Remove the symbols", which keeps the words. `.md` files have the symbols removed on import. |
| 25 | Structural | The web and iOS apps had drifted apart as two copies. | **Fixed.** There is one shared source plus `scripts/sync-shared.mjs`, with a check that fails if they differ. |
| 26 | Structural | There were no interface tests, which is where most bugs were. | **Fixed.** `still/tests/ui/run.py` has 19 browser checks. |

### Found with a real book (*The Sorrows of Young Werther*, Penguin PDF)

| # | Severity | Finding | Status |
|---|---|---|---|
| 27 | High | The book's font labels its ligature glyphs with the wrong characters: "fi" comes out as "ɹ", "ff" as "ʃ", "fl" as "ɻ", "ffi" as "ɽ" and "ffl" as "ʀ". About 670 words read wrongly, for example "ɹrst" and "oʃer". | **Fixed.** `text-repair.js` learns each mislabelled character from the dictionary, per document, and repairs it in PDFs, text files and pasted text. Phonetic text is left alone. All 5 were recovered in this book. |
| 28 | Medium | Hyphens came out as an invisible control character, so "cold-shouldered" read as one run-together word. | **Fixed.** |
| 29 | Medium | Endnote numbers stuck to words ("garden3", "Melusine5"). | **Fixed.** Removed only when they count up through the text, so postcodes, years and model numbers stay. 69 of 71 were removed in this book. |
| 30 | Medium | Book paragraphs (first-line indent, no gap) were not detected, so a whole PDF page became one paragraph. | **Fixed** for indents and short last lines. This affects paragraph review and check-ins. |
| 31 | Medium | Running headers and page numbers were read aloud mid-sentence unless the reader ticked an option. | **Fixed.** The option is now on by default. |
| 32 | Low | Anchoring words on the focus letter made longer words look off-centre. | **Fixed.** Words are centred by default, and the anchored option tints the focus letter. |

Readings imported before these fixes keep their old text and need to be imported again.

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

### Found with real two-column papers (October 2026)

Eleven real papers were run through the import exactly as the app does it: ACL 2007, 2009 and 2014 papers, the OSDI MapReduce paper, the PLDI TraceMonkey paper, three biomedical journal articles, a Z. Naturforsch. article, a JSS article and an AVE workshop paper. The PDFs came from the test sets of open-source PDF tools (PDF.js, GROBID, CERMINE, Science Parse). The output was compared with `pdftotext` and checked by hand at every column and page break. Columns were already read in the right order. These problems were found where the text meets the page furniture:

| # | Severity | Finding | Status |
|---|---|---|---|
| 48 | Medium | A page number centred under two columns was read between them, cutting any sentence that ran from one column to the next ("…statistics between 696 the extraction…"). | **Fixed.** A short line centred on the gutter below both columns is read after them. |
| 49 | Medium | Page numbers sitting just above the bottom 8% of the page were never removed. | **Fixed.** The margin test uses the line's baseline, so they are now removed with the others. |
| 50 | Medium | A first-page footer ("Proceedings of… © 2014 Association…") cut the sentence running onto page 2, and the rest of the sentence was glued onto the footer. | **Fixed.** A footer or header that interrupts a sentence is read once that paragraph ends. |
| 51 | Medium | Footnotes at the foot of a column cut sentences the same way ("HMM-T of- 3The distribution… fers over…"). | **Fixed.** Footnotes (smaller type starting with a note marker) wait for the sentence to finish, like footers. |
| 52 | Medium | A figure caption beside the text was read line by line between the text's lines. | **Fixed.** A side block is read after the text next to it. |
| 53 | Medium | Words hyphenated at the end of a line stayed split ("pro- jectivized", "be- cause", "hand- tagged") unless the dictionary had the whole word, and never joined across a column or page break. Each paper had 10 to 26. | **Fixed.** Two known words keep the hyphen ("hand-tagged", "n-gram", "HMM-based"); anything else is a broken word and is joined, except very short pieces such as "state- of". Breaks across columns and pages are joined too. Now 0 to 3 per paper. |

Not changed: tables, charts and equations are still read as runs of words. They can't be read well one word at a time, and the "Worth a look" panel already flags the worst of it.

## Ease-of-use audit (October 2026)

The goal of this pass: make it easier to start reading, stay with it, and come back tomorrow, for readers whose attention is pulled in many directions. Language-learning apps such as Duolingo solved a similar problem with short daily goals, visible progress and a clear next step, so this pass borrows those ideas while keeping Still calm (no sounds, no leagues, no nagging).

| # | Finding | Change |
|---|---|---|
| 38 | Nothing said how long a reading would take. "8 / 188 words" is abstract. | **Time left** in the reader ("4 min left in chapter"), computed from the timing plan itself, so it includes the reader's adjustments. The bookshelf shows time left per reading. |
| 39 | Nothing brought readers back the next day. | **Daily goal and streak.** Pick 5, 10, 15 or 20 minutes. A Today card shows a progress ring, the streak and the last seven days; the header shows the streak. Only time spent playing words counts. Everything stays on the device (`habits.js`). |
| 40 | First run dropped readers on a busy page with a small "Find my pace" link. | **Welcome in three short steps:** what Still is and how to control it, a daily goal, then Find my pace or the sample. Existing readers never see it. |
| 41 | While reading, five tool buttons, the pace panel and the footer stayed at full strength around the word. | **The page fades back while words play** and returns on pause, hover or keyboard focus. |
| 42 | On phones, play/pause meant reaching for a button under the word. | **Tap the word to play or pause.** Holding it still shows the sentence. |
| 43 | Pressing play started at full speed, so the first words were easy to miss. | **Easing in:** the first four words after play get 80%, 50%, 30% and 15% extra time. |
| 44 | Pausing and finishing gave no feedback. | **A short summary on pause** (time, words, pace, today's goal). **A finish card** at the end, with the streak and the obvious next step ("Up next: …" or Add a reading). |
| 45 | No quick way to skip ahead or change pace mid-reading. | **→ skips to the next sentence; ↑ and ↓ change the pace by 10.** In Text view, ↑ and ↓ still scroll. |
| 46 | The controls gave Review and Play equal weight, and the sentence rewind sat among the tools below. | Play is now the large central button, with **↶ (back a sentence) and Review either side.** The tools row is shorter: Chapters (Sections for papers), Text view, Notes, Settings. It fits one row on phones. |
| 47 | The "A pace that follows you" panel took half the space below the reader to explain timing. | Replaced by the Today card. A one-line note under the pace keeps the explanation. |

### Follow-up from use (October 2026)

| # | Request | Change |
|---|---|---|
| 54 | Going back a sentence had no matching way forward. | **↷ beside Play** moves forward one sentence (as → does), so a reader can step back and return. |
| 55 | Review showed one paragraph at a time behind Previous / Next, which felt like a lot to manage. | **Review is one scrolling text.** It opens at your place, and earlier and later paragraphs load as you scroll. Find, look up and Back to my place stay. |
| 56 | Starting from a word in Review took two steps. | **Double-tap a word to read from it.** A single tap still chooses it for look-up. |
| 57 | Some readers prefer to see how far through they are. | **Progress can show percent read** instead of time left: tap the label in the reader, or choose it in Appearance. The choice is remembered. |

### Real book PDFs (October 2026)

Tested with *Alice in Wonderland* (Word export), *Pride and Prejudice* and *Frankenstein* (Acrobat Distiller), *Moby Dick* (printed from Chrome), *Pro Git* (501-page Asciidoctor book) and a two-column paper. All import in under 8 seconds.

| # | Problem | Change |
|---|---|---|
| 58 | Note-number removal deleted real numbers: "SHA-1 hash" became "SHA- hash", "4.0" became ".0", "paragraph 1.E.1" became "1.E.", and maths lost its subscripts. A lone "1" was read as notes restarting. | **A note number follows a standalone word with a lower-case letter and at most closing punctuation, never repeats word for word, and a restart counts only once it reaches 2.** False removals in the six books went from 400+ to none. |
| 59 | Compounds broken at a line end with a short piece stayed split: "sloop- of-war", "tete-a- tete". | **Pieces of a hyphen chain keep their hyphen and join**, whatever their length. |
| 60 | Dotted contents pages ("Chapter 1 ........ 5") were read word by word and listed as chapters. | **Contents lines with dot leaders are skipped** (the range status says how many), and a run of three or more headings with no text between them is treated as a contents list. *Moby Dick* now lists all 135 chapters instead of stopping at 50. |
| 61 | *Pride and Prejudice* prints "Chapter 8 At five o'clock…" on one line. Each chapter split after its first line, and chapter titles were whole sentences. "part of his aunt" counted as a heading. | **Run-in headings are titled by their number** ("Chapter 8") and don't break the paragraph. Headings must start with a capital and use a number word. Centred headings are measured against the text below them. |
| 62 | That edition also prints each chapter as one block, dialogue included, so check-ins and Review had no paragraph ends for thousands of words. | **Blocks over 400 words split where the speaker changes** (a closing quote after a full stop, then an opening quote). Word positions are unchanged. |
| 63 | Wrapped chapter titles were cut short ("CHAPTER XI. Who Stole the"). | **A heading that wraps onto a short second line stays one heading.** |

### Easier reading (October 2026)

| # | Request | Change |
|---|---|---|
| 64 | Scrolling far in Review made it easy to lose your place. | **Your place is underlined, and "Back to my place" appears whenever it is out of view**, pointing towards it. Text loads on its own for about 2,400 words either way; past that, "Load earlier text" / "Load more text" say how many minutes of reading away it is. |
| 65 | The slowest pace was 80 words a minute, too fast for new readers and language learners. | **Paces go down to 40 words a minute** (a word every 1.5 s), with 5-word steps below 120. Find my pace can now suggest paces down to 60. |
| 66 | Some readers need a moment after each sentence. | **Pause after each sentence** (under the pace): playback stops on each sentence's last word, and a tap or Space carries on. |
| 67 | Low-vision and dyslexic readers asked for more room. | **Text size goes up to 200%**, and Appearance has **wide letter spacing** (0.12 em letters, 0.16 em words, the WCAG text-spacing amounts) for the word, Review and Text view. |

### More books and essays (October 2026)

Tested 13 more works in 23 imports: essays as text, Markdown, pasted text and web pages saved as PDF; four EPUBs; French and Spanish texts. The full ranked findings are in the project's next-steps doc.

| # | Problem | Change |
|---|---|---|
| 68 | A web page saved as PDF with narrow margins puts body text in the top and bottom 8% of the page. Those lines were held back as headers and footers, so sentences came out of order and split mid-way (9 to 24 times per essay). The browser's footer also stayed in from page 10, because it shortens the URL more once the page number has two digits. | **A line near the page edge counts as margin only when it stands apart**: smaller type than the body (measured across the document), a wider gap than the page's line spacing, a bare page number, or beyond another margin line. Cut-off pieces are left out of the footer signature. All four test essays now match the page word for word; earlier books and papers keep their text, with a few sentences that used to break now joined. |
| 69 | Project Gutenberg files were read with their header and licence (24% of *Civil Disobedience*), and titled by file name ("71"). | **Text files with Gutenberg markers start at the book and stop before the licence**, and take their title from the header. |
| 70 | Latin-1 / Windows-1252 text files lost every accent ("Ibáñez" became "Ib��ez"). | **Text files are decoded as UTF-8 when valid, otherwise as Windows-1252.** |
| 71 | Words joined by a dash ("government--what", "belt—one") played as one long, shrunken word, and spaced punctuation flashed alone (",", ". . .", "↩"). | **A dash between words stays with the first word and the next word stands alone; spaced punctuation joins its word; ". . ." becomes "…"; endnote "↩" links are dropped.** Applies to text files, pasted text, EPUBs and PDF lines. Number ranges, hyphenated words and Spanish dialogue dashes are left alone. |
| 72 | EPUBs read their title page, imprint, colophon and endnotes aloud; note numbers stuck to words ("mill.1"); nested chapters were all called "I", "II"; one malformed chapter stopped the whole book; and books over 2 million characters were refused. | **Front and back matter, note links and Gutenberg boilerplate are skipped; nested chapters are named "Part One · I"; a chapter that isn't valid XML is read as HTML; a long book is offered in parts** that break at chapters (a 226-essay collection now opens as two parts). |
| 73 | Markdown kept its front matter, wrapped links, footnote markers, HTML tags and entities; pasted Markdown was left raw; Gutenberg's `_italics_` showed as underscores; the warning counted at most 20 marks. | **Markdown cleanup covers front matter, wrapped links and emphasis, footnotes (notes kept as paragraphs), HTML and templates, quotes in lists and `[1]` note numbers. Clearly-Markdown pastes are cleaned on paste, text files lose italic underscores, and the warning shows the true count in plainer words.** |
| 74 | A Gutenberg book printed to PDF kept its header and licence, and letter-spaced headings came out as "V i n c e n t e". | **PDFs with Gutenberg markers start at the book and stop before the licence** (word positions stay matched to the page), **and letter-spaced lines are rebuilt from their pieces.** |
| 75 | "Section 5.1" style subheadings were flagged as page headers, and "Remove them" deleted them. | **Numbered headings whose numbers change are not page headers;** the same heading on every page still is. |
| 76 | Words split by a line-end hyphen ("exam- ple", "well- known") were flagged with no fix. | **A "Join them" button** joins the word when the dictionary knows it ("example") and keeps a real hyphen otherwise ("well-known"); "independent- and" is left alone. |
| 77 | A 2 MB text file sat for seconds with a blank status. | **The status says the file is opening, then that chapters are being found.** |
| 78 | Chapters were found only with English words: Montaigne in French, Blasco Ibáñez in Spanish, Bacon's "Of Truth" essays and Emerson's numbered essays all had no chapters, and a quoted "Epilogue to…" credit made *Self-Reliance* look like a book. | **Chapter words in French, Spanish, Italian, German and Portuguese; runs of roman numerals, "Of…" titles and capital-letter titles; chapter names taken from the next line; contents lists with page numbers skipped; credits are not headings.** Montaigne now has 34 sections, Sangre y arena 10, Bacon 59, Emerson 12; the books tested before keep the same chapters. |
| 79 | Plain-text books kept their print line wrapping, flagged on every import. | **Wrapped paragraphs are joined on import;** verse, lists and headings keep their lines, and rows of asterisks between sections are dropped. Gutenberg PDFs take their title from the header. |
| 80 | A first-time reader landed on a 188-word sample at 260 words a minute with a dozen controls in view, and was asked to take a speed test before reading anything. | **New readers open on a short read from a "Short reads" shelf of public-domain pieces labelled in minutes, start at 180 words a minute and ease in (15% slower for the first 30 seconds of each session).** The welcome's second step says the first read is ready; Find my pace is offered on the finish card instead. |
| 81 | The home screen showed the slider, range labels, sentence pause and adaptation line all at once, and the Add screen showed type, check-ins, paper options and PDF order before Open. | **Pace options and the Add screen's extras sit behind "Pace options" and "More options";** the paper options open on their own when the text looks like a paper. "WPM" is now "words a minute". |
| 82 | After a finished reading with nothing else on the shelf, the only next step was "Add a reading". | **The finish card suggests the next short read ("Up next: … · 3 min")** and ticks off finished ones on the shelf. |
| 83 | There was no way to hear from readers or to tell them when the iPhone app is out. | **A "Send feedback" form and an optional waitlist email box (welcome screen and finish card), with a one-line privacy note, post to Netlify Forms on the same site:** no third-party scripts, no cookies, hidden in the iOS app. |
| 84 | Readers who follow better by ear, or who struggle with print, had no way to hear the text. | **Read aloud (Reading settings, and offered on the first-run welcome) speaks each sentence with the device's own voice and moves the word with the voice,** at a rate taken from the pace (below 90 words a minute the last word of a sentence waits out the pace). Only on-device voices are used; if a voice sends no word timings, words follow an estimate; if no voice starts, words follow the pace and a note says why. Untested on real Safari, Chrome and iOS voices. |
| 85 | Read aloud used the device's default voice, often its plainest compact one, even when a natural voice was installed. | **The most natural on-device voice is chosen first** (Premium, Enhanced, Neural or Natural voices; novelty and eSpeak voices last), **and Reading settings has a voice chooser with "Try it"**. On Apple devices without a natural voice, a hint says where to download one. |
| 86 | Many devices only have flat, robotic voices built in, and the better ones are hidden behind settings few readers find. | **A "Natural voice" choice in the voice chooser (Heart, Bella, Emma, Michael), from the open Kokoro-82M speech model running on the device in a background worker.** Choosing one downloads it once (about 90 MB, with progress in Reading settings) and keeps it for offline use; only the voice's files are downloaded and the text never leaves the device. Each sentence is made while the one before plays; the shown word follows an estimate from each word's sounds, and very slow paces hold the sentence's last word. Non-English readings, failed downloads and devices that can't run it keep the device's voice, with a note saying why. Untested with the real voice files (they couldn't be downloaded where this was built) and on iPhones. |

What to measure next, with consent: whether readers with a goal come back on more days, which goal size they keep, and whether the fade-back while reading changes how often they pause.

## Still open

- **The iOS app has never been compiled.** It needs a Mac with enough disk space and an Xcode-compatible macOS. After that:
  - run `npm run build` (esbuild) to confirm the new shared files bundle for the `safari18` target;
  - test the PDF page view on an iOS 18 simulator.
- **Natural voice.** Run it once with the real Kokoro files from huggingface.co (speed of speech on a laptop and an older iPhone, memory, the words-a-minute estimate at speed 1), pin the model download to a fixed revision, and check eSpeak NG's GPL licence (inside the vendored phonemizer) against App Store distribution before shipping it in the iOS app.
- **Fonts.** The page now uses system fonts (Iowan Old Style or Charter for reading on Apple devices). Literata and DM Sans were named in the CSS but never bundled; bundle a reading face only if a specific look is wanted on Android and Windows.

## Sources

- Rayner, Schotter, Masson, Potter and Treiman (2016). *So much to read, so little time.* Psychological Science in the Public Interest.
- Primativo, Spinelli, Zoccolotti, De Luca and Martelli (2016). *Perceptual and cognitive factors imposing "speed limits" on reading rate: a study with the rapid serial visual presentation.* PLoS ONE. https://pmc.ncbi.nlm.nih.gov/articles/PMC4835101
- Liversedge et al. *Reading disappearing text: cognitive control of eye movements.*
- O'Regan and Jacobs (1992). Optimal viewing position effect in word recognition.
- Roediger and Karpicke (2006). *Test-enhanced learning.* Psychological Science.
- Thiede, Anderson and Therriault (2003). *Accuracy of metacognitive monitoring affects learning of texts.* Journal of Educational Psychology.
- Can I use: `Map.prototype.getOrInsertComputed`. https://caniuse.com/mdn-javascript_builtins_map_getorinsertcomputed
