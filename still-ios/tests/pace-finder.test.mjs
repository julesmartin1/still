import { test } from "node:test";
import assert from "node:assert/strict";
import { PASSAGES, START, nextPace, suggestedPace } from "../dist/pace-finder.js";
import { countWords } from "../dist/engine.js";

const run = (feelAt) => {
  const history = [];
  for (let i = 0; i < 3; i++) {
    const wpm = nextPace(history);
    history.push({ wpm, feel: feelAt(wpm) });
  }
  return { history, pace: suggestedPace(history) };
};

test("passages are short and similar in length", () => {
  for (const p of PASSAGES) {
    const n = countWords(p);
    assert.ok(n >= 45 && n <= 60, n);
  }
});

test("a reader comfortable up to 330 ends near 330", () => {
  const { history, pace } = run((w) => (w <= 330 ? "comfortable" : w <= 380 ? "fast" : "too-fast"));
  assert.deepEqual(history.map((h) => h.wpm), [250, 310, 370]);
  assert.equal(pace, 310);
});

test("a reader who finds the start too fast is offered something slower", () => {
  const { history, pace } = run((w) => (w <= 180 ? "comfortable" : w <= 210 ? "fast" : "too-fast"));
  assert.equal(history[0].wpm, START);
  assert.ok(history.every((h, i) => i === 0 || h.wpm < history[i - 1].wpm || h.feel), history);
  assert.ok(pace <= 190 && pace >= 120, pace);
});

test("never goes back above a pace that felt fast, and never repeats", () => {
  const history = [
    { wpm: 250, feel: "fast" },
    { wpm: 220, feel: "comfortable" },
  ];
  const next = nextPace(history);
  assert.ok(next < 250 && next !== 220, next);
  assert.equal(suggestedPace([...history, { wpm: next, feel: "comfortable" }]), Math.max(220, next));
});

test("everything comfortable keeps climbing; nothing comfortable eases off", () => {
  assert.equal(run(() => "comfortable").pace, 370);
  assert.equal(suggestedPace([{ wpm: 250, feel: "too-fast" }, { wpm: 190, feel: "too-fast" }, { wpm: 130, feel: "fast" }]), 120);
});
