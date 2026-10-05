import { native, storage, flushStorage, exportFile } from "./native-runtime.js";
import { extractEpub } from "./epub.js";
import {
  previousSentence,
  nextSentence,
  shelfMatches,
} from "./reading-features.js";
import { setupOffline } from "./offline.js";
import {
  inferType,
  detectSections,
  paragraphAnchor,
  normalizeSections,
  fileFingerprint,
} from "./document.js";
import {
  encodeBackup,
  decodeBackup,
  MAX_READING_CHARACTERS,
  MAX_BACKUP_READINGS,
} from "./backup.js";
import { filteredReading, visibleIndex } from "./citations.js";
import { composePdf, markLineJoins, outlineSections } from "./pdf-layout.js";
import { createPdfViewer } from "./pdf-viewer.js";
import {
  saveReading,
  listReadings,
  getReading,
  saveSource,
  getSource,
  librarySnapshot,
  restoreLibrary,
  setShelfState,
  deleteReading,
  eraseLibrary,
  searchReadingText,
} from "./library.js";
import {
  buildParagraphIndex,
  findPassages,
} from "./navigation.js";
import { extractPdf, pdfErrorMessage } from "./pdf-import.js";
import { lookupWord } from "./dictionary.js";
import { checkText, stripMarkdown } from "./text-check.js";
import { PASSAGES, nextPace, suggestedPace } from "./pace-finder.js";
import { repairPdfLines, repairText, describeGlyphMap } from "./text-repair.js";
import { splitAtFocus, fadeDuration } from "./word-display.js";
import {
  checkInDue,
  endCheckInDue,
  followUp,
  summarizeCheckins,
  normalizeCheckins,
  checkinSpacing,
} from "./checkins.js";
import {
  parseText,
  cleanWord,
  freshProfile,
  recordRewind,
  recordLookup,
  buildTimingPlan,
  targetWpm,
  Playback,
  clamp,
  sentenceEnd,
  warmUpFactor,
  planSums,
} from "./engine.js";
import {
  GOALS,
  normalizeHabits,
  recordReading,
  today,
  streak,
  week,
  formatDuration,
  formatElapsed,
  dayKey,
} from "./habits.js";
const $ = (id) => document.getElementById(id);
// "1 reading", "3 readings"; pass the plural form when it isn't just "+s".
const plural = (n, one, many = one + "s") =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
const SAMPLE = `There is a kind of quiet that only arrives in the early morning. Before the messages, before the traffic, before the day begins asking things of you. The room is still. Light moves slowly across the floor.

On the windowsill, a small bird lands and tilts its head. You have walked past this window a thousand times. Today, for no particular reason, you stop. The bird stays for a moment, then disappears into the blue.

Noticing is an unassuming habit. It asks for nothing elaborate: a little attention, a willingness to linger, an occasional departure from the familiar. The ordinary world becomes less ordinary when we give it a second look.

There are words for these small discoveries. Ephemeral describes something that lasts only briefly. Serendipity is the happy accident of finding something you were not looking for. Neither requires a grand adventure. Sometimes, all it takes is an open window.

Later, when the day grows busy, you may remember the bird. You may forget it entirely. Either way, for a few seconds, you were there. The light, the quiet, the world just outside. And that was enough.`;
let erasing = false;
const KEY = "still-reader-v1";
// Local storage holds about 5 MB per site. Readings longer than this keep
// their text only in the bookshelf (IndexedDB) and load it from there.
const LOCAL_TEXT_LIMIT = 500000;
let saved;
try {
  saved = JSON.parse(storage.getItem(KEY));
} catch {}
const hasText = (value) =>
  typeof value?.text === "string" && value.text.trim() !== "";
let startupNote = "";
if (saved && typeof saved.documentId === "string" && !hasText(saved)) {
  // Long readings are saved without their text in local storage (it is
  // small); the full text lives in the bookshelf. Load it from there.
  try {
    const record = await getReading(saved.documentId);
    if (hasText(record)) saved = { ...record, ...saved, text: record.text };
  } catch {}
  if (!hasText(saved)) {
    // Never reuse the ID with other text: that would overwrite the
    // bookshelf copy of this reading with the sample.
    saved = null;
    startupNote = "Your last reading is on the Bookshelf.";
  }
}
let text =
  typeof saved?.text === "string" && saved.text.trim() ? saved.text : SAMPLE;
let title =
  typeof saved?.title === "string" ? saved.title : "The art of noticing";
let base = Number.isFinite(saved?.base) ? clamp(saved.base, 80, 600) : 260;
let profile = freshProfile();
if (
  saved?.profile &&
  typeof saved.profile.lookups === "object" &&
  saved.profile.lookups !== null &&
  Array.isArray(saved.profile.rewinds)
) {
  profile = {
    ...saved.profile,
    slowdown: clamp(Number(saved.profile.slowdown) || 0, 0, 0.2),
  };
}
let documentId =
  typeof saved?.documentId === "string"
    ? saved.documentId
    : crypto.randomUUID();
let readingOptions = saved?.readingOptions || {},
  filterAnchor = Number.isInteger(saved?.sourceIndex)
    ? saved.sourceIndex
    : saved?.index || 0;
if (!readingOptions.documentType)
  readingOptions.documentType =
    readingOptions.skipCitations || readingOptions.skipReferences
      ? "academic"
      : inferType(text);
let importTypeManual = false,
  duplicatePending = null,
  restorePending = null,
  epubDraft = null;
let shelfState = saved?.shelfState || "active",
  lastShelfMove = null,
  normalMode = false,
  normalStart = 0,
  normalEnd = 0,
  selectingPassage = false,
  selectionStart = null,
  selectionEnd = null,
  markDraft = null,
  normalScrollTimer,
  normalScrollLocked = false;
let appearance;
try {
  appearance = JSON.parse(storage.getItem("still-appearance")) || {};
} catch {
  appearance = {};
}
let currentSource = null,
  sourceRequest = 0,
  pdfDraft = null;
const sourceViewer = createPdfViewer({
  getIndex: () => data.tokens[reader.index]?.sourceIndex ?? filterAnchor,
  onRead: (index) => {
    replayParagraph = null;
    refreshTiming();
    const at = visibleIndex(data.tokens, index);
    if (at >= data.tokens.length) {
      $("sourceNote").textContent =
        "No visible text follows this line. Turn off skipping to read it.";
      return;
    }
    reader.seek(at);
    play();
  },
});
async function refreshSource(imported = null) {
  const request = ++sourceRequest,
    id = documentId;
  currentSource = null;
  $("viewSource").hidden = true;
  $("sourceNote").textContent = "";
  try {
    const value = imported || (await getSource(id));
    if (request !== sourceRequest) return;
    currentSource = value || null;
    $("viewSource").hidden = !value;
    if (imported) {
      await saveSource(id, imported);
    }
  } catch {
    if (request === sourceRequest)
      $("sourceNote").textContent = imported
        ? "Original PDF could not be saved. It is available until you close this tab."
        : "Original PDF is unavailable. Re-import it to restore the page view.";
  }
}
$("viewSource").onclick = () => {
  pause();
  if (currentSource) sourceViewer.open(currentSource);
};
let archiveQueue = Promise.resolve(true),
  libraryError = "",
  shelfRequest = 0;
let savedText = null,
  savedSettings = null;
let savedPosition;
try {
  savedPosition = JSON.parse(storage.getItem(KEY + "-position"));
} catch {}
let data = filteredReading(text, readingOptions),
  reader,
  replayParagraph = null,
  selected = 0,
  origin = 0,
  lookupRequest = 0,
  timingPlan = [],
  paragraphGroups = buildParagraphIndex(data.tokens),
  intentionalNavigation = false;
// Check-in state: words shown since the last check-in, where that stretch
// began, and paragraphs being replayed slower after "lost the thread".
let wordsRead = 0,
  segmentStart = 0,
  replaySet = null,
  pendingCheckin = null,
  sectionCache = null;
