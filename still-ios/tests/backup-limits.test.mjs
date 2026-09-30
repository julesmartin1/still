import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeBackup,
  decodeBackup,
  MAX_READING_CHARACTERS,
} from "../dist/backup.js";

const reading = (id, text, title = id) => ({ id, title, text, index: 0 });

test("an oversized reading is skipped instead of rejecting the whole backup", async () => {
  const long = "word ".repeat(MAX_READING_CHARACTERS / 5 + 10);
  const json = await encodeBackup({
    readings: [
      reading("a", "A short essay."),
      reading("b", long, "Pasted novel"),
    ],
    sources: [],
  });
  const result = decodeBackup(json);
  assert.deepEqual(
    result.readings.map((r) => r.id),
    ["a"],
  );
  assert.deepEqual(result.skipped, ["Pasted novel"]);
});

test("a PDF attached to a skipped reading is skipped with it", async () => {
  const long = "x".repeat(MAX_READING_CHARACTERS + 1);
  const data = {
    format: "still-bookshelf",
    version: 1,
    readings: [reading("a", "Short."), reading("b", long)],
    sources: [{ id: "b", pdf: btoa("%PDF-1.7 fixture"), locations: [] }],
  };
  const result = decodeBackup(JSON.stringify(data));
  assert.equal(result.readings.length, 1);
  assert.equal(result.sources.length, 0);
});

test("a normal backup restores fully and reports nothing skipped", async () => {
  const json = await encodeBackup({
    readings: [reading("a", "One."), reading("b", "Two.")],
    sources: [],
  });
  const result = decodeBackup(json);
  assert.equal(result.readings.length, 2);
  assert.deepEqual(result.skipped, []);
});

test("structurally invalid backups are still rejected outright", () => {
  assert.throws(() => decodeBackup("{}"), /Nothing was imported/);
  assert.throws(
    () =>
      decodeBackup(
        JSON.stringify({
          format: "still-bookshelf",
          version: 1,
          readings: [{ id: 1, title: "x", text: "y", index: 0 }],
          sources: [],
        }),
      ),
    /Nothing was imported/,
  );
});
