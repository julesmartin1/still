import test from "node:test";
import assert from "node:assert/strict";
import {
  previousSentence,
  normalizeMarks,
  shelfMatches,
} from "../dist/reading-features.js";
import { parseText } from "../dist/engine.js";
import { bookParts, unzipEpub } from "../dist/epub.js";
test("sentence rewind handles mid-sentence, boundaries, abbreviations and paragraphs", () => {
  const t = parseText(
    "Dr. Rose walked home. A bird sang.\n\nNext paragraph starts here.",
  ).tokens;
  assert.equal(previousSentence(t, 3), 0);
  assert.equal(previousSentence(t, 4), 0);
  assert.equal(previousSentence(t, 6), 4);
  assert.equal(previousSentence(t, 7), 4);
  assert.equal(previousSentence(t, 9), 7);
  assert.equal(previousSentence([], 0), 0);
});
test("saved passages preserve valid original anchors and reject malformed ranges", () => {
  const valid = {
    id: "one",
    start: 3,
    end: 8,
    quote: "hello",
    note: "a note",
    createdAt: 1,
  };
  assert.deepEqual(
    normalizeMarks([valid, { ...valid, start: -1 }, { ...valid, end: 10 }], 10),
    [valid],
  );
});
test("shelf searches respect active, archived and recoverable trash states", () => {
  assert.equal(shelfMatches({ title: "My Book" }, "book", "active"), true);
  assert.equal(
    shelfMatches({ title: "My Book", shelfState: "trash" }, "book", "active"),
    false,
  );
  assert.equal(
    shelfMatches({ title: "My Book", shelfState: "trash" }, " BOOK ", "trash"),
    true,
  );
});
test("invalid EPUB archives fail before extraction", async () => {
  await assert.rejects(unzipEpub(new ArrayBuffer(12)), /not a readable EPUB/);
});
test("EPUB deflate extraction retains the spine and complete chapter text", async () => {
  const { readFile } = await import("node:fs/promises");
  const b = await readFile(new URL("./fixtures/ordered.epub", import.meta.url));
  const zip = await unzipEpub(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
  assert.match(
    await zip.read("OEBPS/book.opf"),
    /<itemref idref="z"\/><itemref idref="a"\/>/,
  );
  assert.match(await zip.read("OEBPS/z.xhtml"), /First chapter/);
  await assert.rejects(zip.read("missing"), /chapter is missing/);
});

test("a book longer than one reading is split into parts at chapters", () => {
  const paragraphs = [],
    sections = [];
  for (let c = 0; c < 6; c++) {
    sections.push({
      title: "Chapter " + (c + 1),
      paragraph: paragraphs.length + 1,
    });
    for (let p = 0; p < 4; p++)
      paragraphs.push(`c${c}p${p} ` + "word ".repeat(50));
  }
  paragraphs.push("A very long sentence. ".repeat(200));
  const book = { title: "Book", text: paragraphs.join("\n\n"), sections };
  assert.deepEqual(bookParts(book, book.text.length), [book]);
  const parts = bookParts(book, 2400);
  for (const part of parts) assert.ok(part.text.length <= 2400 * 0.95);
  // Two chapters (about 2,000 characters) fit in each of the first parts,
  // and each part starts on a chapter. The one paragraph too long for a
  // reading is cut at a sentence.
  assert.deepEqual(
    parts.map((p) => p.sections.map((s) => [s.title, s.paragraph])),
    [
      [
        ["Chapter 1", 1],
        ["Chapter 2", 5],
      ],
      [
        ["Chapter 3", 1],
        ["Chapter 4", 5],
      ],
      [
        ["Chapter 5", 1],
        ["Chapter 6", 5],
      ],
      [],
      [],
    ],
  );
  for (const part of parts.slice(3))
    assert.match(part.text, /^A very.*sentence\.$/s);
  const words = (t) => t.split(/\s+/).filter(Boolean);
  assert.deepEqual(words(parts.map((p) => p.text).join(" ")), words(book.text));
  assert.equal(book.sections[1].paragraph, 5);
});