// Daily goal and streak (see habits.js). `session` is the stretch being read
// now; `lastSession` is what the reader just finished, for the pause summary.
const HABITS = "still-habits";
const ONBOARDED = "still-onboarded";
let habits;
try {
  habits = normalizeHabits(JSON.parse(storage.getItem(HABITS)));
} catch {
  habits = normalizeHabits(null);
}
let session = null,
  lastSession = null,
  warmFrom = 0,
  celebratedDay = today(habits).met ? dayKey() : "",
  todayShownAt = 0,
  timeLeftKey = "",
  toastTimer = 0,
  finishRequest = 0,
  finishNext = null,
  welcomeFlow = false;
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const WELCOME_COPY = {
  intro: ["Welcome to Still", "Read more, with less effort"],
  goal: ["", "Pick a daily goal"],
  pace: ["Step 2 of 2", "Find a comfortable pace?"],
};
// Running totals of the plan, for "N min left" (see engine.planSums).
let timingSums = new Float64Array(1);
function refreshTiming() {
  timingPlan = buildTimingPlan(data.tokens, {
    base,
    profile,
    replayParagraph,
    replayParagraphs: replaySet,
  });
  timingSums = planSums(timingPlan);
}
// Check-ins are chosen per reading (see checkins.js); off unless chosen.
const checkinMode = () => checkinSpacing(readingOptions.checkinEvery);
function sectionStarts() {
  const key = readingOptions.sections || text;
  if (sectionCache?.key !== key)
    sectionCache = {
      key,
      starts: new Set(readingSections().map((s) => s.paragraph)),
    };
  return sectionCache.starts;
}
function save() {
  if (erasing) return;
  try {
    const settings = JSON.stringify({
      title,
      base,
      profile,
      documentId,
      readingOptions,
      shelfState,
      finished: reader?.finished || false,
    });
    if (savedText !== text || savedSettings !== settings) {
      const state = {
        text,
        title,
        base,
        profile,
        documentId,
        readingOptions,
        shelfState,
        sourceIndex: data.tokens[reader?.index]?.sourceIndex ?? filterAnchor,
        index: reader?.index || 0,
        finished: reader?.finished || false,
      };
      // Mark as saved first so a failure below is not retried on every word.
      savedText = text;
      savedSettings = settings;
      const withoutText = () => {
        const { text: _omit, ...rest } = state;
        storage.setItem(KEY, JSON.stringify({ ...rest, textInLibrary: true }));
      };
      if (!native && text.length > LOCAL_TEXT_LIMIT) withoutText();
      else
        try {
          storage.setItem(KEY, JSON.stringify(state));
        } catch (error) {
          if (native) throw error;
          withoutText(); // quota exceeded: the bookshelf keeps the text
        }
    }
    storage.setItem(
      KEY + "-position",
      JSON.stringify({
        documentId,
        sourceIndex: data.tokens[reader?.index]?.sourceIndex ?? filterAnchor,
        index: reader?.index || 0,
        finished: reader?.finished || false,
      }),
    );
    $("saved").textContent =
      libraryError || startupNote || "Saved on this device";
    $("saved").classList.toggle("storage-error", !!libraryError);
  } catch {
    $("saved").textContent = "Storage unavailable · keep this tab open";
    $("saved").classList.add("storage-error");
  }
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let wordFade = null;
// Shows one word, centred by default. Readers who choose "anchored" get the
// focus letter fixed under the marks and tinted (see word-display.js).
function showWord(word, { animate = false, durationMs = 0 } = {}) {
  const el = $("word");
  const focus = appearance.placement === "anchored" && word.length <= 40;
  el.classList.toggle("focus-mode", focus);
  if (focus) {
    const parts = splitAtFocus(word).map((text, i) => {
      const span = document.createElement("span");
      span.className = ["before", "focus", "after"][i];
      span.textContent = text;
      return span;
    });
    el.replaceChildren(...parts);
    el.setAttribute("aria-label", word); // read as one word, not three pieces
  } else {
    el.textContent = word;
    el.removeAttribute("aria-label");
  }
  fitWord();
  wordFade?.cancel();
  wordFade = null;
  if (
    animate &&
    appearance.transition !== "instant" &&
    !reducedMotion.matches &&
    el.animate
  ) {
    const duration = fadeDuration(durationMs);
    if (duration)
      wordFade = el.animate([{ opacity: 0.25 }, { opacity: 1 }], {
        duration,
        easing: "ease-out",
      });
  }
}
// Offset in px between the focus letter's centre and the word box's centre.
function focusOffset(el) {
  const focus = el.querySelector(".focus");
  if (!focus) return 0;
  const f = focus.getBoundingClientRect(),
    box = el.getBoundingClientRect();
  return f.left + f.width / 2 - (box.left + box.width / 2);
}
function fitWord() {
  const el = $("word");
  el.style.fontSize = "";
  el.style.whiteSpace = "nowrap";
  el.style.overflowWrap = "normal";
  const full = parseFloat(getComputedStyle(el).fontSize);
  let size = full;
  if (el.classList.contains("focus-mode")) {
    // A long word may not fit on one side of the focus letter. Shrink it a
    // little; if it still doesn't balance, centre it rather than making the
    // text jump to a much smaller size.
    while (
      (el.scrollWidth > el.clientWidth || Math.abs(focusOffset(el)) > 1) &&
      size > full * 0.75
    ) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
    if (el.scrollWidth <= el.clientWidth && Math.abs(focusOffset(el)) <= 1)
      return;
    const word = el.textContent;
    el.classList.remove("focus-mode");
    el.textContent = word;
    el.removeAttribute("aria-label");
    el.style.fontSize = "";
    size = full;
  }
  while (el.scrollWidth > el.clientWidth && size > 14) {
    size -= 2;
    el.style.fontSize = size + "px";
  }
  if (el.scrollWidth > el.clientWidth) {
    el.style.whiteSpace = "normal";
    el.style.overflowWrap = "anywhere";
  } else {
    el.style.whiteSpace = "nowrap";
  }
}
function render() {
  const t = data.tokens[reader.index];
  showWord(t?.text || "No visible words", {
    animate: reader.playing,
    durationMs: timingPlan[reader.index],
  });
  $("count").textContent =
    `${data.tokens.length ? reader.index + 1 : 0} / ${plural(data.tokens.length, "word")}`;
  updateModeLabel();
  updateTimeLeft();
  if (session && performance.now() - todayShownAt > 1000) updateToday();
  const percent = data.tokens.length
    ? ((reader.index + 1) / data.tokens.length) * 100
    : 0;
  $("progress").style.width = `${percent}%`;
  $("progressTrack").setAttribute("aria-valuenow", Math.round(percent));
  $("title").textContent = title;
  $("speed").value = base;
  if (document.activeElement !== $("speedValue")) $("speedValue").value = base;
  $("slower").disabled = base <= 80;
  $("faster").disabled = base >= 600;
  const replaying =
    t?.paragraph === replayParagraph || !!replaySet?.has(t?.paragraph);
  $("learning").textContent =
    `Current target: ${Math.round(targetWpm(base, profile, replaying))} WPM${replaying ? " · slower replay" : profile.slowdown ? " · adjusted for you" : ""}`;
  $("play").disabled = !data.tokens.length;
  $("review").disabled = !data.tokens.length;
  $("quickRewind").disabled = !data.tokens.length;
  $("quickForward").disabled = !data.tokens.length;
  updateNormalHighlight();
  save();
}
// Where each section starts in the visible words, rebuilt when the reading
// or its sections change. Kept cheap because render() runs on every word.
let chapterCache = { data: null, sections: null, list: [] };
function chapterStarts() {
  if (
    chapterCache.data !== data ||
    chapterCache.sections !== readingOptions.sections
  ) {
    const firstWord = new Map();
    for (const t of data.original.tokens)
      if (!firstWord.has(t.paragraph)) firstWord.set(t.paragraph, t.index);
    const list = readingSections()
      .map((s) => ({
        title: s.title,
        index: visibleIndex(data.tokens, firstWord.get(s.paragraph - 1) ?? 0),
      }))
      .filter((s) => s.index < data.tokens.length)
      .sort((a, b) => a.index - b.index);
    chapterCache = { data, sections: readingOptions.sections, list };
  }
  return chapterCache.list;
}
// Index into chapterStarts() of the section containing visible word `i`.
function chapterAt(i) {
  const list = chapterStarts();
  let low = 0,
    high = list.length - 1,
    found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (list[mid].index <= i) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}
// The reader's top-left label: the current chapter when the reading has
// chapters, otherwise a calm line about the reader's state.
let modeKey = "";
function updateModeLabel(force = false) {
  const list = chapterStarts();
  const at = list.length >= 2 ? chapterAt(reader.index) : -1;
  const key = at + "|" + reader.playing + "|" + reader.finished;
  if (!force && key === modeKey) return;
  modeKey = key;
  const el = $("mode");
  if (at >= 0) {
    el.textContent = `${at + 1} of ${list.length} · ${list[at].title}`;
    el.title = list[at].title;
    el.classList.add("chapter");
  } else {
    el.textContent = reader.playing
      ? "In your own time"
      : reader.finished
        ? "A good place to pause"
        : list.length >= 2
          ? "Before the first chapter"
          : "Ready when you are";
    el.removeAttribute("title");
    el.classList.remove("chapter");
  }
}
const icon = (paths, filled = false) =>
  `<svg class="icon" viewBox="0 0 24 24" ${
    filled
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  } aria-hidden="true">${paths}</svg>`;
const ICONS = {
  play: icon(
    '<path d="M8 5.1v13.8a1 1 0 0 0 1.5.86l11-6.9a1 1 0 0 0 0-1.72l-11-6.9A1 1 0 0 0 8 5.1z"/>',
    true,
  ),
  pause: icon(
    '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    true,
  ),
  again: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
};
const touch = matchMedia("(pointer: coarse)");
function playbackUI() {
  const playing = reader.playing;
  $("play").innerHTML = playing
    ? `${ICONS.pause} <span>Pause</span>`
    : reader.finished
      ? `${ICONS.again} <span>Read again</span>`
      : reader.index > 0
        ? `${ICONS.play} <span>Continue</span>`
        : `${ICONS.play} <span>Start reading</span>`;
  updateModeLabel(true);
  // While words play, everything around the reader fades back.
  document.body.classList.toggle("immersive", playing);
  showFinish(reader.finished && !playing);
  updateTimeLeft();
  $("status").textContent =
    playing || reader.finished
      ? ""
      : lastSession
        ? sessionSummary(lastSession)
        : touch.matches
          ? "Tap the word to start. Hold it to see the whole sentence."
          : "Press Space or tap the word to start. Hold it to see the whole sentence.";
  // Words are not announced one by one (far too fast for a screen reader);
  // announce the state and position whenever playback starts or stops.
  const position = data.tokens.length
    ? `word ${reader.index + 1} of ${data.tokens.length}`
    : "no visible words";
  const announcement = playing
    ? "Playing."
    : reader.finished
      ? "Finished. You’ve reached the end."
      : `Paused at ${position}: ${data.tokens[reader.index]?.text || ""}`;
  if ($("srStatus").textContent !== announcement)
    $("srStatus").textContent = announcement;
}
// After an action that returns to reading (opening a reading, saving
// settings, jumping to a bookmark), put focus on the play button so Space
// plays instead of re-activating the button that opened the dialog.
function returnToReader() {
  const target = normalMode ? $("readingMode") : $("play");
  target.focus({ preventScroll: true });
}
function createReader(index = 0) {
  reader?.pause();
  refreshTiming();
  reader = new Playback({
    length: data.tokens.length,
    duration: (i) => timingPlan[i] * warmUpFactor(i - warmFrom),
    onWord: () => {
      if (reader?.playing) {
        if (!wordsRead) segmentStart = reader.index;
        wordsRead++;
        if (session) session.words++;
      }
      render();
    },
    onEnd: () => {
      endSession();
      playbackUI();
      save();
      checkpoint();
      if (endCheckInDue(wordsRead, checkinMode()))
        openCheckIn(data.tokens.length - 1, { end: true });
    },
    breakAfter: (i) =>
      !!data.tokens[i]?.paragraphEnd &&
      checkInDue({
        tokens: data.tokens,
        index: i,
        wordsRead,
        every: checkinMode(),
        sectionStarts: sectionStarts(),
      }),
    onBreak: (i) => {
      endSession();
      playbackUI();
      save();
      checkpoint();
      openCheckIn(i);
    },
  });
  reader.seek(Number.isInteger(index) ? index : 0);
  playbackUI();
}
function pause() {
  reader.pause();
  endSession();
  playbackUI();
  save();
  checkpoint();
  flushStorage().catch(() => {});
}
function play() {
  if (normalMode) setReadingMode(false);
  // The first few words after starting get extra time (engine.warmUpFactor).
  warmFrom = reader.finished ? 0 : reader.index;
  startSession();
  reader.play();
  playbackUI();
  $("play").focus({ preventScroll: true });
}
function toggle() {
  reader.playing ? pause() : play();
}
function checkpoint() {
  if (!reader || erasing) return Promise.resolve(false);
  const record = {
    id: documentId,
    title,
    text,
    base,
    profile,
    readingOptions,
    shelfState,
    sourceIndex: data.tokens[reader.index]?.sourceIndex ?? filterAnchor,
    index: reader.index,
    wordCount: data.tokens.length,
    finished: reader.finished,
    updatedAt: Date.now(),
  };
  archiveQueue = archiveQueue
    .then(() => saveReading(record))
    .then(() => {
      libraryError = "";
      save();
      return true;
    })
    .catch(() => {
      libraryError = "Bookshelf could not save · keep this tab open";
      save();
      return false;
    });
  return archiveQueue;
}
function load(nextText, nextTitle, existing = null, importedSource = null) {
  if (!nextText.trim()) return;
  pause();
  startupNote = "";
  wordsRead = 0;
  replaySet = null;
  sectionCache = null;
  clearTimeout(normalScrollTimer);
  selectionStart = null;
  selectionEnd = null;
  selectingPassage = false;
  normalMode = false;
  $("normalReader").hidden = true;
  $("wordReader").hidden = false;
  shelfState = existing?.shelfState || "active";
  text = nextText.trim();
  documentId = existing?.id || crypto.randomUUID();
  title = nextTitle.trim() || "Untitled reading";
  readingOptions = existing?.readingOptions || {};
  if (!readingOptions.documentType)
    readingOptions.documentType =
      readingOptions.skipCitations || readingOptions.skipReferences
        ? "academic"
        : inferType(text);
  base = Number.isFinite(existing?.base) ? clamp(existing.base, 80, 600) : base;
  profile = existing?.profile || freshProfile();
  filterAnchor = existing?.sourceIndex ?? existing?.index ?? 0;
  data = filteredReading(text, readingOptions);
  paragraphGroups = buildParagraphIndex(data.tokens);
  profile = { ...profile, rewinds: [] };
  replayParagraph = null;
  createReader(
    Math.min(
      visibleIndex(data.tokens, filterAnchor),
      Math.max(0, data.tokens.length - 1),
    ),
  );
  updateFilterUI();
  reader.finished =
    !!existing?.finished && reader.index === data.tokens.length - 1;
  playbackUI();
  save();
  checkpoint();
  refreshSource(importedSource);
  setReadingMode(readingOptions.readingMode === "text", false);
}
function setPace(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || String(value).trim() === "") {
    $("speedValue").value = base;
    return;
  }
  base = clamp(Math.round(number), 80, 600);
  profile = { ...profile, slowdown: 0 };
  replayParagraph = null;
  replaySet = null;
  refreshTiming();
  reader.retime();
  render();
  $("speedValue").value = base;
}
// Find my pace (see pace-finder.js). Runs its own small player so the
// current reading and its position are untouched.
let paceRun = null;
const PACE_FOUND = "still-pace-found";
function paceStep() {
  const run = paceRun;
  $("paceFeel").hidden = true;
  $("paceSecondary").hidden = true;
  if (run.history.length < PASSAGES.length) {
    const k = run.history.length;
    $("paceWord").textContent = k ? "Next" : "Ready";
    $("paceStatus").textContent = `Passage ${k + 1} of ${PASSAGES.length}`;
    $("pacePrimary").textContent = k ? "Next passage" : "Start";
    $("pacePrimary").hidden = false;
    run.action = paceRead;
    return;
  }
  run.result = suggestedPace(run.history);
  $("paceWord").textContent = `${run.result}`;
  $("paceStatus").textContent =
    `A comfortable starting pace for you: ${run.result} words per minute. Still keeps adjusting as you read.`;
  $("pacePrimary").textContent = `Use ${run.result} words / min`;
  $("pacePrimary").hidden = false;
  $("paceSecondary").textContent = `Keep ${base} words / min`;
  $("paceSecondary").hidden = run.result === base;
  run.action = () => {
    setPace(run.result);
    $("paceDialog").close();
    returnToReader();
  };
}
function paceRead() {
  const run = paceRun;
  const wpm = nextPace(run.history);
  const tokens = parseText(PASSAGES[run.history.length]).tokens;
  const plan = buildTimingPlan(tokens, { base: wpm });
  $("pacePrimary").hidden = true;
  $("paceStatus").textContent =
    `Passage ${run.history.length + 1} of ${PASSAGES.length} · ${wpm} words per minute`;
  run.player = new Playback({
    length: tokens.length,
    duration: (i) => plan[i],
    onWord: (i) => ($("paceWord").textContent = tokens[i].text),
    onEnd: () => {
      run.wpm = wpm;
      $("paceStatus").textContent = "How did that feel?";
      $("paceFeel").hidden = false;
      $("paceFeel").querySelector("button").focus();
    },
  });
  run.player.play();
}
function openPaceFinder() {
  pause();
  $("paceInvite").hidden = true;
  paceRun = { history: [] };
  paceStep();
  $("paceDialog").showModal();
  $("pacePrimary").focus();
}
$("findPace").onclick = openPaceFinder;
$("pacePrimary").onclick = () => paceRun?.action?.();
$("paceSecondary").onclick = () => $("paceDialog").close();
$("paceFeel").addEventListener("click", (e) => {
  const feel = e.target.closest("[data-feel]")?.dataset.feel;
  if (!feel || !paceRun) return;
  paceRun.history.push({ wpm: paceRun.wpm, feel });
  if (paceRun.history.length === PASSAGES.length)
    try {
      storage.setItem(PACE_FOUND, "1");
    } catch {}
  paceStep();
  $("pacePrimary").focus();
});
$("paceDialog").addEventListener("close", () => {
  paceRun?.player?.pause();
  paceRun = null;
});
{
  let found = true;
  try {
    found = !!storage.getItem(PACE_FOUND);
  } catch {}
  // Invite first-time readers only: no saved reading and never run.
  $("paceInvite").hidden = found || !!saved;
}
$("play").onclick = toggle;
$("speed").oninput = (e) => setPace(e.target.value);
$("speedValue").onchange = (e) => setPace(e.target.value);
$("speedValue").onblur = (e) => setPace(e.target.value);
$("speedValue").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    setPace(e.target.value);
    $("play").focus({ preventScroll: true });
  }
};
$("slower").onclick = () => setPace(base - 10);
$("faster").onclick = () => setPace(base + 10);
$("reset").onclick = () => {
  profile = freshProfile();
  replayParagraph = null;
  replaySet = null;
  refreshTiming();
  reader.retime();
  render();
};
$("newText").onclick = () => {
  pause();
  pdfDraft = null;
  epubDraft = null;
  $("epubStatus").textContent = "";
  lastPdfFile = null;
  importTypeManual = false;
  duplicatePending = null;
  $("textInput").value = "";
  $("textTitle").value = "";
  $("importType").value = "other";
  // Check-ins start from the reader's last choice (off until they pick one).
  try {
    $("importCheckins").value = String(
      checkinSpacing(storage.getItem("still-checkin-default")),
    );
  } catch {}
  $("importSkipCitations").checked = false;
  $("importSkipReferences").checked = false;
  $("pdfOptions").hidden = true;
  $("pdfStatus").hidden = true;
  $("pdfErrorDetails").hidden = true;
  $("retryPdf").hidden = true;
  $("textFileStatus").textContent = "";
  $("duplicateNotice").hidden = true;
  $("startParagraph").value = 1;
  updateDraft();
  $("inputDialog").showModal();
};
$("inputForm").onsubmit = (e) => {
  e.preventDefault();
  if (!$("textInput").value.trim()) {
    $("textInput").setCustomValidity("Add some text to read.");
    $("textInput").reportValidity();
    return;
  }
  if ($("textInput").value.length > MAX_READING_CHARACTERS) {
    $("textInput").setCustomValidity(
      `This text is too long for one reading (${$("textInput").value.length.toLocaleString()} characters; the limit is ${MAX_READING_CHARACTERS.toLocaleString()}). Split it into parts, such as one reading per chapter.`,
    );
    $("textInput").reportValidity();
    return;
  }
  const imported =
    pdfDraft && $("textInput").value === pdfDraft.text
      ? {
          blob: pdfDraft.file,
          locations: pdfDraft.locations,
          fingerprint: pdfDraft.fingerprint,
        }
      : null;
  const draftText = $("textInput").value;
  const kind = $("importType").value;
  const start = Number($("startParagraph").value);
  if (
    !Number.isInteger(start) ||
    start < 1 ||
    start > parseText(draftText).paragraphs.length
  ) {
    $("startOptions").open = true;
    $("startPreview").textContent = "Choose a valid starting paragraph.";
    return;
  }
  load(
    draftText,
    $("textTitle").value,
    {
      sourceIndex: paragraphAnchor(draftText, start),
      readingOptions: {
        documentType: kind,
        skipCitations: kind === "academic" && $("importSkipCitations").checked,
        skipReferences:
          kind === "academic" && $("importSkipReferences").checked,
        sections: draftSections(draftText) || detectSections(draftText, kind),
        checkinEvery: checkinSpacing($("importCheckins").value),
      },
    },
    imported,
  );
  $("inputDialog").close();
  returnToReader();
};
$("textInput").oninput = () => {
  updateDraft();
  $("textInput").setCustomValidity("");
  if (pdfDraft)
    $("pdfRangeStatus").textContent =
      $("textInput").value === pdfDraft.text
        ? "Original page view will be available."
        : "Edited text can be read, but will not link to the original PDF. Apply the page range to restore the imported text.";
};
$("sample").onclick = () => {
  load(SAMPLE, "The art of noticing");
  $("inputDialog").close();
  returnToReader();
};
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
// Review shows the whole reading as one scrolling text. Paragraphs are added
// a window at a time as the reader scrolls, so a long book stays quick.
const REVIEW_WINDOW = 1200; // about this many words either side
let reviewRange = null, // [first, last] paragraph on screen
  lastTap = { index: -1, at: 0 };
