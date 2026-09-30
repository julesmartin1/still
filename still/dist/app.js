import { extractEpub } from "./epub.js";
import { previousSentence, shelfMatches } from "./reading-features.js";
import { setupOffline } from "./offline.js";
import {
  inferType,
  detectSections,
  paragraphAnchor,
  normalizeSections,
  fileFingerprint,
} from "./document.js";
import { encodeBackup, decodeBackup } from "./backup.js";
import { filteredReading, visibleIndex } from "./citations.js";
import { composePdf, markLineJoins } from "./pdf-layout.js";
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
} from "./library.js";
import {
  buildParagraphIndex,
  paragraphStart,
  findPassages,
} from "./navigation.js";
import { extractPdf, pdfErrorMessage } from "./pdf-import.js";
import { lookupWord } from "./dictionary.js";
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
} from "./engine.js";
const $ = (id) => document.getElementById(id);
const SAMPLE = `There is a kind of quiet that only arrives in the early morning. Before the messages, before the traffic, before the day begins asking things of you. The room is still. Light moves slowly across the floor.

On the windowsill, a small bird lands and tilts its head. You have walked past this window a thousand times. Today, for no particular reason, you stop. The bird stays for a moment, then disappears into the blue.

Noticing is an unassuming habit. It asks for nothing elaborate: a little attention, a willingness to linger, an occasional departure from the familiar. The ordinary world becomes less ordinary when we give it a second look.

There are words for these small discoveries. Ephemeral describes something that lasts only briefly. Serendipity is the happy accident of finding something you were not looking for. Neither requires a grand adventure. Sometimes, all it takes is an open window.

Later, when the day grows busy, you may remember the bird. You may forget it entirely. Either way, for a few seconds, you were there. The light, the quiet, the world just outside. And that was enough.`;
const KEY = "still-reader-v1";
let saved;
try {
  saved = JSON.parse(localStorage.getItem(KEY));
} catch {}
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
  appearance = JSON.parse(localStorage.getItem("still-appearance")) || {};
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
  savedPosition = JSON.parse(localStorage.getItem(KEY + "-position"));
} catch {}
let data = filteredReading(text, readingOptions),
  reader,
  replayParagraph = null,
  selected = 0,
  viewParagraph = 0,
  origin = 0,
  lookupRequest = 0,
  timingPlan = [],
  paragraphGroups = buildParagraphIndex(data.tokens),
  intentionalNavigation = false;
function refreshTiming() {
  timingPlan = buildTimingPlan(data.tokens, { base, profile, replayParagraph });
}
function save() {
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
      localStorage.setItem(
        KEY,
        JSON.stringify({
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
        }),
      );
      savedText = text;
      savedSettings = settings;
    }
    localStorage.setItem(
      KEY + "-position",
      JSON.stringify({
        documentId,
        sourceIndex: data.tokens[reader?.index]?.sourceIndex ?? filterAnchor,
        index: reader?.index || 0,
        finished: reader?.finished || false,
      }),
    );
    $("saved").textContent = libraryError || "Saved on this device";
    $("saved").classList.toggle("storage-error", !!libraryError);
  } catch {
    $("saved").textContent = "Storage unavailable · keep this tab open";
    $("saved").classList.add("storage-error");
  }
}

