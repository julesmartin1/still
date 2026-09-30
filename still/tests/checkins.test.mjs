import { test } from "node:test";
import assert from "node:assert/strict";
import { parseText, buildTimingPlan, Playback } from "../dist/engine.js";
import {
  checkInDue,
  endCheckInDue,
  followUp,
  summarizeCheckins,
  normalizeCheckins,
  MIN_SEGMENT_WORDS,
} from "../dist/checkins.js";

const paragraphs = (n, words) =>
  Array.from(
    { length: n },
    (_, p) =>
      Array.from({ length: words }, (_, w) => `p${p}w${w}`).join(" ") + ".",
  ).join("\n\n");

test("check-ins only happen at paragraph ends after enough reading", () => {
  const { tokens } = parseText(paragraphs(10, 100));
  const due = (index, wordsRead, extra = {}) =>
    checkInDue({ tokens, index, wordsRead, base: 100, ...extra });
  // interval at 100 WPM = 300 words
  assert.equal(due(99, 100), false, "too early");
  assert.equal(due(298, 400), false, "not a paragraph end");
  assert.equal(due(299, 300), true);
  assert.equal(due(299, 300, { mode: "off" }), false);
  assert.equal(
    due(999, 1000),
    false,
    "the last word is handled by the end check-in",
  );
});

test("section boundaries are preferred once half the interval has passed", () => {
  const { tokens } = parseText(paragraphs(10, 100));
  const sectionStarts = new Set([3]); // paragraph 3 (1-based) starts a section
  assert.equal(
    checkInDue({
      tokens,
      index: 199,
      wordsRead: 160,
      base: 100,
      sectionStarts,
    }),
    true,
  );
  assert.equal(
    checkInDue({
      tokens,
      index: 199,
      wordsRead: 140,
      base: 100,
      sectionStarts,
    }),
    false,
  );
  assert.equal(
    checkInDue({
      tokens,
      index: 199,
      wordsRead: MIN_SEGMENT_WORDS,
      mode: "sections",
      sectionStarts,
    }),
    true,
  );
  assert.equal(
    checkInDue({
      tokens,
      index: 99,
      wordsRead: 100,
      mode: "sections",
      sectionStarts,
    }),
    false,
  );
});

test("end-of-reading check-in needs a real stretch of reading", () => {
  assert.equal(endCheckInDue(50), false);
  assert.equal(endCheckInDue(120), true);
  assert.equal(endCheckInDue(120, "off"), false);
});

test("follow-ups: replay after lost, faster after three clear", () => {
  const c = (rating) => ({ rating });
  assert.equal(followUp([c("clear"), c("lost")]), "replay");
  assert.equal(followUp([c("clear"), c("clear")]), null);
  assert.equal(
    followUp([c("mostly"), c("clear"), c("clear"), c("clear")]),
    "faster",
  );
  assert.equal(followUp([c("clear"), c("mostly"), c("clear")]), null);
  assert.deepEqual(summarizeCheckins([c("clear"), c("lost"), c("clear")]), {
    clear: 2,
    mostly: 0,
    lost: 1,
    total: 3,
  });
});

test("stored check-ins are validated and bounded", () => {
  const good = {
    id: "a",
    start: 0,
    end: 5,
    rating: "clear",
    recap: "x".repeat(2000),
  };
  const out = normalizeCheckins(
    [
      good,
      { ...good, id: "b", rating: "quiz-score" },
      { ...good, id: "c", end: 99 },
      null,
    ],
    10,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].recap.length, 1000);
});

test("playback stops after a word when breakAfter says so", () => {
  let cb = null;
  const breaks = [];
  const r = new Playback({
    length: 5,
    duration: () => 10,
    onWord: () => {},
    onEnd: () => {},
    breakAfter: (i) => i === 2,
    onBreak: (i) => breaks.push(i),
    schedule: (fn) => ((cb = fn), 1),
    cancel: () => (cb = null),
  });
  r.play();
  for (let i = 0; i < 4; i++) cb?.();
  assert.deepEqual(breaks, [2]);
  assert.equal(r.index, 2);
  assert.equal(r.playing, false);
});

test("a replayed stretch of several paragraphs is paced slower", () => {
  const { tokens } = parseText(paragraphs(3, 20));
  const normal = buildTimingPlan(tokens, { base: 300 });
  const replay = buildTimingPlan(tokens, {
    base: 300,
    replayParagraphs: new Set([0, 1]),
  });
  const sum = (a, from, to) => a.slice(from, to).reduce((x, y) => x + y, 0);
  assert.ok(sum(replay, 0, 40) > sum(normal, 0, 40) * 1.1);
  assert.equal(
    Math.round(sum(replay, 40, 60)),
    Math.round(sum(normal, 40, 60)),
  );
});