function reviewParagraph(p) {
  const tokens = paragraphGroups[p] || [];
  const block = document.createElement("p");
  block.className = "review-paragraph";
  block.dataset.paragraph = p;
  for (const t of tokens) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "token" + (t.index === selected ? " selected" : "");
    b.dataset.index = t.index;
    b.tabIndex = t.index === selected ? 0 : -1;
    b.setAttribute("aria-pressed", t.index === selected);
    b.textContent = t.text;
    block.append(b, " ");
  }
  return block;
}
// Paragraphs from `from` holding about REVIEW_WINDOW words, going `step`.
function reviewSpan(from, step) {
  const last = paragraphGroups.length - 1;
  let p = from,
    words = 0;
  while (p >= 0 && p <= last && words < REVIEW_WINDOW) {
    words += paragraphGroups[p].length;
    p += step;
  }
  return p - step;
}
function renderReview() {
  const p = data.tokens[selected].paragraph,
    last = paragraphGroups.length - 1;
  const lo = p > 0 ? reviewSpan(p - 1, -1) : 0,
    hi = p < last ? reviewSpan(p + 1, 1) : last;
  reviewRange = [lo, hi];
  const nodes = [];
  for (let i = lo; i <= hi; i++) nodes.push(reviewParagraph(i));
  $("paragraph").replaceChildren(...nodes);
  showSelection();
}
function extendReview() {
  const box = $("paragraph");
  if (!reviewRange || !$("reviewDialog").open) return;
  const [lo, hi] = reviewRange,
    last = paragraphGroups.length - 1;
  if (box.scrollTop < 800 && lo > 0) {
    const from = reviewSpan(lo - 1, -1);
    const nodes = [];
    for (let i = from; i < lo; i++) nodes.push(reviewParagraph(i));
    const height = box.scrollHeight;
    box.prepend(...nodes);
    box.scrollTop += box.scrollHeight - height;
    reviewRange[0] = from;
  }
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 800 && hi < last) {
    const to = reviewSpan(hi + 1, 1);
    for (let i = hi + 1; i <= to; i++) box.append(reviewParagraph(i));
    reviewRange[1] = to;
  }
}
$("paragraph").addEventListener("scroll", extendReview, { passive: true });
function reviewToken(index) {
  return $("paragraph").querySelector(`.token[data-index="${index}"]`);
}
// Moves the selection to `index` (rebuilding the text around it when it is
// far from what is on screen) and optionally scrolls it into view.
function selectWord(index, { scroll = false, focus = false } = {}) {
  const before = $("paragraph").querySelector(".token.selected");
  if (before) {
    before.classList.remove("selected");
    before.tabIndex = -1;
    before.setAttribute("aria-pressed", "false");
  }
  selected = index;
  const p = data.tokens[index].paragraph;
  if (!reviewRange || p < reviewRange[0] || p > reviewRange[1]) renderReview();
  else showSelection();
  const b = reviewToken(index);
  if (scroll) b?.scrollIntoView({ block: "center" });
  if (focus) b?.focus({ preventScroll: true });
  extendReview();
}
function showSelection() {
  lookupRequest++;
  $("definition").hidden = true;
  const b = reviewToken(selected);
  if (b) {
    b.classList.add("selected");
    b.tabIndex = 0;
    b.setAttribute("aria-pressed", "true");
  }
  const originalParagraph = data.tokens[selected].originalParagraph;
  $("originalParagraph").textContent =
    data.original.paragraphs[originalParagraph];
  $("originalContext").hidden =
    !readingOptions.skipCitations && !readingOptions.skipReferences;
  $("selectedWord").textContent = data.tokens[selected].text;
}
// Tap a word to choose it; tap it again straight away (a double tap) to
// read from there.
$("paragraph").addEventListener("click", (e) => {
  const b = e.target.closest(".token");
  if (!b) return;
  const index = Number(b.dataset.index),
    now = performance.now();
  const again = lastTap.index === index && now - lastTap.at < 450;
  lastTap = again ? { index: -1, at: 0 } : { index, at: now };
  selectWord(index, { focus: true });
  if (again) $("resume").click();
});
$("paragraph").addEventListener("keydown", (e) => {
  if (!e.target.closest(".token")) return;
  const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const index = clamp(selected + step, 0, data.tokens.length - 1);
  selectWord(index, { focus: true });
  reviewToken(index)?.scrollIntoView({ block: "nearest" });
});
function clearSearch() {
  $("findText").value = "";
  $("searchResults").replaceChildren();
  $("searchResults").hidden = true;
  $("searchStatus").hidden = true;
}
function review() {
  if (!data.tokens.length) return; // everything hidden by citation filtering
  pause();
  origin = reader.index;
  selected = reader.index;
  intentionalNavigation = false;
  lastTap = { index: -1, at: 0 };
  clearSearch();
  renderReview();
  $("reviewDialog").showModal();
  reviewToken(selected)?.scrollIntoView({ block: "center" });
  extendReview();
}
$("review").onclick = review;
$("returnToPlace").onclick = () => {
  intentionalNavigation = false;
  clearSearch();
  selectWord(origin, { scroll: true });
};
$("findText").oninput = () => {
  const query = $("findText").value;
  const results = findPassages(paragraphGroups, query);
  $("searchResults").hidden = !query.trim();
  $("searchStatus").hidden = !query.trim();
  $("searchStatus").textContent = results.length
    ? `${results.length === 20 ? "First 20" : results.length} matching ${results.length === 1 ? "paragraph" : "paragraphs"}`
    : "No matching text. Try a different word or phrase.";
  $("searchResults").replaceChildren(
    ...results.map((result) => {
      const button = document.createElement("button");
      button.className = "search-result";
      button.dir = "auto";
      const label = document.createElement("strong");
      label.textContent = `Paragraph ${result.paragraph + 1}`;
      button.append(label, document.createTextNode(result.excerpt));
      button.onclick = () => {
        intentionalNavigation = true;
        clearSearch();
        selectWord(result.index, { scroll: true });
      };
      return button;
    }),
  );
};
$("resume").onclick = () => {
  if (intentionalNavigation) replayParagraph = null;
  else if (selected < origin) {
    replayParagraph = data.tokens[selected].paragraph;
    profile = recordRewind(profile, replayParagraph);
  }
  refreshTiming();
  reader.seek(selected);
  $("reviewDialog").close();
  play();
};
$("define").onclick = async () => {
  const word = cleanWord(data.tokens[selected].text);
  const request = ++lookupRequest;
  const box = $("definition");
  box.hidden = false;
  box.textContent = "Looking up “" + word + "”…";
  profile = recordLookup(profile, word);
  refreshTiming();
  save();
  let result,
    error = false;
  try {
    result = await lookupWord(word);
  } catch {
    error = true;
  }
  if (request !== lookupRequest) return;
  box.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = result?.word || word;
  box.append(strong);
  if (result) {
    for (const meaning of result.meanings) {
      const p = document.createElement("p");
      const part = document.createElement("em");
      part.textContent = meaning.part + " · ";
      p.append(part, document.createTextNode(meaning.definition));
      box.append(p);
    }
    const a = document.createElement("a");
    a.href = "./dictionary/LICENSE.txt";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "WordNet dictionary · license";
    box.append(a);
  } else {
    const p = document.createElement("p");
    p.textContent = error
      ? "The dictionary could not load. Try again, or continue reading."
      : "No definition found for this word. You can choose another word or continue reading.";
    box.append(p);
  }
};
$("reviewDialog").addEventListener("close", () => lookupRequest++);
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (
    e.target.closest("input,textarea,select,[contenteditable=true]") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (
    e.code === "Space" &&
    (reader.playing || !e.target.closest("button,a") || e.target === $("play"))
  ) {
    e.preventDefault();
    if (!e.repeat) toggle();
  }
  if (!e.repeat && e.key === "ArrowLeft") {
    e.preventDefault();
    rewindSentence();
  }
  if (!e.repeat && e.key === "ArrowRight") {
    e.preventDefault();
    skipSentence();
  }
  // Up/Down change the pace in the word view (Text view keeps them for scrolling).
  if (!normalMode && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    setPace(base + (e.key === "ArrowUp" ? 10 : -10));
    showToast(`${base} words / min`, 1200);
  }
  if (!e.repeat && e.key.toLowerCase() === "s") {
    e.preventDefault();
    showPeek();
  }
  if (!e.repeat && e.key.toLowerCase() === "r") {
    e.preventDefault();
    review();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("pagehide", save);
window.addEventListener("resize", fitWord);
document.fonts.ready.then(fitWord);
filterAnchor =
  savedPosition?.documentId === documentId
    ? (savedPosition.sourceIndex ?? savedPosition.index ?? 0)
    : filterAnchor;
createReader(
  Math.min(
    visibleIndex(data.tokens, filterAnchor),
    Math.max(0, data.tokens.length - 1),
  ),
);
updateFilterUI();
reader.finished =
  !!(savedPosition?.documentId === documentId
    ? savedPosition.finished
    : saved?.finished) && reader.index === data.tokens.length - 1;
playbackUI();
checkpoint();
refreshSource();
const context = native ? null : document.modelContext;
if (context?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [
    {
      name: "get_reading_state",
      description: "Read current position and pacing settings.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        title,
        index: reader.index,
        word: data.tokens[reader.index]?.text || "",
        base,
        playing: reader.playing,
      }),
    },
    {
      name: "set_reading_pace",
      description:
        "Set the reader’s base words per minute; clears the gradual slowdown.",
      inputSchema: {
        type: "object",
        properties: {
          wordsPerMinute: { type: "integer", minimum: 80, maximum: 600 },
        },
        required: ["wordsPerMinute"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (
          !input ||
          !Number.isInteger(input.wordsPerMinute) ||
          input.wordsPerMinute < 80 ||
          input.wordsPerMinute > 600
        )
          throw Error("Pace must be an integer from 80 to 600.");
        setPace(input.wordsPerMinute);
        return { base };
      },
    },
  ];
  for (const tool of tools) {
    try {
      Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {}
  }
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}

let pdfController = null,
  lastPdfFile = null;
const pdfControls = [
  $("textTitle"),
  $("textInput"),
  $("epubFile"),
  $("sample"),
  $("pdfLayout"),
  $("applyPdfRange"),
  $("pdfFrom"),
  $("pdfTo"),
  $("pdfMargins"),
  $("inputForm").querySelector("[type=submit]"),
];
function pdfBusy(busy) {
  pdfControls.forEach((el) => (el.disabled = busy));
  $("cancelPdf").hidden = !busy;
  $("pdfFile").disabled = busy;
}
function cancelPdf() {
  if (pdfController) {
    pdfController.abort();
    pdfController = null;
    pdfBusy(false);
    $("pdfStatus").textContent =
      "Import cancelled. Your previous text is unchanged.";
  }
}
$("cancelPdf").onclick = cancelPdf;
$("inputDialog").addEventListener("close", cancelPdf);
$("pdfFile").onchange = () => {
  const file = $("pdfFile").files[0];
  if (file) importPdf(file);
};
$("retryPdf").onclick = () => {
  if (lastPdfFile) importPdf(lastPdfFile);
};
async function importPdf(file, { allowDuplicate = false } = {}) {
  if (pdfController) return;
  epubDraft = null;
  lastPdfFile = file;
  $("retryPdf").hidden = true;
  $("pdfErrorDetails").hidden = true;
  $("pdfErrorDetails").open = false;

  const controller = new AbortController();
  pdfController = controller;
  pdfBusy(true);
  $("pdfStatus").hidden = false;
  $("pdfStatus").textContent = "Opening " + file.name + "…";
  try {
    const fingerprint = await fileFingerprint(file);
    if (!allowDuplicate) {
      const duplicate = await findDuplicatePdf(fingerprint);
      if (pdfController !== controller || controller.signal.aborted) return;
      if (duplicate) {
        duplicatePending = { file, reading: duplicate };
        $("duplicateNotice").hidden = false;
        $("duplicateMessage").textContent =
          `“${duplicate.title}” is already on your bookshelf.`;
        $("pdfStatus").textContent =
          "Choose whether to reopen it or import a separate copy.";
        return;
      }
    }
    $("duplicateNotice").hidden = true;
    duplicatePending = null;
    const result = await extractPdf(file, {
      mode: $("pdfLayout").value,
      signal: controller.signal,
      onProgress: (page, total) => {
        $("pdfStatus").textContent = `Reading page ${page} of ${total}…`;
      },
    });
    if (pdfController !== controller || controller.signal.aborted) return;
    $("pdfStatus").textContent = "Checking for mislabelled letters…";
    const fixes = await repairPdfLines(result.pageModels, lookupWord, {
      signal: controller.signal,
    });
    if (pdfController !== controller || controller.signal.aborted) return;
    $("pdfStatus").textContent = "Checking words split across lines…";
    const repaired = await markLineJoins(result.pageModels, lookupWord, {
      signal: controller.signal,
    });
    if (pdfController !== controller || controller.signal.aborted) return;
    pdfDraft = { ...result, file, fingerprint };
    $("pdfOptions").hidden = false;
    $("pdfFrom").value = 1;
    $("pdfTo").value = result.pages;
    $("pdfFrom").max = result.pages;
    $("pdfTo").max = result.pages;
    $("textTitle").value = result.title;
    applyPdfRange();
    const columns = result.pageModels.filter((p) => p.columns === 2).length;
    const chapters = pdfDraft.sections?.length || 0;
    $("pdfStatus").textContent = [
      `Imported ${plural(result.pages, "page")}.`,
      result.blankPages &&
        `${plural(result.blankPages, "page had", "pages had")} no selectable text and ${result.blankPages === 1 ? "was" : "were"} skipped.`,
      chapters &&
        `Found ${plural(chapters, "chapter")} in the PDF's table of contents.`,
      columns &&
        `${plural(columns, "page uses", "pages use")} two-column reading order.`,
      repaired && `${plural(repaired, "line-break split")} repaired.`,
      repairSummary(fixes).trim(),
      "Check the text below, then open it in the reader.",
    ]
      .filter(Boolean)
      .join(" ");
  } catch (error) {
    if (!controller.signal.aborted && pdfController === controller) {
      $("pdfStatus").textContent = pdfErrorMessage(error);
      $("retryPdf").hidden = false;
      $("pdfErrorDetails").hidden = false;
      $("pdfErrorDetailText").textContent =
        `${error?.name || "Error"}: ${error?.message || "No further details available."}`;
    }
  } finally {
    if (pdfController === controller) {
      pdfController = null;
      pdfBusy(false);
    }
    $("pdfFile").value = "";
  }
}

$("inputDialog").addEventListener("close", () => {
  lastPdfFile = null;
  $("retryPdf").hidden = true;
});

async function showLibrary() {
  pause();
  const request = ++shelfRequest;
  $("libraryList").replaceChildren();
  $("libraryStatus").textContent = "Loading your readings…";
  if (!$("libraryDialog").open) $("libraryDialog").showModal();
  await checkpoint();
  try {
    const query = $("shelfSearch").value,
      view = $("shelfView").value;
    const all = await listReadings();
    const inText = query.trim() ? await searchReadingText(query) : new Set();
    const readings = all.filter(
      (r) =>
        shelfMatches(r, query, view) ||
        ((r.shelfState || "active") === view && inText.has(r.id)),
    );
    if (request !== shelfRequest || !$("libraryDialog").open) return;
    $("restoreConfirm").hidden = !restorePending;
    $("emptyTrash").hidden =
      view !== "trash" || !all.some((r) => r.shelfState === "trash");
    $("libraryStatus").textContent =
      libraryError ||
      (readings.length
        ? ""
        : query.trim()
          ? "No readings match that search."
          : view === "trash"
            ? "The Trash is empty."
            : view === "archived"
              ? "No archived readings."
              : "Your readings will appear here when you add one.");
    $("libraryList").replaceChildren(
      ...readings.map((record) => {
        const button = document.createElement("button");
        button.className =
          "library-item" + (record.id === documentId ? " current" : "");
        const name = document.createElement("strong");
        name.textContent = record.title;
        const info = document.createElement("span");
        const percent = record.finished
          ? 100
          : Math.min(
              99,
              Math.floor((record.index / Math.max(1, record.wordCount)) * 100),
            );
        const msLeft =
          (Math.max(0, record.wordCount - record.index) / base) * 60000;
        info.textContent = `${record.id === documentId ? "Reading now · " : ""}${record.finished ? "Finished" : `${percent}% read · ${formatDuration(msLeft)} left`} · ${plural(record.wordCount, "word")}`;
        const track = document.createElement("span");
        track.className = "shelf-progress";
        const fill = document.createElement("i");
        fill.style.width = percent + "%";
        track.append(fill);
        button.append(name, info, track);
        button.onclick = async () => {
          button.disabled = true;
          try {
            const reading = await getReading(record.id);
            if (request !== shelfRequest || !$("libraryDialog").open) return;
            if (!reading) throw Error();
            load(reading.text, reading.title, reading);
            $("libraryDialog").close();
            returnToReader();
          } catch {
            $("libraryStatus").textContent =
              "This reading could not be opened. Try again.";
            button.disabled = false;
          }
        };
        const row = document.createElement("div");
        row.className = "shelf-row";
        const actions = document.createElement("div");
        actions.className = "shelf-actions";
        for (const action of record.shelfState === "trash"
          ? [
              ["Restore", "active"],
              ["Delete permanently", "delete"],
            ]
          : record.shelfState === "archived"
            ? [
                ["Unarchive", "active"],
                ["Remove", "trash"],
              ]
            : [
                ["Archive", "archived"],
                ["Remove", "trash"],
              ]) {
          const control = document.createElement("button");
          control.className = "text-button";
          control.textContent = action[0];
          control.setAttribute("aria-label", action[0] + " " + record.title);
          control.onclick = () =>
            action[1] === "delete"
              ? confirmDelete(record)
              : moveReading(record, action[1]);
          actions.append(control);
        }
        row.append(button, actions);
        return row;
      }),
    );
  } catch {
    $("libraryStatus").textContent =
      "The bookshelf is unavailable in this browser. Your current reading is still open.";
  }
}
$("library").onclick = showLibrary;
$("libraryDialog").addEventListener("close", () => shelfRequest++);
$("libraryAdd").onclick = () => {
  $("libraryDialog").close();
  $("newText").click();
};

function applyPdfRange() {
  if (!pdfDraft) return;
  const from = Number($("pdfFrom").value),
    to = Number($("pdfTo").value);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to > pdfDraft.pages ||
    from > to
  ) {
    $("pdfRangeStatus").textContent =
      "Choose a valid page range, with the first page before the last.";
    return;
  }
  const composed = composePdf(pdfDraft.pageModels, {
    from,
    to,
    removeMargins: $("pdfMargins").checked,
  });
  if (!composed.text.trim()) {
    $("pdfRangeStatus").textContent =
      "No selectable text in those pages. Choose another range.";
    return;
  }
  Object.assign(pdfDraft, composed, {
    sections: outlineSections(pdfDraft.outline, composed),
  });
  $("textInput").value = composed.text;
  $("textInput").setCustomValidity("");
  $("pdfRangeStatus").textContent =
    `Pages ${from}–${to} · ${plural(composed.locations.at(-1).end + 1, "word")} · ${plural(composed.removed, "header/footer line")} removed. Original page view will be available.`;
  updateDraft();
}
$("applyPdfRange").onclick = applyPdfRange;
$("pdfLayout").onchange = () => {
  if (pdfDraft) importPdf(pdfDraft.file);
};

function updateFilterUI() {
  $("contents").textContent =
    readingOptions.documentType === "academic" ? "Sections" : "Chapters";
  $("citationSettings").hidden = readingOptions.documentType === "book";
  $("citationSettings").open = readingOptions.documentType === "academic";
  $("skipCitations").checked = !!readingOptions.skipCitations;
  $("skipReferences").checked = !!readingOptions.skipReferences;
  const range = readingOptions.referenceRange || data.detected;
  $("referenceStart").max = data.original.paragraphs.length;
  $("referenceEnd").max = data.original.paragraphs.length;
  $("referenceStart").value = range?.start || 1;
  $("referenceEnd").value = range?.end || data.original.paragraphs.length;
  $("referencePreview").textContent = range
    ? `Original paragraphs ${range.start}–${range.end}: ${data.original.paragraphs[range.start - 1]?.slice(0, 170) || ""} … ${data.original.paragraphs[range.end - 1]?.slice(-100) || ""}`
    : "No reference section detected. Set its original paragraph range below if needed.";
  $("skipReferences").disabled = !range;
  $("filterStatus").textContent =
    `${data.spans.length} candidate citations · ${data.skipped} words skipped${!data.tokens.length ? " · turn off skipping to restore text" : ""}`;
}
function applyReadingOptions(next) {
  pause();
  filterAnchor = data.tokens[reader.index]?.sourceIndex ?? filterAnchor;
  readingOptions = next;
  data = filteredReading(text, readingOptions);
  paragraphGroups = buildParagraphIndex(data.tokens);
  replayParagraph = null;
  const nextIndex = visibleIndex(data.tokens, filterAnchor);
  createReader(Math.min(nextIndex, Math.max(0, data.tokens.length - 1)));
  reader.finished = nextIndex >= data.tokens.length && data.tokens.length > 0;
  playbackUI();
  updateFilterUI();
  if (normalMode) {
    selectionStart = null;
    selectionEnd = null;
    renderNormal();
  }
  save();
  checkpoint();
}
$("skipCitations").onchange = (e) =>
  applyReadingOptions({ ...readingOptions, skipCitations: e.target.checked });
$("skipReferences").onchange = (e) =>
  applyReadingOptions({ ...readingOptions, skipReferences: e.target.checked });
$("referenceApply").onclick = () => {
  const start = Number($("referenceStart").value),
    end = Number($("referenceEnd").value);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > data.original.paragraphs.length
  ) {
    $("referencePreview").textContent =
      "Enter a valid original paragraph range.";
    return;
  }
  applyReadingOptions({ ...readingOptions, referenceRange: { start, end } });
};