function fitWord() {
  const el = $("word");
  el.style.fontSize = "";
  el.style.whiteSpace = "nowrap";
  el.style.overflowWrap = "normal";
  let size = parseFloat(getComputedStyle(el).fontSize);
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
  $("word").textContent = t?.text || "No visible words";
  fitWord();
  $("count").textContent =
    `${data.tokens.length ? reader.index + 1 : 0} / ${data.tokens.length} words`;
  $("progress").style.width =
    `${data.tokens.length ? ((reader.index + 1) / data.tokens.length) * 100 : 0}%`;
  $("title").textContent = title;
  $("speed").value = base;
  if (document.activeElement !== $("speedValue")) $("speedValue").value = base;
  $("slower").disabled = base <= 80;
  $("faster").disabled = base >= 600;
  $("learning").textContent =
    `Current target: ${Math.round(targetWpm(base, profile, t?.paragraph === replayParagraph))} WPM${t?.paragraph === replayParagraph ? " · slower replay" : profile.slowdown ? " · adjusted for you" : ""}`;
  $("play").disabled = !data.tokens.length;
  $("review").disabled = !data.tokens.length;
  $("quickRewind").disabled = !data.tokens.length;
  updateNormalHighlight();
  save();
}
function playbackUI() {
  const playing = reader.playing;
  $("play").innerHTML = playing
    ? "Ⅱ <span>Pause</span>"
    : reader.finished
      ? "↻ <span>Read again</span>"
      : "▶ <span>Start reading</span>";
  $("mode").textContent = playing
    ? "IN YOUR OWN TIME"
    : reader.finished
      ? "A GOOD PLACE TO PAUSE"
      : "READY WHEN YOU ARE";
  $("status").textContent = playing
    ? ""
    : reader.finished
      ? "You’ve reached the end."
      : "Settle in. Start when you’re ready.";
}
function createReader(index = 0) {
  reader?.pause();
  refreshTiming();
  reader = new Playback({
    length: data.tokens.length,
    duration: (i) => timingPlan[i],
    onWord: () => render(),
    onEnd: () => {
      playbackUI();
      save();
      checkpoint();
    },
  });
  reader.seek(Number.isInteger(index) ? index : 0);
  playbackUI();
}
function pause() {
  reader.pause();
  playbackUI();
  save();
  checkpoint();
}
function play() {
  if (normalMode) setReadingMode(false);
  reader.play();
  playbackUI();
  $("play").focus({ preventScroll: true });
}
function toggle() {
  reader.playing ? pause() : play();
}
function checkpoint() {
  if (!reader) return Promise.resolve(false);
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
  refreshTiming();
  reader.retime();
  render();
  $("speedValue").value = base;
}
$("play").onclick = toggle;
$("speed").oninput = (e) => setPace(e.target.value);
$("speedValue").oninput = (e) => {
  const value = Number(e.target.value);
  if (e.target.value.trim() && value >= 80 && value <= 600) setPace(value);
};
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
  $("importSkipCitations").checked = false;
  $("importSkipReferences").checked = false;
  $("pdfOptions").hidden = true;
  $("pdfStatus").hidden = true;
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
        sections:
          epubDraft && epubDraft.text === draftText
            ? epubDraft.sections
            : detectSections(draftText, kind),
      },
    },
    imported,
  );
  $("inputDialog").close();
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
};
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
function renderParagraph({ preserveScroll = false } = {}) {
  lookupRequest++;
  $("definition").hidden = true;
  const ts = paragraphGroups[viewParagraph];
  if (!ts.some((t) => t.index === selected)) selected = ts[0].index;
  const scroll = $("paragraph").scrollTop;
  const nodes = [];
  for (const t of ts) {
    const b = document.createElement("button");
    b.className = "token" + (t.index === selected ? " selected" : "");
    b.textContent = t.text;
    b.setAttribute("aria-pressed", t.index === selected);
    b.onclick = () => {
      selected = t.index;
      renderParagraph({ preserveScroll: true });
      $("paragraph").querySelector(".selected")?.focus({ preventScroll: true });
    };
    nodes.push(b, document.createTextNode(" "));
  }
  const originalParagraph = data.tokens[selected].originalParagraph;
  $("originalParagraph").textContent =
    data.original.paragraphs[originalParagraph];
  $("originalContext").hidden =
    !readingOptions.skipCitations && !readingOptions.skipReferences;
  $("paragraph").replaceChildren(...nodes);
  $("paragraph").scrollTop = preserveScroll ? scroll : 0;
  $("selectedWord").textContent = data.tokens[selected].text;
  $("jumpParagraph").value = viewParagraph + 1;
  $("jumpParagraph").max = data.paragraphs.length;
  $("paraNumber").textContent = `of ${data.paragraphs.length}`;
  $("prevPara").disabled = viewParagraph === 0;
  $("nextPara").disabled = viewParagraph === data.paragraphs.length - 1;
}
function clearSearch() {
  $("findText").value = "";
  $("searchResults").replaceChildren();
  $("searchResults").hidden = true;
  $("searchStatus").hidden = true;
}
function review() {
  pause();
  origin = reader.index;
  selected = reader.index;
  viewParagraph = data.tokens[selected].paragraph;
  intentionalNavigation = false;
  clearSearch();
  renderParagraph();
  $("reviewDialog").showModal();
  $("paragraph")
    .querySelector(".selected")
    ?.scrollIntoView({ block: "nearest" });
}
$("review").onclick = review;
$("prevPara").onclick = () => {
  viewParagraph--;
  renderParagraph();
};
$("nextPara").onclick = () => {
  viewParagraph++;
  renderParagraph();
};
$("jumpForm").onsubmit = (e) => {
  e.preventDefault();
  const index = paragraphStart(
    paragraphGroups,
    Number($("jumpParagraph").value),
  );
  if (index === null) return;
  selected = index;
  viewParagraph = data.tokens[index].paragraph;
  intentionalNavigation = true;
  clearSearch();
  renderParagraph();
};
$("returnToPlace").onclick = () => {
  selected = origin;
  viewParagraph = data.tokens[origin].paragraph;
  intentionalNavigation = false;
  clearSearch();
  renderParagraph();
  $("paragraph")
    .querySelector(".selected")
    ?.scrollIntoView({ block: "nearest" });
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
      const label = document.createElement("strong");
      label.textContent = `Paragraph ${result.paragraph + 1}`;
      button.append(label, document.createTextNode(result.excerpt));
      button.onclick = () => {
        selected = result.index;
        viewParagraph = result.paragraph;
        intentionalNavigation = true;
        clearSearch();
        renderParagraph();
        $("paragraph")
          .querySelector(".selected")
          ?.scrollIntoView({ block: "nearest" });
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
const context = document.modelContext;
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
    $("pdfStatus").textContent =
      `Imported ${result.pages} ${result.pages === 1 ? "page" : "pages"}. ${result.blankPages ? `${result.blankPages} ${result.blankPages === 1 ? "page had" : "pages had"} no selectable text and were skipped. ` : ""}Check the text below, then open it in the reader. ${result.pageModels.filter((p) => p.columns === 2).length} pages use two-column reading order. ${repaired} line-break splits repaired. Tables may still need manual review.`;
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
    const readings = (await listReadings()).filter((r) =>
      shelfMatches(r, $("shelfSearch").value, $("shelfView").value),
    );
    if (request !== shelfRequest || !$("libraryDialog").open) return;
    $("restoreConfirm").hidden = !restorePending;
    $("libraryStatus").textContent =
      libraryError ||
      (!readings.length
        ? "Your readings will appear here when you add one."
        : "");
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
        info.textContent = `${record.id === documentId ? "Reading now · " : ""}${record.finished ? "Finished" : `${percent}% read`} · ${record.wordCount.toLocaleString()} words`;
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
            $("play").focus({ preventScroll: true });
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
          ? [["Restore", "active"]]
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
          control.onclick = () => moveReading(record, action[1]);
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
  Object.assign(pdfDraft, composed);
  $("textInput").value = composed.text;
  $("textInput").setCustomValidity("");
  $("pdfRangeStatus").textContent =
    `Pages ${from}–${to} · ${composed.locations.at(-1).end + 1} words · ${composed.removed} repeated header/footer lines removed. Original page view will be available.`;
  updateDraft();
}
$("applyPdfRange").onclick = applyPdfRange;
$("pdfLayout").onchange = () => {
  if (pdfDraft) importPdf(pdfDraft.file);
};

function updateFilterUI() {
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

function updateDraft() {
  const value = $("textInput").value;
  if (!importTypeManual) $("importType").value = inferType(value);
  $("importAcademic").hidden = $("importType").value !== "academic";
  const paragraphs = value.trim() ? parseText(value).paragraphs : [];
  const headings =
    epubDraft && epubDraft.text === value
      ? epubDraft.sections
      : detectSections(value, $("importType").value);
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
    ...(type === "book" ? { skipCitations: false, skipReferences: false } : {}),
    sections:
      type !== readingOptions.documentType
        ? detectSections(text, type)
        : readingOptions.sections,
  });
  $("settingsDialog").close();
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
            "This section is skipped. Turn off the relevant skip option in Reading settings to read it.";
          return;
        }
        replayParagraph = null;
        refreshTiming();
        reader.seek(index);
        $("contentsDialog").close();
        render();
        if (normalMode) renderNormal();
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
    const payload = await encodeBackup(await librarySnapshot());
    const downloadBlob = new Blob([payload], { type: "application/json" });
    if (downloadBlob.size > 250 * 1024 * 1024)
      throw Error("Backup is larger than the 250 MB restore limit.");
    const url = URL.createObjectURL(downloadBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "still-bookshelf-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("backupStatus").textContent = "Backup downloaded.";
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
    $("backupStatus").textContent =
      `Ready to restore ${restorePending.readings.length} readings and ${restorePending.sources.length} PDFs. Existing readings will be kept; matching entries become separate restored copies.`;
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
    $("backupStatus").textContent = `Restored ${count} readings.`;
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
  $("readingMode").textContent = value ? "Word display" : "Normal text";
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
function rewindSentence() {
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
    markDraft = {
      id: crypto.randomUUID(),
      start: selectedTokens[0].sourceIndex,
      end: selectedTokens.at(-1).sourceEnd,
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
    ? `${marks.length} saved passages`
    : "No saved passages yet.";
  $("marksList").replaceChildren(
    ...marks.map((m) => {
      const row = document.createElement("article");
      row.className = "saved-mark";
      const quote = document.createElement("blockquote");
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
        checkpoint();
      };
      const edit = document.createElement("button");
      edit.className = "text-button";
      edit.textContent = "Edit note";
      edit.onclick = () => editMark(m);
      row.append(quote, note, go, edit);
      return row;
    }),
  );
}
$("bookmarks").onclick = () => {
  pause();
  renderMarks();
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
async function moveReading(record, state) {
  try {
    await archiveQueue;
    lastShelfMove = { id: record.id, from: record.shelfState || "active" };
    if (record.id === documentId) {
      shelfState = state;
      save();
      await checkpoint();
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
    : "light";
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const font =
    {
      serif: "'Literata', Georgia, serif",
      sans: "'DM Sans', Arial, sans-serif",
      mono: "ui-monospace, monospace",
    }[appearance.font] || "'Literata', Georgia, serif";
  document.documentElement.style.setProperty("--reading-font", font);
  const size = clamp(Number(appearance.size) || 100, 80, 150);
  document.documentElement.style.setProperty("--reading-scale", size / 100);
  $("appearanceTheme").value = theme;
  $("appearanceFont").value = appearance.font || "serif";
  $("appearanceSize").value = size;
  $("appearanceSizeLabel").textContent = size + "%";
  try {
    localStorage.setItem("still-appearance", JSON.stringify(appearance));
  } catch {}
  fitWord();
}
for (const id of ["appearanceTheme", "appearanceFont", "appearanceSize"])
  $(id).oninput = () => {
    appearance = {
      theme: $("appearanceTheme").value,
      font: $("appearanceFont").value,
      size: Number($("appearanceSize").value),
    };
    applyAppearance();
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
      `Imported ${result.chapters} chapters with ${result.sections.length} table-of-contents entries. Choose a starting point below.`;
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
setupOffline($("prepareOffline"), $("offlineStatus"));
setReadingMode(readingOptions.readingMode === "text", false);
