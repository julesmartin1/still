import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER, STARTER_PACE } from "../dist/starter-shelf.js";
import { parseText } from "../dist/engine.js";

const KINDS = new Set(["Story", "Fable", "Speech", "Essay", "Poem"]);

test("the shelf has 10-15 pieces with unique kebab-case ids", () => {
  assert.equal(STARTER_PACE, 180);
  assert.ok(STARTER.length >= 10 && STARTER.length <= 15, `${STARTER.length}`);
  const ids = STARTER.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("every piece has every field with the right type", () => {
  for (const p of STARTER) {
    for (const key of ["id", "title", "author", "kind", "blurb", "text"]) {
      assert.equal(typeof p[key], "string", `${p.id}.${key}`);
      assert.ok(p[key].trim(), `${p.id}.${key} is empty`);
    }
    for (const key of ["words", "minutes"])
      assert.ok(Number.isInteger(p[key]) && p[key] > 0, `${p.id}.${key}`);
    assert.ok(KINDS.has(p.kind), `${p.id} kind ${p.kind}`);
    assert.ok(p.blurb.length <= 90, `${p.id} blurb is ${p.blurb.length} chars`);
    assert.deepEqual(Object.keys(p).sort(), [
      "author",
      "blurb",
      "id",
      "kind",
      "minutes",
      "text",
      "title",
      "words",
    ]);
  }
});

test("word counts and reading times match the app's tokenizer", () => {
  for (const p of STARTER) {
    assert.equal(p.words, parseText(p.text).tokens.length, p.id);
    assert.equal(
      p.minutes,
      Math.max(1, Math.round(p.words / STARTER_PACE)),
      p.id,
    );
  }
});

test("texts are plain: no markup, notes or carriage returns", () => {
  for (const p of STARTER) {
    for (const ch of ["<", ">", "_", "*", "[", "]", "\r"])
      assert.ok(!p.text.includes(ch), `${p.id} contains ${JSON.stringify(ch)}`);
    assert.equal(p.text, p.text.trim(), `${p.id} has outer whitespace`);
    assert.ok(!/\n{3,}/.test(p.text), `${p.id} has extra blank lines`);
    // Only poems keep line breaks inside a paragraph.
    if (p.kind !== "Poem")
      for (const para of p.text.split("\n\n"))
        assert.ok(!para.includes("\n"), `${p.id} has a wrapped paragraph`);
  }
});

test("no paragraph is too long to read comfortably", () => {
  for (const p of STARTER) {
    for (const para of parseText(p.text).paragraphs) {
      const words = para.split(/\s+/).length;
      assert.ok(words <= 350, `${p.id} has a ${words}-word paragraph`);
    }
  }
});

test("the shelf is ordered shortest first and stays small", () => {
  for (let i = 1; i < STARTER.length; i++)
    assert.ok(STARTER[i - 1].words <= STARTER[i].words, STARTER[i].id);
  const bytes = STARTER.reduce(
    (sum, p) => sum + Buffer.byteLength(p.text, "utf8"),
    0,
  );
  assert.ok(bytes < 150 * 1024, `${bytes} bytes`);
});