// Sections that came with the imported file (an EPUB's or PDF's own table of
// contents), as long as the text hasn't been edited since.
function draftSections(value) {
  if (epubDraft && epubDraft.text === value) return epubDraft.sections;
  if (pdfDraft && pdfDraft.text === value && pdfDraft.sections?.length)
    return pdfDraft.sections;
  return null;
}
// "Worth a look" list under the text box (see text-check.js). Runs a moment
// after typing stops, since the text can be a whole book.
let textCheckTimer = 0;
function scheduleTextCheck() {
  clearTimeout(textCheckTimer);
  textCheckTimer = setTimeout(renderTextCheck, 350);
}
function renderTextCheck() {
  const box = $("textInput");
  const findings = checkText(box.value);
  $("textCheck").hidden = !findings.length;
  $("textCheckList").replaceChildren(
    ...findings.map((finding) => {
      const item = document.createElement("li");
      const message = document.createElement("span");
      message.textContent = finding.message;
      item.append(message);
      if (finding.ranges.length) {
        let next = 0;
        const show = document.createElement("button");
        show.type = "button";
        show.className = "text-button";
        show.textContent = "Show";
        show.onclick = () => {
          const [start, end] = finding.ranges[next];
          next = (next + 1) % finding.ranges.length;
          show.textContent = finding.ranges.length > 1 ? "Show next" : "Show";
          box.focus();
          box.setSelectionRange(start, end);
        };
        item.append(show);
      }
      if (finding.fix) {
        const fix = document.createElement("button");
        fix.type = "button";
        fix.className = "text-button";
        fix.textContent = finding.fixLabel || "Fix";
        fix.onclick = () => {
          box.value = finding.fix(box.value);
          box.dispatchEvent(new Event("input"));
          renderTextCheck();
        };
        item.append(fix);
      }
      return item;
    }),
  );
}
function updateDraft() {
  scheduleTextCheck();
  const value = $("textInput").value;
  if (!importTypeManual) $("importType").value = inferType(value);
  $("importAcademic").hidden = $("importType").value !== "academic";
  const paragraphs = value.trim() ? parseText(value).paragraphs : [];
  const headings =
    draftSections(value) || detectSections(value, $("importType").value);
  const options = [{ title: "Beginning", paragraph: 1 }, ...headings];
  $("startSection").replaceChildren(
    ...options.map((h) => {
      const o = document.createElement("option");
      o.value = h.paragraph;
      o.textContent = h.title;
      return o;
    }),
  );
  $("startParagraph").max = Math.max(1, paragraphs.length);
  if (Number($("startParagraph").value) > paragraphs.length)
    $("startParagraph").value = 1;
  previewStart();
}
function previewStart() {
  const paragraphs = $("textInput").value.trim()
    ? parseText($("textInput").value).paragraphs
    : [];
  const n = Number($("startParagraph").value);
  $("startPreview").textContent =
    (paragraphs[n - 1]
      ? paragraphs
          .slice(n - 1, n + 1)
          .join("\n\n")
          .slice(0, 500)
      : "") || "Add text or a PDF to preview your starting point.";
}
$("importCheckins").onchange = () => {
  try {
    storage.setItem("still-checkin-default", $("importCheckins").value);
  } catch {}
};
$("importType").onchange = () => {
  importTypeManual = true;
  updateDraft();
};
$("startSection").onchange = () => {
  $("startParagraph").value = $("startSection").value;
  previewStart();
};
$("startParagraph").oninput = previewStart;
$("readingSettings").onclick = () => {
  pause();
  $("readingTitle").value = title;
  $("readingType").value = readingOptions.documentType;
  $("checkinMode").value = String(checkinMode());
  updateFilterUI();
  $("settingsDialog").showModal();
};
$("readingType").onchange = () => {
  const type = $("readingType").value;
  applyReadingOptions({
    ...readingOptions,
    documentType: type,
    ...(type === "book" ? { skipCitations: false, skipReferences: false } : {}),
    sections: readingOptions.sections || detectSections(text, type),
  });
};
$("saveReadingDetails").onclick = () => {
  const type = $("readingType").value;
  title = $("readingTitle").value.trim() || "Untitled reading";
  applyReadingOptions({
    ...readingOptions,
    documentType: type,
    checkinEvery: checkinSpacing($("checkinMode").value),
    ...(type === "book" ? { skipCitations: false, skipReferences: false } : {}),
    sections:
      type !== readingOptions.documentType
        ? detectSections(text, type)
        : readingOptions.sections,
  });
  $("settingsDialog").close();
  returnToReader();
};
function readingSections() {
  return readingOptions.sections
    ? normalizeSections(readingOptions.sections, text)
    : detectSections(text, readingOptions.documentType);
}
function sectionRow(section) {
  const row = document.createElement("div");
  row.className = "section-edit";
  const name = document.createElement("input");
  name.value = section.title;
  name.maxLength = 120;
  name.setAttribute("aria-label", "Heading title");
  const number = document.createElement("input");
  number.type = "number";
  number.min = 1;
  number.max = data.original.paragraphs.length;
  number.value = section.paragraph;
  number.setAttribute("aria-label", "Original paragraph number");
  const remove = document.createElement("button");
  remove.className = "text-button";
  remove.textContent = "Remove";
  remove.onclick = () => row.remove();
  row.append(name, number, remove);
  return row;
}
function renderSections() {
  const sections = readingSections();
  $("sectionList").replaceChildren(
    ...sections.map((s) => {
      const b = document.createElement("button");
      b.className = "library-item";
      b.textContent = s.title;
      b.onclick = () => {
        const index = visibleIndex(
          data.tokens,
          paragraphAnchor(text, s.paragraph),
        );
        if (index >= data.tokens.length) {
          $("sectionStatus").textContent =
            "This section is skipped. Turn off the relevant skip option in Settings to read it.";
          return;
        }
        replayParagraph = null;
        refreshTiming();
        reader.seek(index);
        $("contentsDialog").close();
        render();
        if (normalMode) renderNormal();
        returnToReader();
        checkpoint();
      };
      return b;
    }),
  );
  if (!sections.length)
    $("sectionList").textContent = "No headings detected. Add one below.";
  $("sectionEditor").replaceChildren(...sections.map(sectionRow));
}
$("contents").onclick = () => {
  pause();
  $("contentsTitle").textContent =
    readingOptions.documentType === "book"
      ? "Chapters"
      : readingOptions.documentType === "academic"
        ? "Paper sections"
        : "Sections & chapters";
  $("sectionStatus").textContent = "";
  renderSections();
  $("contentsDialog").showModal();
};
$("addSection").onclick = () =>
  $("sectionEditor").append(
    sectionRow({
      title: "New heading",
      paragraph: (data.tokens[reader.index]?.originalParagraph || 0) + 1,
    }),
  );
