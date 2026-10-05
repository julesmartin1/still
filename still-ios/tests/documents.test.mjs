import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inferType,
  suggestTitle,
  detectSections,
  paragraphAnchor,
  fileFingerprint,
} from "../dist/document.js";
import { encodeBackup, decodeBackup } from "../dist/backup.js";
test("chapters are found in real book layouts, not in contents pages", () => {
  const text = [
    "Contents",
    "Chapter 1....................5",
    "Chapter 2....................9",
    "CHAPTER 1. Loomings.",
    "CHAPTER 2. The Carpet-Bag.",
    "CHAPTER 3. The Spouter-Inn.",
    "Chapter 1 It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.",
    "part of his aunt, her resentment gave way.",
    "Chapter 2 Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go.",
    "BOOK I. (Folio), CHAPTER I. (Sperm Whale).—This whale, among the English of old vaguely known as the Trumpa whale, and the Physeter whale, and the Anvil Headed whale.",
    "CHAPTER XI. Who Stole the Tarts?",
    "The King and Queen of Hearts were seated on their throne.",
  ].join("\n\n");
  assert.deepEqual(
    detectSections(text, "book").map((s) => [s.title, s.paragraph]),
    [
      ["Chapter 1", 7],
      ["Chapter 2", 9],
      ["CHAPTER XI. Who Stole the Tarts?", 11],
    ],
  );
});
test("document type suggestions and section anchors distinguish papers from books", () => {
  const paper =
    "Abstract\n\nStudy overview.\n\n1. Introduction\n\nSome prose.\n\nReferences\n\nSmith (2020).";
  assert.equal(inferType(paper), "academic");
  assert.deepEqual(
    detectSections(paper, "academic").map((s) => s.title),
    ["Abstract", "1. Introduction", "References"],
  );
  const book =
    "Title\n\nChapter One\n\nOnce upon a time.\n\nChapter Two\n\nLater that evening.";
  assert.equal(inferType(book), "book");
  assert.deepEqual(
    detectSections(book, "book").map((s) => s.paragraph),
    [2, 4],
  );
  assert.equal(paragraphAnchor(book, 4), 7);
  assert.equal(inferType("An ordinary note."), "other");
});
test("title prefers useful metadata and otherwise large first-page text over a filename", () => {
  assert.equal(
    suggestTitle({ metadata: "A clear title", filename: "123.pdf" }),
    "A clear title",
  );
  assert.equal(
    suggestTitle({
      metadata: "Microsoft Word - document",
      pages: [
        {
          height: 800,
          lines: [
            { text: "Journal of test reports", height: 9, y: 760 },
            { text: "A meaningful research title", height: 18, y: 600 },
            { text: "continued on this line", height: 18, y: 580 },
          ],
        },
      ],
      filename: "1-s2.0-foo.pdf",
    }),
    "A meaningful research title continued on this line",
  );
});
test("fingerprints identify identical bytes regardless of filename", async () => {
  const a = new Blob(["%PDF-one"]),
    b = new Blob(["%PDF-one"]),
    c = new Blob(["%PDF-two"]);
  assert.equal(await fileFingerprint(a), await fileFingerprint(b));
  assert.notEqual(await fileFingerprint(a), await fileFingerprint(c));
});
test("backup round trip retains PDF, original mapping, pace, preferences, headings and position", async () => {
  const reading = {
    id: "one",
    title: "A book",
    text: "Chapter One\n\nHello world.",
    index: 2,
    sourceIndex: 2,
    wordCount: 4,
    base: 341,
    profile: { slowdown: 0.1, lookups: { hello: 123 }, rewinds: [] },
    readingOptions: {
      documentType: "book",
      skipCitations: false,
      sections: [{ title: "Chapter One", paragraph: 1 }],
    },
    finished: false,
  };
  const source = {
    id: "one",
    blob: new Blob(["%PDF-1.7 fixture"]),
    fingerprint: "abc",
    locations: [
      {
        page: 1,
        start: 0,
        end: 3,
        rect: [10, 20, 100, 30],
        text: "Chapter One Hello world.",
      },
    ],
  };
  const encoded = await encodeBackup({
      readings: [reading],
      sources: [source],
    }),
    decoded = decodeBackup(encoded);
  assert.equal(decoded.readings[0].base, 341);
  assert.equal(decoded.readings[0].sourceIndex, 2);
  assert.equal(decoded.readings[0].readingOptions.documentType, "book");
  assert.deepEqual(
    decoded.readings[0].readingOptions.sections,
    reading.readingOptions.sections,
  );
  assert.equal(await decoded.sources[0].blob.text(), "%PDF-1.7 fixture");
  assert.deepEqual(decoded.sources[0].locations, source.locations);
});
test("invalid backup or source positions fail before any restore is attempted", () => {
  for (const input of [
    "not json",
    "{}",
    JSON.stringify({
      format: "still-bookshelf",
      version: 9,
      readings: [],
      sources: [],
    }),
    JSON.stringify({
      format: "still-bookshelf",
      version: 1,
      readings: [{ id: "a", title: "Bad", text: "", index: 0 }],
      sources: [],
    }),
  ])
    assert.throws(() => decodeBackup(input), /valid Still/);
});
