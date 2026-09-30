import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceWords, countWords, parseText } from "../dist/engine.js";
import { filteredReading } from "../dist/citations.js";
import { previousSentence } from "../dist/reading-features.js";

const texts = (s) => sourceWords(s).map((w) => w.text);

test("space-separated text still splits exactly on whitespace", () => {
  assert.deepEqual(texts("One two,  three.\nFour — five…"), [
    "One",
    "two,",
    "three.",
    "Four",
    "—",
    "five…",
  ]);
});

test("Chinese is split into words, with punctuation kept on the word", () => {
  const words = texts("在一个安静的早晨，阳光慢慢地移过地板。");
  assert.ok(words.length >= 6, `expected several words, got ${words}`);
  assert.equal(words.join(""), "在一个安静的早晨，阳光慢慢地移过地板。");
  assert.ok(words.every((w) => !/^[，。]/.test(w)));
  assert.match(words.at(-1), /。$/);
});

test("Japanese keeps particles with their word and quotes with their text", () => {
  const words = texts("「こんにちは」と彼女は言った。");
  assert.equal(words.join(""), "「こんにちは」と彼女は言った。");
  assert.ok(words[0].startsWith("「こんにちは」"));
  assert.ok(words.includes("彼女は"));
  assert.ok(!words.some((w) => /^[ったはと]$/.test(w)));
});

test("Thai is split into words", () => {
  const words = texts("ภาษาไทยไม่มีช่องว่างระหว่างคำ");
  assert.ok(words.length >= 4);
  assert.equal(words.join(""), "ภาษาไทยไม่มีช่องว่างระหว่างคำ");
});

test("word offsets point at the original characters", () => {
  const text = "Hello 世界你好。 again";
  for (const w of sourceWords(text))
    assert.equal(text.slice(w.index, w.index + w.text.length), w.text);
});

test("CJK sentence ends pace and rewind like English full stops", () => {
  const { tokens } = parseText("第一句话。第二句话。");
  assert.ok(tokens.length >= 2);
  const second = tokens.findIndex(
    (t, i) => i > 0 && tokens[i - 1].text.endsWith("。"),
  );
  assert.ok(second > 0);
  assert.equal(previousSentence(tokens, second + 1), second);
});

test("filtered readings stay aligned with source words for CJK text", () => {
  const text =
    "研究表明（Smith, 2020）阅读速度很重要。\n\nEnglish (Jones, 2019) text.";
  const data = filteredReading(text, { skipCitations: true });
  const words = sourceWords(text);
  for (const t of data.tokens) {
    const source = words[t.sourceIndex].text;
    assert.ok(
      source.includes(t.text.replace(/[.,]$/, "")) || t.text.includes(source),
      `${t.text} vs ${source}`,
    );
  }
  assert.equal(countWords(text), words.length);
  assert.ok(!data.tokens.some((t) => /Jones/.test(t.text)));
});