$("saveSections").onclick = () => {
  const sections = [...$("sectionEditor").children].map((row) => ({
    title: row.children[0].value.trim(),
    paragraph: Number(row.children[1].value),
  }));
  if (
    sections.some(
      (s) =>
        !s.title ||
        !Number.isInteger(s.paragraph) ||
        s.paragraph < 1 ||
        s.paragraph > data.original.paragraphs.length,
    )
  ) {
    $("sectionStatus").textContent =
      "Every heading needs a title and a valid paragraph number.";
    return;
  }
  readingOptions = { ...readingOptions, sections };
  save();
  checkpoint();
  renderSections();
  $("sectionStatus").textContent = "Headings saved.";
};
async function findDuplicatePdf(fingerprint) {
  await checkpoint();
  const snapshot = await librarySnapshot();
  for (const source of snapshot.sources.sort(
    (a, b) =>
      (snapshot.readings.find((r) => r.id === b.id)?.updatedAt || 0) -
      (snapshot.readings.find((r) => r.id === a.id)?.updatedAt || 0),
  )) {
    let hash = source.fingerprint;
    if (!hash) {
      hash = await fileFingerprint(source.blob);
      await saveSource(source.id, { ...source, fingerprint: hash });
    }
    if (hash === fingerprint) {
      const record = snapshot.readings.find((r) => r.id === source.id);
      if (record) return record;
    }
  }
  return null;
}
$("duplicateOpen").onclick = () => {
  if (!duplicatePending) return;
  const r = duplicatePending.reading;
  load(r.text, r.title, r);
  $("inputDialog").close();
  duplicatePending = null;
  returnToReader();
};
$("duplicateCopy").onclick = () => {
  if (duplicatePending)
    importPdf(duplicatePending.file, { allowDuplicate: true });
};
$("exportLibrary").onclick = async () => {
  const button = $("exportLibrary");
  button.disabled = true;
  $("backupStatus").textContent = "Preparing backup…";
  try {
    await checkpoint();
    const snapshot = await librarySnapshot();
    if (snapshot.readings.length > MAX_BACKUP_READINGS)
      throw Error(
        `Backups can hold up to ${MAX_BACKUP_READINGS} readings and you have ${snapshot.readings.length}. Delete readings from Trash first.`,
      );
    const payload = await encodeBackup(snapshot);
    const downloadBlob = new Blob([payload], { type: "application/json" });
    if (downloadBlob.size > 250 * 1024 * 1024)
      throw Error("Backup is larger than the 250 MB restore limit.");
    await exportFile(payload);
    $("backupStatus").textContent = native
      ? "Export sheet closed. Keep your backup in a safe place."
      : "Backup downloaded.";
  } catch (error) {
    $("backupStatus").textContent =
      error.message ||
      "Backup could not be created. Your bookshelf is unchanged.";
  } finally {
    button.disabled = false;
  }
};
$("restoreFile").onchange = async () => {
  const file = $("restoreFile").files[0];
  restorePending = null;
  $("restoreConfirm").hidden = true;
  if (!file) return;
  $("backupStatus").textContent = "Checking backup…";
  try {
    if (file.size > 250 * 1024 * 1024)
      throw Error("Choose a backup smaller than 250 MB.");
    restorePending = decodeBackup(await file.text());
    const skipped = restorePending.skipped.length
      ? ` ${plural(restorePending.skipped.length, "reading is", "readings are")} too long to restore and will be skipped: ${restorePending.skipped.join(", ")}.`
      : "";
    $("backupStatus").textContent =
      `Ready to restore ${plural(restorePending.readings.length, "reading")} and ${plural(restorePending.sources.length, "PDF")}. Existing readings will be kept; matching entries become separate restored copies.${skipped}`;
    $("restoreConfirm").hidden = !restorePending.readings.length;
  } catch (error) {
    $("backupStatus").textContent =
      error.message || "This backup could not be read.";
  } finally {
    $("restoreFile").value = "";
  }
};
$("restoreConfirm").onclick = async () => {
  if (!restorePending) return;
  $("restoreConfirm").disabled = true;
  try {
    const count = await restoreLibrary(restorePending);
    restorePending = null;
    $("restoreConfirm").hidden = true;
    $("backupStatus").textContent = `Restored ${plural(count, "reading")}.`;
    await showLibrary();
  } catch (error) {
    $("backupStatus").textContent =
      error.message || "Restore failed. Your existing readings are unchanged.";
  } finally {
    $("restoreConfirm").disabled = false;
  }
};

