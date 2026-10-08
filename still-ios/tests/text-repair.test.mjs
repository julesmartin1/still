import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGlyphs,
  learnGlyphMap,
  repairText,
  repairPdfLines,
  stripNoteMarkers,
  tidyPunctuation,
} from "../dist/text-repair.js";

// A tiny dictionary standing in for WordNet.
const WORDS = new Set(
  "first find field figure office officer affairs offer differ effect flowers floor flood fly afflicted ruffle".split(
    " ",
  ),
);
const lookup = async (w) => (WORDS.has(w.toLowerCase()) ? { word: w } : null);

test("mislabelled ligatures are learned from the dictionary, per character", async () => {
  // As in a real Penguin PDF: fi -> ɹ, ff -> ʃ, fl -> ɻ, ffi -> ɽ, ffl -> ʀ.
  const text =
    "The ɹrst ɹeld; I ɹnd the ɹgure. His aʃairs oʃer an eʃect. ɻowers on the ɻoor, a ɻood. The oɽce oɽcer. Aʀicted, I ruʀe.";
  const { text: fixed, map } = await repairText(text, lookup);
  assert.deepEqual(Object.fromEntries(map), {
    ɹ: "fi",
    ʃ: "ff",
    ɻ: "fl",
    ɽ: "ffi",
    ʀ: "ffl",
  });
  assert.equal(
    fixed,
    "The first field; I find the figure. His affairs offer an effect. flowers on the floor, a flood. The office officer. Afflicted, I ruffle.",
  );
});

test("real phonetic text is left alone", async () => {
  const ipa = "/ðə ɹɛd kæt/ and /ʃɪp/ and /ʃuː/ and /ɹʌn/ and /ɹɪŋ/";
  const map = await learnGlyphMap([ipa], lookup);
  assert.equal(map.size, 0);
});

test("without a dictionary nothing changes", async () => {
  const failing = async () => {
    throw Error("offline");
  };
  const { text } = await repairText("ɹrst ɹnd ɹeld", failing);
  assert.equal(text, "ɹrst ɹnd ɹeld");
});

test("control-character hyphens and real ligature characters", () => {
  assert.equal(
    normalizeGlyphs("Frankfurt-am\u0002Main, cold\u0002shouldered, ﬁrst ﬂow"),
    "Frankfurt-am-Main, cold-shouldered, first flow",
  );
});

test("note numbers are removed only when they count up", () => {
  const { texts, removed } = stripNoteMarkers([
    "in a garden3 by the spring,4 near Melusine5 and the river.∗6 Then ‘Albert7 came.",
  ]);
  assert.equal(removed, 5);
  assert.equal(
    texts[0],
    "in a garden by the spring, near Melusine and the river. Then ‘Albert came.",
  );
  const keep =
    "Vitamin B12 and the A4 page, COVID19, M4V 3B2, in the 1880s, at 3:15.";
  assert.equal(stripNoteMarkers([keep]).texts[0], keep);
});

test("names and numbers in books are not mistaken for notes", () => {
  // From Pro Git and Project Gutenberg's licence: the old rule read each
  // "1" as a note numbering restart and deleted them all.
  const keep = [
    "Git uses a SHA-1 hash. A SHA-1 hash looks like this, and SHA-1 again.",
    "licensed under by-nc-sa/3.0 terms, see paragraph 1.E.1 and 1.E.2,",
    "then 1.E.3, with v1 := ld state[764] and v2 := i2f(v1) in WSL1 or WSL2,",
    "installing libcurl4-gnutls-dev and v1.8.5-rc2 from git.team1.example.",
  ];
  assert.deepEqual(stripNoteMarkers(keep).texts, keep);
  // Notes numbered per chapter still go: a restart counts once it reaches 2.
  const { texts, removed } = stripNoteMarkers([
    "a garden1 by the spring.2 Then",
    "the hill1 and the river,2 near the sea.3",
  ]);
  assert.equal(removed, 5);
  assert.deepEqual(texts, [
    "a garden by the spring. Then",
    "the hill and the river, near the sea.",
  ]);
});

test("PDF lines are repaired in place", async () => {
  const pages = [
    { lines: [{ text: "the ɹrst ɹeld1" }, { text: "an oʃer2 to diʃer" }] },
    { lines: [{ text: "his aʃairs3 and ɹgure" }] },
  ];
  const { map, notes } = await repairPdfLines(pages, lookup);
  assert.equal(map.get("ɹ"), "fi");
  assert.equal(notes, 3);
  assert.deepEqual(
    pages.flatMap((p) => p.lines.map((l) => l.text)),
    ["the first field", "an offer to differ", "his affairs and figure"],
  );
});

test("dashes no longer glue words together, and punctuation never stands alone", () => {
  for (const [before, after] of [
    ["That government--what is it?", "That government— what is it?"],
    ["a belt\u2060—one of them", "a belt— one of them"],
    ["a word — another", "a word— another"],
    ["I will not tolerate , he said", "I will not tolerate, he said"],
    ["and so . . . on", "and so… on"],
    ["« Bonjour » dit-il ( oui ) !", "«Bonjour» dit-il (oui)!"],
    ["the end.1 ↩", "the end.1"],
    // Left alone: number ranges, hyphenated words, Spanish dialogue dashes.
    ["the years 1914—1918", "the years 1914—1918"],
    ["self-reliance, to-day", "self-reliance, to-day"],
    ["—Bueno —dijo Juan—, vamos.", "—Bueno —dijo Juan—, vamos."],
  ])
    assert.equal(tidyPunctuation(before), after);
});
