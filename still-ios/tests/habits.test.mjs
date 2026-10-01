import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHabits,
  recordReading,
  today,
  streak,
  week,
  dayKey,
  formatDuration,
  formatElapsed,
  DEFAULT_GOAL,
} from "../dist/habits.js";
import { warmUpFactor, planSums, parseText } from "../dist/engine.js";
import { nextSentence } from "../dist/reading-features.js";

const MIN = 60000;
// Noon on a given local day, `n` days before 2026-10-01.
const day = (n) => new Date(2026, 9, 1 - n, 12).getTime();

test("habits start empty with a small default goal and reject bad data", () => {
  assert.deepEqual(normalizeHabits(null), { goal: DEFAULT_GOAL, days: {} });
  const h = normalizeHabits({
    goal: 7, // not an offered goal
    days: { "2026-10-01": { ms: -5, words: "12" }, nonsense: { ms: 1 } },
  });
  assert.equal(h.goal, DEFAULT_GOAL);
  assert.deepEqual(h.days, { "2026-10-01": { ms: 0, words: 12 } });
});

test("reading adds up through the day and marks the goal once reached", () => {
  let h = normalizeHabits({ goal: 5 });
  h = recordReading(h, { ms: 3 * MIN, words: 700, now: day(0) });
  assert.equal(today(h, { now: day(0) }).met, false);
  assert.equal(today(h, { now: day(0), extraMs: 2 * MIN }).met, true);
  h = recordReading(h, { ms: 2 * MIN, words: 500, now: day(0) });
  const t = today(h, { now: day(0) });
  assert.equal(t.met, true);
  assert.equal(t.words, 1200);
  assert.equal(t.fraction, 1);
  // Raising the goal later doesn't undo a day already met.
  h = normalizeHabits({ ...h, goal: 20 });
  assert.equal(today(h, { now: day(0) }).met, true);
});

test("a stretch longer than half an hour (a sleeping tab) is capped", () => {
  const h = recordReading(normalizeHabits(null), {
    ms: 5 * 60 * MIN,
    now: day(0),
  });
  assert.equal(h.days[dayKey(day(0))].ms, 30 * MIN);
});

test("streaks count consecutive days and survive until today ends", () => {
  let h = normalizeHabits({ goal: 5 });
  for (const n of [1, 2, 3, 5])
    h = recordReading(h, { ms: 6 * MIN, now: day(n) });
  // Not read yet today: yesterday's streak of 3 is still alive.
  assert.deepEqual(streak(h, { now: day(0) }), {
    count: 3,
    metToday: false,
    alive: true,
  });
  h = recordReading(h, { ms: 5 * MIN, now: day(0) });
  assert.equal(streak(h, { now: day(0) }).count, 4);
  // A missed day ends it.
  assert.equal(streak(h, { now: day(-2) }).count, 0);
});

test("the week strip lists the last seven days, oldest first", () => {
  let h = normalizeHabits({ goal: 5 });
  h = recordReading(h, { ms: 6 * MIN, now: day(6) });
  h = recordReading(h, { ms: 1 * MIN, now: day(1) });
  const days = week(h, { now: day(0), extraMs: 5 * MIN, locale: "en" });
  assert.equal(days.length, 7);
  assert.equal(days[0].key, dayKey(day(6)));
  assert.equal(days[0].met, true);
  assert.equal(days[5].met, false);
  assert.equal(days[5].ms, MIN);
  assert.equal(days[6].today, true);
  assert.equal(days[6].met, true, "reading in progress counts today");
});

test("durations read naturally", () => {
  assert.equal(formatDuration(20000), "under a minute");
  assert.equal(formatDuration(4 * MIN), "4 min");
  assert.equal(formatDuration(80 * MIN), "1 h 20 min");
  assert.equal(formatDuration(120 * MIN), "2 h");
  assert.equal(formatElapsed(45000), "45 s");
  assert.equal(formatElapsed(190000), "3 min 10 s");
});

test("words ease in after pressing play, then keep the planned pace", () => {
  assert.ok(warmUpFactor(0) > warmUpFactor(1));
  assert.ok(warmUpFactor(3) > 1);
  assert.equal(warmUpFactor(4), 1);
  assert.equal(warmUpFactor(-1), 1);
});

test("plan sums give the time left from any word", () => {
  const sums = planSums([100, 200, 300]);
  assert.deepEqual([...sums], [0, 100, 300, 600]);
  assert.equal(sums[3] - sums[1], 500);
});

test("skipping forward lands on the next sentence or paragraph", () => {
  const t = parseText("Dr. Rose walked home. A bird sang.\n\nNext one.").tokens;
  assert.equal(nextSentence(t, 0), 4, "Dr. is not a sentence end");
  assert.equal(nextSentence(t, 4), 7);
  assert.equal(nextSentence(t, 5), 7);
  assert.equal(nextSentence(t, 8), 8, "stays on the last word");
  assert.equal(nextSentence([], 0), 0);
});