function updateNormalHighlight() {
  if (!normalMode) return;
  const marks = readingOptions.marks || [];
  for (const span of $("normalText").querySelectorAll("[data-index]")) {
    const i = Number(span.dataset.index),
      source = data.tokens[i]?.sourceIndex;
    span.classList.toggle("current", i === reader.index);
    span.classList.toggle(
      "marked",
      marks.some((m) => source >= m.start && source <= m.end),
    );
    span.classList.toggle(
      "selecting",
      selectionStart !== null &&
        i >= Math.min(selectionStart, selectionEnd ?? selectionStart) &&
        i <= Math.max(selectionStart, selectionEnd ?? selectionStart),
    );
  }
  $("normalPosition").textContent = selectingPassage
    ? selectionStart === null
      ? "Choose the first word of your passage."
      : "Choose the last word of your passage."
    : `Word ${data.tokens.length ? reader.index + 1 : 0} of ${data.tokens.length}`;
}
function normalChunk(start, end) {
  const fragment = document.createDocumentFragment();
  let paragraph = -1,
    p;
  for (let i = start; i < end; i++) {
    const t = data.tokens[i];
    if (t.paragraph !== paragraph) {
      p = document.createElement("p");
      p.dir = "auto"; // right-to-left scripts lay out correctly
      fragment.append(p);
      paragraph = t.paragraph;
    }
    const span = document.createElement("button");
    span.className = "normal-word";
    span.dataset.index = i;
    span.textContent = t.text;
    span.onclick = () => {
      if (selectingPassage) {
        if (selectionStart === null || selectionEnd !== null) {
          selectionStart = i;
          selectionEnd = null;
        } else {
          selectionEnd = i;
          selectingPassage = false;
          $("selectPassage").setAttribute("aria-pressed", "false");
        }
      } else {
        selectionStart = null;
        selectionEnd = null;
        reader.seek(i);
        checkpoint();
      }
      updateNormalHighlight();
    };
    p.append(span, document.createTextNode(" "));
  }
  return fragment;
}
function renderNormal() {
  clearTimeout(normalScrollTimer);
  normalScrollLocked = true;
  normalStart = Math.max(0, reader.index - 300);
  normalEnd = Math.min(data.tokens.length, reader.index + 500);
  $("normalText").replaceChildren(normalChunk(normalStart, normalEnd));
  $("normalEarlier").hidden = normalStart === 0;
  $("normalLater").hidden = normalEnd === data.tokens.length;
  updateNormalHighlight();
  const current = $("normalText").querySelector(".current"),
    pane = $("normalPane");
  if (current)
    pane.scrollTop +=
      current.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      pane.clientHeight / 2;
  setTimeout(() => (normalScrollLocked = false), 250);
}
function setReadingMode(value, persist = true) {
  if (value) pause();
  normalMode = value;
  $("wordReader").hidden = value;
  $("normalReader").hidden = !value;
  $("readingMode").textContent = value ? "Word view" : "Text view";
  if (persist) {
    readingOptions = {
      ...readingOptions,
      readingMode: value ? "text" : "word",
    };
    save();
    checkpoint();
  }
  if (value) {
    renderNormal();
    if (persist) $("normalReader").scrollIntoView({ block: "start" });
  } else fitWord();
}
$("readingMode").onclick = () => setReadingMode(!normalMode);
$("normalEarlier").onclick = () => {
  const pane = $("normalPane"),
    height = pane.scrollHeight;
  normalScrollLocked = true;
  const start = Math.max(0, normalStart - 500);
  $("normalText").prepend(normalChunk(start, normalStart));
  normalStart = start;
  $("normalEarlier").hidden = !start;
  pane.scrollTop += pane.scrollHeight - height;
  updateNormalHighlight();
  setTimeout(() => (normalScrollLocked = false), 250);
};
$("normalLater").onclick = () => {
  const end = Math.min(data.tokens.length, normalEnd + 500);
  $("normalText").append(normalChunk(normalEnd, end));
  normalEnd = end;
  $("normalLater").hidden = end === data.tokens.length;
  updateNormalHighlight();
};
$("normalPane").onscroll = () => {
  clearTimeout(normalScrollTimer);
  if (normalScrollLocked || selectingPassage) return;
  normalScrollTimer = setTimeout(() => {
    if (!normalMode || normalScrollLocked) return;
    const top = $("normalPane").getBoundingClientRect().top + 15;
    const span = [...$("normalText").querySelectorAll("[data-index]")].find(
      (s) => s.getBoundingClientRect().top >= top,
    );
    if (span) {
      reader.seek(Number(span.dataset.index));
      checkpoint();
    }
  }, 160);
};
$("selectPassage").onclick = () => {
  selectingPassage = !selectingPassage;
  selectionStart = null;
  selectionEnd = null;
  $("selectPassage").setAttribute("aria-pressed", String(selectingPassage));
  $("normalPosition").textContent = selectingPassage
    ? "Choose the first word, then the last word."
    : "Selection cleared.";
  updateNormalHighlight();
};
// Hold to see the sentence: one word at a time removes the quick glance back
// that normally repairs a missed word, so holding the word (or S) pauses and
// shows the whole sentence with the current word marked. Letting go resumes.
let peekState = null;
function sentenceAround(tokens, i) {
  const same = (j) => tokens[j]?.paragraph === tokens[i].paragraph;
  let start = i,
    end = i;
  while (
    start > 0 &&
    i - start < 60 &&
    same(start - 1) &&
    !sentenceEnd.test(tokens[start - 1].text)
  )
    start--;
  while (
    end < tokens.length - 1 &&
    end - i < 60 &&
    same(end + 1) &&
    !sentenceEnd.test(tokens[end].text)
  )
    end++;
  return [start, end];
}
function showPeek() {
  if (peekState || !data.tokens.length) return;
  peekState = { resume: reader.playing };
  pause();
  const [start, end] = sentenceAround(data.tokens, reader.index);
  const parts = [];
  for (let j = start; j <= end; j++) {
    if (j > start) parts.push(" ");
    if (j === reader.index) {
      const mark = document.createElement("mark");
      mark.textContent = data.tokens[j].text;
      parts.push(mark);
    } else parts.push(data.tokens[j].text);
  }
  const sentence = document.createElement("span");
  sentence.append(...parts);
  $("peek").replaceChildren(sentence);
  $("peek").hidden = false;
  $("wordReader").classList.add("peeking");
  $("status").textContent = peekState.resume
    ? "Let go to carry on reading."
    : "Let go to return to the word.";
}
function hidePeek() {
  if (!peekState) return;
  const { resume } = peekState;
  peekState = null;
  $("peek").hidden = true;
  $("wordReader").classList.remove("peeking");
  if (resume) play();
  else playbackUI();
}
{
  // A quick tap plays or pauses; holding shows the sentence.
  const stage = document.querySelector("#wordReader .stage");
  let holdTimer = 0,
    tap = false;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("#finishCard")) return;
    clearTimeout(holdTimer);
    tap = true;
    holdTimer = setTimeout(() => {
      tap = false;
      showPeek();
    }, 250);
  });
  stage.addEventListener("pointerup", () => {
    clearTimeout(holdTimer);
    if (tap && !peekState) toggle();
    tap = false;
    hidePeek();
  });
  for (const type of ["pointercancel", "pointerleave"])
    stage.addEventListener(type, () => {
      clearTimeout(holdTimer);
      tap = false;
      hidePeek();
    });
  stage.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === "s") hidePeek();
  });
  window.addEventListener("blur", hidePeek);
}
function rewindSentence() {
  if (!data.tokens.length) return;
  const playing = reader.playing;
  pause();
  const index = previousSentence(data.tokens, reader.index);
  if (index < reader.index) {
    replayParagraph = data.tokens[index].paragraph;
    profile = recordRewind(profile, replayParagraph);
    refreshTiming();
    reader.seek(index);
  }
  if (normalMode) renderNormal();
  if (playing) play();
  checkpoint();
}
$("quickRewind").onclick = rewindSentence;
$("quickForward").onclick = () => skipSentence();
function editMark(mark = null) {
  pause();
  if (mark) markDraft = { ...mark };
  else {
    const group = paragraphGroups[data.tokens[reader.index]?.paragraph] || [];
    const selectedTokens =
      selectionStart !== null
        ? data.tokens.slice(
            Math.min(selectionStart, selectionEnd ?? selectionStart),
            Math.max(selectionStart, selectionEnd ?? selectionStart) + 1,
          )
        : group;
    if (!selectedTokens.length) return;
    const start = selectedTokens[0].sourceIndex,
      end = selectedTokens.at(-1).sourceEnd;
    // Saving the same passage again edits the existing bookmark.
    const existing = (readingOptions.marks || []).find(
      (m) => m.start === start && m.end === end,
    );
    if (existing) {
      markDraft = { ...existing };
      $("markQuote").textContent = markDraft.quote;
      $("markNote").value = markDraft.note;
      $("markDialog").showModal();
      return;
    }
    markDraft = {
      id: crypto.randomUUID(),
      start,
      end,
      quote: selectedTokens
        .map((t) => t.text)
        .join(" ")
        .slice(0, 20000),
      note: "",
      createdAt: Date.now(),
    };
  }
  $("markQuote").textContent = markDraft.quote;
  $("markNote").value = markDraft.note;
  $("markDialog").showModal();
}
function renderMarks() {
  const marks = readingOptions.marks || [];
  $("marksStatus").textContent = marks.length
    ? plural(marks.length, "saved passage")
    : "No saved passages yet.";
  $("marksList").replaceChildren(
    ...marks.map((m) => {
      const row = document.createElement("article");
      row.className = "saved-mark";
      const quote = document.createElement("blockquote");
      quote.dir = "auto";
      quote.textContent = m.quote;
      const note = document.createElement("p");
      note.textContent = m.note;
      const go = document.createElement("button");
      go.className = "outline";
      go.textContent = "Return to passage";
      go.onclick = () => {
        let index = visibleIndex(data.tokens, m.start);
        if (!data.tokens[index] || data.tokens[index].sourceIndex > m.end) {
          $("marksStatus").textContent =
            "This passage is hidden by your citation or reference settings. Its saved text is shown here.";
          return;
        }
        reader.seek(index);
        $("marksDialog").close();
        if (normalMode) renderNormal();
        returnToReader();
        checkpoint();
      };
      const edit = document.createElement("button");
      edit.className = "text-button";
      edit.textContent = "Edit note";
      edit.onclick = () => editMark(m);
      const remove = document.createElement("button");
      remove.className = "text-button danger";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete this saved passage");
      let confirmTimer;
      remove.onclick = () => {
        // Two-step delete in place: the first press asks, the second deletes.
        if (!remove.dataset.confirm) {
          remove.dataset.confirm = "1";
          remove.textContent = "Press again to delete";
          confirmTimer = setTimeout(() => {
            delete remove.dataset.confirm;
            remove.textContent = "Delete";
          }, 4000);
          return;
        }
        clearTimeout(confirmTimer);
        readingOptions = {
          ...readingOptions,
          marks: (readingOptions.marks || []).filter((x) => x.id !== m.id),
        };
        save();
        checkpoint();
        renderMarks();
        updateNormalHighlight();
        $("marksStatus").textContent =
          "Passage deleted. " + $("marksStatus").textContent;
        $("marksDialog").querySelector(".close")?.focus();
      };
      row.append(quote, note, go, edit, remove);
      return row;
    }),
  );
}
$("bookmarks").onclick = () => {
  pause();
  renderMarks();
  renderCheckins();
  $("marksDialog").showModal();
};
$("markPassage").onclick = () => editMark();
$("markCurrent").onclick = () => {
  selectionStart = null;
  selectionEnd = null;
  editMark();
};
$("saveMark").onclick = () => {
  if (!markDraft) return;
  markDraft.note = $("markNote").value;
  readingOptions = {
    ...readingOptions,
    marks: [
      ...(readingOptions.marks || []).filter((m) => m.id !== markDraft.id),
      markDraft,
    ],
  };
  save();
  checkpoint();
  $("markDialog").close();
  renderMarks();
  updateNormalHighlight();
};
// Opens the most recently used reading on the shelf other than `excludeId`,
// or the sample text when there is none. Used when the open reading is
// trashed or deleted, so the reader never shows a reading from the Trash.
async function openNextReading(excludeId) {
  let next = null;
  try {
    const summary = (await listReadings()).find(
      (r) => r.id !== excludeId && (r.shelfState || "active") === "active",
    );
    if (summary) next = await getReading(summary.id);
  } catch {}
  if (next?.text) load(next.text, next.title, next);
  else load(SAMPLE, "The art of noticing");
  await archiveQueue;
}
async function moveReading(record, state) {
  try {
    await archiveQueue;
    lastShelfMove = { id: record.id, from: record.shelfState || "active" };
    if (record.id === documentId) {
      shelfState = state;
      save();
      await checkpoint();
      if (state === "trash") await openNextReading(record.id);
    } else await setShelfState(record.id, state);
    $("undoShelf").hidden = false;
    await showLibrary();
    $("libraryStatus").textContent =
      state === "trash"
        ? "Moved to Trash. Restore it any time."
        : state === "archived"
          ? "Reading archived."
          : "Reading restored.";
  } catch {
    $("libraryStatus").textContent = "Could not move this reading. Try again.";
  }
}
$("undoShelf").onclick = async () => {
  if (!lastShelfMove) return;
  const move = lastShelfMove;
  lastShelfMove = null;
  await moveReading({ id: move.id, shelfState: "active" }, move.from);
  lastShelfMove = null;
  $("undoShelf").hidden = true;
};
$("shelfSearch").oninput = showLibrary;
$("shelfView").onchange = showLibrary;
function applyAppearance() {
  const theme = ["light", "dark", "system"].includes(appearance.theme)
    ? appearance.theme
    : "system";
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const font =
    {
      serif: "var(--serif)",
      sans: "var(--sans)",
      mono: "ui-monospace, monospace",
    }[appearance.font] || "var(--serif)";
  document.documentElement.style.setProperty("--reading-font", font);
  const size = clamp(Number(appearance.size) || 100, 80, 150);
  document.documentElement.style.setProperty("--reading-scale", size / 100);
  $("appearanceTheme").value = theme;
  $("appearanceFont").value = appearance.font || "serif";
  $("appearancePlacement").value =
    appearance.placement === "anchored" ? "anchored" : "centered";
  $("appearanceTransition").value =
    appearance.transition === "instant" ? "instant" : "soft";
  $("appearanceProgress").value =
    appearance.progress === "percent" ? "percent" : "time";
  $("appearanceSize").value = size;
  $("appearanceSizeLabel").textContent = size + "%";
  try {
    storage.setItem("still-appearance", JSON.stringify(appearance));
  } catch {}
  if (reader) showWord(data.tokens[reader.index]?.text || "No visible words");
}
for (const id of [
  "appearanceTheme",
  "appearanceFont",
  "appearanceSize",
  "appearancePlacement",
  "appearanceTransition",
  "appearanceProgress",
])
  $(id).oninput = () => {
    appearance = {
      theme: $("appearanceTheme").value,
      font: $("appearanceFont").value,
      size: Number($("appearanceSize").value),
      placement: $("appearancePlacement").value,
      transition: $("appearanceTransition").value,
      progress: $("appearanceProgress").value,
    };
    applyAppearance();
    if (reader) updateTimeLeft();
  };
