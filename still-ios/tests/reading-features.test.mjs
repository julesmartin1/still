import test from "node:test";
import assert from "node:assert/strict";
import {
  previousSentence,
  normalizeMarks,
  shelfMatches,
} from "../dist/reading-features.js";
import { parseText } from "../dist/engine.js";
import { unzipEpub } from "../dist/epub.js";
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