// Tapping the time left switches to percent read, and back.
$("timeLeft").onclick = () => {
  appearance = {
    ...appearance,
    progress: appearance.progress === "percent" ? "time" : "percent",
  };
  applyAppearance();
  updateTimeLeft();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener(
  "change",
  applyAppearance,
);
applyAppearance();
$("epubFile").onchange = async () => {
  const file = $("epubFile").files[0];
  if (!file || pdfController) return;
  const controller = new AbortController();
  pdfController = controller;
  pdfBusy(true);
  $("epubStatus").textContent = "Opening EPUB…";
  try {
    const result = await extractEpub(file, {
      signal: controller.signal,
      onProgress: (n, total) =>
        ($("epubStatus").textContent = `Reading chapter ${n} of ${total}…`),
    });
    if (controller.signal.aborted) return;
    epubDraft = result;
    pdfDraft = null;
    importTypeManual = true;
    $("importType").value = "book";
    $("textTitle").value = result.title;
    $("textInput").value = result.text;
    $("pdfOptions").hidden = true;
    $("pdfStatus").hidden = true;
    $("textInput").setCustomValidity("");
    updateDraft();
    $("epubStatus").textContent =
      `Imported ${plural(result.chapters, "chapter")} with ${plural(result.sections.length, "table-of-contents entry", "table-of-contents entries")}. Choose a starting point below.`;
  } catch (error) {
    if (!controller.signal.aborted)
      $("epubStatus").textContent =
        error.message || "This EPUB could not be read.";
  } finally {
    if (pdfController === controller) {
      pdfController = null;
      pdfBusy(false);
    }
    $("epubFile").value = "";
  }
};
if (native) {
  $("prepareOffline").hidden = true;
  $("offlineStatus").textContent =
    "Reader, dictionary and PDF tools are included for offline use.";
} else setupOffline($("prepareOffline"), $("offlineStatus"));
setReadingMode(readingOptions.readingMode === "text", false);

document.addEventListener("still-background", () => {
  pause();
  flushStorage().catch(() => {});
});
document.addEventListener("still-storage-failed", () => {
  $("saved").textContent =
    "Could not save. Unlock your device and keep Still open.";
  $("saved").classList.add("storage-error");
});

let deletePending = null;
function confirmDelete(record, trash = null) {
  pause();
  deletePending = trash ? { trash } : record;
  $("deleteDescription").textContent = trash
    ? `Permanently delete ${plural(trash.length, "reading")} in the Trash, with their original files and notes? Exported copies and device backups are not removed.`
    : record
      ? "Permanently delete “" +
        record.title +
        "”, its original file and notes from this app? Exported copies and device backups are not removed."
      : "Erase all readings, original files, notes and reading preferences from this app? Exported copies and device backups are not removed.";
  $("deleteError").textContent = "";
  $("deleteDialog").showModal();
}
$("eraseDevice").onclick = () => confirmDelete(null);
$("emptyTrash").onclick = async () => {
  try {
    const trash = (await listReadings()).filter(
      (r) => r.shelfState === "trash",
    );
    if (trash.length) confirmDelete(null, trash);
  } catch {
    $("libraryStatus").textContent = "The Trash could not be read. Try again.";
  }
};
$("confirmDelete").onclick = async () => {
  const b = $("confirmDelete");
  b.disabled = true;
  try {
    pause();
    await archiveQueue;
    if (deletePending) {
      const ids = deletePending.trash
        ? deletePending.trash.map((r) => r.id)
        : [deletePending.id];
      if (ids.includes(documentId)) {
        await openNextReading(documentId);
        await flushStorage();
      }
      for (const id of ids) await deleteReading(id);
      lastShelfMove = null;
      $("undoShelf").hidden = true;
      $("deleteDialog").close();
      await showLibrary();
    } else {
      await flushStorage();
      erasing = true;
      await eraseLibrary();
      for (const key of [
        KEY,
        KEY + "-position",
        "still-appearance",
        HABITS,
        ONBOARDED,
        PACE_FOUND,
      ])
        storage.removeItem(key);
      await flushStorage();
      location.reload();
    }
  } catch {
    erasing = false;
    $("deleteError").textContent =
      "Could not finish deleting. Unlock your device and try again.";
  } finally {
    b.disabled = false;
  }
};
// One sentence describing what text-repair.js fixed, or "".
function repairSummary({ map, notes }) {
  const parts = [];
  if (map.size)
    parts.push(
      `Fixed letters the font had mislabelled (${describeGlyphMap(map)}).`,
    );
  if (notes)
    parts.push(`Removed ${plural(notes, "note number")} from the text.`);
  return parts.length ? parts.join(" ") + " " : "";
}
// Text copied out of a PDF carries the same faults as an imported one.
$("textInput").addEventListener("paste", () => {
  setTimeout(async () => {
    const before = $("textInput").value;
    const fixed = await repairText(before, lookupWord);
    if (fixed.text === before || $("textInput").value !== before) return;
    $("textInput").value = fixed.text;
    $("textInput").dispatchEvent(new Event("input"));
    const summary = repairSummary(fixed);
    if (summary) $("textFileStatus").textContent = summary.trim();
  });
});
$("textFile").onchange = async () => {
  const file = $("textFile").files[0];
  if (!file) return;
  try {
    // UTF-8 uses up to 4 bytes per character, so check characters after reading.
    if (file.size > MAX_READING_CHARACTERS * 4)
      throw Error("This text file is too large to read in Still.");
    const value = await file.text();
    if (!value.trim()) throw Error("This text file is empty.");
    if (value.length > MAX_READING_CHARACTERS)
      throw Error(
        `This file is too long for one reading (${value.length.toLocaleString()} characters; the limit is ${MAX_READING_CHARACTERS.toLocaleString()}). Split it into parts first.`,
      );
    pdfDraft = null;
    epubDraft = null;
    // A Markdown file's symbols are never meant to be read as words.
    const markdown = /\.(?:md|markdown)$/i.test(file.name);
    const fixed = await repairText(
      markdown ? stripMarkdown(value) : value,
      lookupWord,
    );
    $("textInput").value = fixed.text;
    $("textTitle").value = file.name.replace(/\.[^.]+$/, "").slice(0, 240);
    $("pdfOptions").hidden = true;
    $("pdfStatus").hidden = true;
    updateDraft();
    $("textFileStatus").textContent =
      "Text imported. " +
      (markdown ? "Removed Markdown symbols. " : "") +
      repairSummary(fixed) +
      "Check it before opening.";
  } catch (e) {
    $("textFileStatus").textContent = e.message;
  } finally {
    $("textFile").value = "";
  }
};
// The privacy/help pages are generated for the iOS app only; the web build
// links straight to the bundled third-party licenses instead.
$("appNotices").hidden = !native;
$("webNotices").hidden = native;
$("aboutStill").onclick = () => {
  pause();
  $("aboutDialog").showModal();
};

// ---- Comprehension check-ins (see checkins.js) ----
function segmentQuote(from, to) {
  const words = data.tokens.slice(from, to + 1).map((t) => t.text);
  return words.length > 14
    ? words.slice(0, 7).join(" ") + " … " + words.slice(-5).join(" ")
    : words.join(" ");
}
function openCheckIn(index, { end = false, manual = false } = {}) {
  if (!data.tokens.length || $("checkinDialog").open) return;
  const from = Math.min(
    manual
      ? paragraphGroups[data.tokens[index].paragraph][0].index
      : segmentStart,
    index,
  );
  pendingCheckin = {
    index,
    end,
    from,
    record: {
      id: crypto.randomUUID(),
      start: data.tokens[from].sourceIndex,
      end: data.tokens[index].sourceEnd,
      quote: segmentQuote(from, index).slice(0, 300),
      createdAt: Date.now(),
    },
  };
  $("checkinTitle").textContent = end
    ? "You've reached the end. What was it about?"
    : "What was that about?";
  $("checkinRecap").value = "";
  $("checkinAsk").hidden = false;
  $("checkinFollow").hidden = true;
  $("checkinDialog").showModal();
  $("checkinRecap").focus();
}
// Leaves the check-in and carries on reading (or stays put at the end).
function finishCheckIn({ resume = true } = {}) {
  const pending = pendingCheckin;
  pendingCheckin = null;
  wordsRead = 0;
  if ($("checkinDialog").open) $("checkinDialog").close();
  if (!pending || pending.end || pending.manual) return;
  if (pending.index < data.tokens.length - 1) reader.seek(pending.index + 1);
  if (resume) play();
  else returnToReader();
}
function rateCheckIn(rating) {
  if (!pendingCheckin) return;
  const entry = {
    ...pendingCheckin.record,
    rating,
    recap: $("checkinRecap").value.trim(),
  };
  const checkins = normalizeCheckins(
    [...(readingOptions.checkins || []), entry],
    Number.MAX_SAFE_INTEGER,
  );
  readingOptions = { ...readingOptions, checkins };
  if (rating === "lost")
    // Ease the pace a little for this reading (Reset adjustments undoes it).
    profile = {
      ...profile,
      slowdown: clamp((profile.slowdown || 0) + 0.05, 0, 0.2),
    };
  refreshTiming();
  save();
  checkpoint();
  const next = followUp(checkins);
  if (next === "replay") {
    showFollowUp(
      "No problem. One-word reading takes away the quick glances back that usually fill gaps. Replay that stretch a little slower? Your pace also eases slightly for this reading.",
      ["Keep going", () => finishCheckIn()],
      [
        "Replay it slower",
        () => {
          const pending = pendingCheckin;
          pendingCheckin = null;
          wordsRead = 0;
          $("checkinDialog").close();
          replaySet = new Set(
            data.tokens
              .slice(pending.from, pending.index + 1)
              .map((t) => t.paragraph),
          );
          refreshTiming();
          reader.seek(pending.from);
          play();
        },
      ],
    );
  } else if (next === "faster") {
    const eased = profile.slowdown > 0;
    showFollowUp(
      eased
        ? "Your last three check-ins were clear. Go back to your usual pace?"
        : `Your last three check-ins were clear. Try ${Math.min(600, base + 10)} WPM?`,
      ["Keep this pace", () => finishCheckIn()],
      [
        eased ? "Use my usual pace" : `Try ${Math.min(600, base + 10)} WPM`,
        () => {
          if (eased) profile = { ...profile, slowdown: 0 };
          else setPace(base + 10);
          refreshTiming();
          render();
          finishCheckIn();
        },
      ],
    );
  } else finishCheckIn();
}
function showFollowUp(
  message,
  [secondaryLabel, secondary],
  [primaryLabel, primary],
) {
  $("checkinAsk").hidden = true;
  $("checkinFollow").hidden = false;
  $("checkinTitle").textContent = primaryLabel.startsWith("Replay")
    ? "Want another pass?"
    : "Nicely done";
  $("checkinFollowText").textContent = message;
  $("checkinSecondary").textContent = secondaryLabel;
  $("checkinSecondary").onclick = secondary;
  $("checkinPrimary").textContent = primaryLabel;
  $("checkinPrimary").onclick = primary;
  $("checkinPrimary").focus();
}
for (const button of document.querySelectorAll("#checkinDialog [data-rating]"))
  button.onclick = () => rateCheckIn(button.dataset.rating);
$("checkinSkip").onclick = () => finishCheckIn();
$("checkinDialog").addEventListener("keydown", (e) => {
  if (e.target === $("checkinRecap") || $("checkinAsk").hidden) return;
  const rating = { 1: "clear", 2: "mostly", 3: "lost" }[e.key];
  if (rating) {
    e.preventDefault();
    rateCheckIn(rating);
  }
});
// Escape or × skips the check-in but stays paused.
$("checkinDialog").addEventListener("close", () => {
  if (pendingCheckin) finishCheckIn({ resume: false });
});
function renderCheckins() {
  const checkins = readingOptions.checkins || [];
  const s = summarizeCheckins(checkins);
  $("checkinSummary").textContent = s.total
    ? `${plural(s.total, "check-in")} for this reading: ${s.clear} clear · ${s.mostly} mostly · ${s.lost} lost the thread.`
    : checkinMode() === "off"
      ? "Check-ins are off for this reading. Turn them on in Settings, or check in now."
      : "Your check-ins for this reading will appear here.";
  const labels = { clear: "Clear", mostly: "Mostly", lost: "Lost the thread" };
  $("checkinList").replaceChildren(
    ...checkins
      .slice()
      .reverse()
      .map((c) => {
        const row = document.createElement("article");
        row.className = "checkin-entry";
        const chip = document.createElement("span");
        chip.className = "checkin-chip " + c.rating;
        chip.textContent = labels[c.rating];
        const recap = document.createElement("p");
        recap.dir = "auto";
        recap.textContent = c.recap || "No recap written.";
        const quote = document.createElement("p");
        quote.className = "quote";
        quote.dir = "auto";
        quote.textContent = c.quote;
        const go = document.createElement("button");
        go.className = "text-button";
        go.textContent = "Reread this part";
        go.onclick = () => {
          const index = visibleIndex(data.tokens, c.start);
          if (index >= data.tokens.length) return;
          reader.seek(index);
          $("marksDialog").close();
          if (normalMode) renderNormal();
          returnToReader();
          checkpoint();
        };
        row.append(chip, recap, quote, go);
        return row;
      }),
  );
}
$("checkinNow").onclick = () => {
  if (!data.tokens.length) return;
  $("marksDialog").close();
  openCheckIn(reader.index, { manual: true });
  pendingCheckin.manual = true;
};
// ---- Daily goal, streak and reading sessions (see habits.js) ----
// A session is one stretch of playback. Short interruptions (a peek, a
// check-in, a sentence rewind) carry on the same session for the summary.
function startSession() {
  if (session || reader.playing || !data.tokens.length) return;
  const carry =
    lastSession && Date.now() - lastSession.end < 15000 ? lastSession : null;
  session = {
    start: performance.now(),
    words: 0,
    priorMs: carry?.ms || 0,
    priorWords: carry?.words || 0,
  };
  lastSession = null;
}
function endSession() {
  if (!session) return;
  const ms = performance.now() - session.start;
  habits = recordReading(habits, { ms, words: session.words });
  lastSession = {
    ms: session.priorMs + ms,
    words: session.priorWords + session.words,
    end: Date.now(),
  };
  session = null;
  saveHabits();
  updateToday();
}
function saveHabits() {
  try {
    storage.setItem(HABITS, JSON.stringify(habits));
  } catch {}
}
// What the reader sees after pausing: a small, honest "well done".
function sessionSummary(last) {
  if (last.ms < 15000 || last.words < 20)
    return "Paused. Tap the word or press Space to carry on.";
  const t = today(habits);
  const goal = t.met
    ? "Today’s goal is done."
    : `Today: ${Math.floor(t.ms / 60000)} of ${habits.goal} min.`;
  const wpm = Math.round(last.words / (last.ms / 60000));
  return `Nice stretch: ${formatElapsed(last.ms)} · ${plural(last.words, "word")} · ${wpm} wpm. ${goal}`;
}
// "4 min left in chapter" (or in the reading), from the timing plan itself,
// so it already includes slower replays and the reader's adjustments.
function updateTimeLeft() {
  const n = data.tokens.length,
    i = reader.index;
  let text = "",
    whole = "";
  if (n && !reader.finished) {
    const list = chapterStarts();
    const at = list.length >= 2 ? chapterAt(i) : -1;
    const end = at >= 0 ? (list[at + 1]?.index ?? n) : n;
    const left = (timingSums[end] || 0) - (timingSums[i] || 0);
    text = `${sentenceCase(formatDuration(left))} left${end < n ? " in chapter" : ""}`;
    whole = `${sentenceCase(formatDuration((timingSums[n] || 0) - (timingSums[i] || 0)))} left in this reading`;
    if (appearance.progress === "percent") {
      whole = `${text}. Tap to show time left.`;
      text = `${Math.floor(((i + 1) / n) * 100)}% read`;
    } else whole += ". Tap to show percent read.";
  }
  if (text + whole === timeLeftKey) return;
  timeLeftKey = text + whole;
  $("timeLeft").textContent = text;
  $("timeLeft").title = whole;
}
function updateToday() {
  todayShownAt = performance.now();
  const extraMs = session ? performance.now() - session.start : 0;
  const t = today(habits, { extraMs });
  const s = streak(habits, { extraMs });
  const words = t.words + (session?.words || 0);
  const minutes = Math.floor(t.ms / 60000);
  $("goalArc").setAttribute("stroke-dasharray", `${t.fraction * 100} 100`);
  $("goalRing").classList.toggle("met", t.met);
  $("goalRing").classList.toggle("empty", t.ms < 1000);
  $("goalRing").setAttribute(
    "aria-label",
    t.met
      ? "Today’s goal is done"
      : `${Math.round(t.fraction * 100)}% of today’s goal`,
  );
  $("todayLine").textContent = t.met
    ? `Goal done · ${formatDuration(t.ms)}${words ? ` · ${plural(words, "word")}` : ""}`
    : `${minutes} of ${habits.goal} min${words ? ` · ${plural(words, "word")}` : ""}`;
  const toGo = Math.max(1, Math.ceil((t.goalMs - t.ms) / 60000));
  $("streakLine").textContent = !s.count
    ? `Read ${plural(toGo, "more minute")} to start a streak.`
    : s.metToday
      ? `${s.count}-day streak. See you tomorrow.`
      : `${s.count}-day streak. ${plural(toGo, "more minute")} keeps it going.`;
  $("goalButton").textContent = `Daily goal: ${habits.goal} min`;
  $("streakCount").textContent = s.count;
  $("streakChip").classList.toggle("lit", s.metToday);
  $("streakChip").setAttribute(
    "aria-label",
    `${plural(s.count, "day")} in a row. Today: ${minutes} of ${habits.goal} minutes. Change daily goal.`,
  );
  $("weekStrip").replaceChildren(
    ...week(habits, { extraMs }).map((day) => {
      const li = document.createElement("li");
      li.className =
        (day.met ? "met" : day.ms > 0 ? "some" : "") +
        (day.today ? " is-today" : "");
      li.setAttribute(
        "aria-label",
        `${day.today ? "Today" : day.name}: ${day.met ? "goal done" : day.ms > 0 ? formatDuration(day.ms) : "no reading"}`,
      );
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = day.label;
      label.setAttribute("aria-hidden", "true");
      li.append(dot, label);
      return li;
    }),
  );
  // Celebrate once a day, the moment the goal is reached while reading.
  if (t.met && celebratedDay !== dayKey()) {
    celebratedDay = dayKey();
    if (session)
      showToast(
        `Daily goal done${s.count > 1 ? ` · ${s.count}-day streak` : ""}. Keep going if you like.`,
      );
  }
}
function showToast(message, ms = 4500) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), ms);
}
// The end of a reading: a short "you did it" and the obvious next step.
function showFinish(show) {
  $("wordReader").classList.toggle("done", show);
  $("finishCard").hidden = !show;
  if (!show) return;
  const s = streak(habits);
  $("finishTitle").textContent = `You finished “${title}”`;
  $("finishStats").textContent = [
    plural(data.tokens.length, "word"),
    s.count ? `${s.count}-day streak` : "",
    today(habits).met
      ? "today’s goal done"
      : `${Math.floor(today(habits).ms / 60000)} of ${habits.goal} min today`,
  ]
    .filter(Boolean)
    .join(" · ");
  const request = ++finishRequest;
  finishNext = null;
  $("finishNext").textContent = "Add a reading";
  listReadings()
    .then((all) => {
      if (request !== finishRequest) return;
      finishNext = all.find(
        (r) =>
          r.id !== documentId &&
          (r.shelfState || "active") === "active" &&
          !r.finished,
      );
      if (finishNext)
        $("finishNext").textContent = `Up next: ${finishNext.title}`;
    })
    .catch(() => {});
}
$("finishNext").onclick = async () => {
  if (!finishNext) return $("newText").click();
  try {
    const reading = await getReading(finishNext.id);
    if (!reading) throw Error();
    load(reading.text, reading.title, reading);
    returnToReader();
  } catch {
    showLibrary();
  }
};
$("finishShelf").onclick = showLibrary;
function skipSentence() {
  if (!data.tokens.length) return;
  const playing = reader.playing;
  pause();
  reader.seek(nextSentence(data.tokens, reader.index));
  if (normalMode) renderNormal();
  if (playing) play();
  checkpoint();
}
// First run: what Still is, a daily goal, then (optionally) Find my pace.
function openWelcome(step) {
  pause();
  welcomeFlow = step === "intro";
  showWelcomeStep(step);
  if (!$("welcomeDialog").open) $("welcomeDialog").showModal();
  $("welcomeDialog")
    .querySelector(
      `[data-step=${step}] .primary, [data-step=${step}] input:checked`,
    )
    ?.focus();
}
function showWelcomeStep(step) {
  for (const el of $("welcomeDialog").querySelectorAll("[data-step]"))
    el.hidden = el.dataset.step !== step;
  const [eyebrow, heading] = WELCOME_COPY[step];
  $("welcomeEyebrow").textContent =
    step === "goal"
      ? welcomeFlow
        ? "Step 1 of 2"
        : "Your daily goal"
      : eyebrow;
  $("welcomeTitle").textContent = heading;
  if (step === "goal") {
    renderGoalOptions();
    $("goalSave").textContent = welcomeFlow ? "Continue" : "Save goal";
  }
}
function renderGoalOptions() {
  $("goalOptions").replaceChildren(
    ...GOALS.map((g) => {
      const label = document.createElement("label");
      label.className = "goal-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "goal";
      input.value = g.minutes;
      input.checked = g.minutes === habits.goal;
      const minutes = document.createElement("strong");
      minutes.textContent = `${g.minutes} min a day`;
      const name = document.createElement("span");
      name.textContent = g.label;
      const words = document.createElement("span");
      words.className = "muted";
      words.textContent = `about ${(Math.round((g.minutes * base) / 100) * 100).toLocaleString()} words at your pace`;
      label.append(input, minutes, name, words);
      return label;
    }),
  );
}
$("welcomeNext").onclick = () => {
  showWelcomeStep("goal");
  $("goalOptions").querySelector("input:checked")?.focus();
};
$("welcomeSkip").onclick = () => $("welcomeDialog").close();
$("goalSave").onclick = () => {
  const goal = Number($("goalOptions").querySelector("input:checked")?.value);
  habits = normalizeHabits({ ...habits, goal });
  saveHabits();
  celebratedDay = today(habits).met ? dayKey() : "";
  updateToday();
  if (welcomeFlow) {
    showWelcomeStep("pace");
    $("welcomePace").focus();
  } else {
    $("welcomeDialog").close();
    returnToReader();
  }
};
$("welcomeSample").onclick = () => {
  $("welcomeDialog").close();
  returnToReader();
};
$("welcomePace").onclick = () => {
  $("welcomeDialog").close();
  openPaceFinder();
};
$("welcomeDialog").addEventListener("close", () => {
  try {
    storage.setItem(ONBOARDED, "1");
  } catch {}
});
$("goalButton").onclick = () => openWelcome("goal");
$("streakChip").onclick = () => openWelcome("goal");
updateToday();
{
  let onboarded = true;
  try {
    onboarded = !!storage.getItem(ONBOARDED);
  } catch {}
  if (!onboarded && !saved) openWelcome("intro");
}
// Signals that startup finished (used by the browser tests).
document.documentElement.dataset.ready = "true";
