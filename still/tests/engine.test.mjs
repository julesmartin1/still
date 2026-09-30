import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseText,
  wordWeight,
  buildTimingPlan,
  targetWpm,
  minimumWordTime,
  allocateWordTimes,
  freshProfile,
  recordRewind,
  recordLookup,
  Playback,
} from "../dist/engine.js";
test("text order, punctuation and paragraph mapping are preserved", () => {
  const { tokens } = parseText("One two.\n\nThree four!");
  assert.deepEqual(
    tokens.map((t) => t.text),
    ["One", "two.", "Three", "four!"],
  );
  assert.deepEqual(
    tokens.map((t) => t.paragraph),
    [0, 0, 1, 1],
  );
  assert.equal(tokens[1].paragraphEnd, true);
});
test("rewinds need distinct paragraphs; gradual adjustment is capped", () => {
  let p = freshProfile();
  for (let i = 0; i < 10; i++) p = recordRewind(p, 0, 1000 + i);
  assert.equal(p.slowdown, 0);
  for (let i = 1; i < 20; i++) p = recordRewind(p, i, 2000 + i);
  assert.equal(p.slowdown, 0.2);
  assert.equal(recordRewind(freshProfile(), 1, 1000).slowdown, 0);
});
function harness() {
  let cb = null,
    id = 0;
  const words = [];
  let ended = 0;
  const r = new Playback({
    length: 4,
    duration: () => 100,
    onWord: (i) => words.push(i),
    onEnd: () => ended++,
    schedule: (fn) => {
      cb = fn;
      return ++id;
    },
    cancel: () => {
      cb = null;
    },
  });
  return {
    r,
    words,
    tick: () => {
      const next = cb;
      cb = null;
      next?.();
    },
    ended: () => ended,
    pending: () => cb,
  };
}
test("pause/resume preserves current word and no duplicate timer advances", () => {
  const h = harness();
  h.r.play();
  h.r.play();
  h.tick();
  h.r.pause();
  h.tick();
  assert.equal(h.r.index, 1);
  h.r.play();
  h.tick();
  assert.equal(h.r.index, 2);
  assert.deepEqual(h.words, [0, 1, 1, 2]);
});
test("seek resumes at exact selection; end stops and replay restarts", () => {
  const h = harness();
  h.r.play();
  h.tick();
  h.r.seek(2);
  assert.equal(h.r.playing, false);
  h.r.play();
  assert.equal(h.words.at(-1), 2);
  h.tick();
  h.tick();
  assert.equal(h.ended(), 1);
  assert.equal(h.r.playing, false);
  h.r.play();
  assert.equal(h.r.index, 0);
});
test("retiming and pauses do not modify position", () => {
  const h = harness();
  h.r.play();
  h.r.retime();
  assert.equal(h.r.index, 0);
  h.tick();
  assert.equal(h.r.index, 1);
  h.r.pause();
  assert.equal(h.pending(), null);
});
import { candidateForms } from "../dist/dictionary.js";
import { readFile } from "node:fs/promises";
test("dictionary supports common inflections and includes real definitions", async () => {
  assert.ok(candidateForms("Running").includes("run"));
  assert.ok(candidateForms("stories").includes("story"));
  assert.ok(candidateForms("noticed").includes("notice"));
  const d = JSON.parse(
    await readFile(new URL("../dist/dictionary/e.json", import.meta.url)),
  );
  assert.ok(d.ephemeral.some((m) => m.definition.includes("short")));
  assert.equal(d.zqxwvvzz, undefined);
});

const sum = (values) => values.reduce((a, b) => a + b, 0);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.000001, `${a} != ${b}`);
test("length weights keep short words neutral and gently extend long words", () => {
  const bare = (word) => ({
    norm: word,
    text: word,
    complexity: 0,
    rare: false,
    paragraphEnd: false,
  });
  near(wordWeight(bare("a")), 1);
  near(wordWeight(bare("daily")), 1);
  near(wordWeight(bare("extraordinary")), 1.32);
  near(wordWeight(bare("a".repeat(40))), 1.5);
  near(wordWeight(bare("can't")), 1);
  const tokens = ["We", "notice", "extraordinary", "things", "daily"].map(
    (w, index) => ({ ...bare(w), paragraph: 0, index }),
  );
  const plan = buildTimingPlan(tokens, { base: 300 });
  near(sum(plan), 1000);
  near(plan[2], (1000 * 1.32) / 5.4);
  assert.ok(plan[2] > plan[1] && plan[1] > plan[0]);
});
test("each paragraph meets its WPM budget including punctuation and difficulty", () => {
  const { tokens } = parseText(
    "We notice extraordinary things daily.\n\nYes, the constructor pauses; this is a longer sentence with unfamiliar terminology and more words to give the pacing algorithm enough material to consider.",
  );
  for (const base of [80, 260, 300, 600]) {
    const plan = buildTimingPlan(tokens, { base });
    for (const p of [0, 1]) {
      const indices = tokens
        .map((t, i) => (t.paragraph === p ? i : -1))
        .filter((i) => i >= 0);
      near(sum(indices.map((i) => plan[i])), (indices.length * 60000) / base);
    }
    assert.ok(plan.every((n) => Number.isFinite(n) && n > 0));
  }
});
test("punctuation and lookups redistribute rather than inflate the budget", () => {
  const tokens = parseText("notice notice notice").tokens;
  const plain = buildTimingPlan(tokens, { base: 300 });
  const punctuated = tokens.map((t, i) =>
    i === 0 ? { ...t, text: "notice," } : t,
  );
  const changed = buildTimingPlan(punctuated, { base: 300 });
  assert.ok(changed[0] > plain[0]);
  near(sum(changed), sum(plain));
  const text = parseText("ephemeral quiet morning").tokens;
  const profile = recordLookup(freshProfile(), "ephemeral"),
    now = profile.lookups.ephemeral;
  const normal = buildTimingPlan(text, { base: 300 }),
    learned = buildTimingPlan(text, { base: 300, profile, now });
  assert.ok(learned[0] > normal[0]);
  near(sum(normal), sum(learned));
  const expired = buildTimingPlan(text, {
    base: 300,
    profile,
    now: now + 31 * 86400000,
  });
  expired.forEach((d, i) => near(d, normal[i]));
});
test("rewind slowdown lowers average and replay only slows its paragraph", () => {
  const { tokens } = parseText(
    "One short paragraph.\n\nAnother short paragraph.",
  );
  const profile = { ...freshProfile(), slowdown: 0.2 };
  const plan = buildTimingPlan(tokens, {
    base: 300,
    profile,
    replayParagraph: 0,
  });
  near(targetWpm(300, profile), 250);
  near(sum(plan.slice(0, 3)), ((3 * 60000) / 250) * 1.16);
  near(sum(plan.slice(3)), (3 * 60000) / 250);
});
test("single-word paragraphs and empty input remain well-defined", () => {
  near(
    buildTimingPlan(parseText("extraordinary!").tokens, { base: 300 })[0],
    200,
  );
  assert.deepEqual(buildTimingPlan([]), []);
});
test("new timing plan responds immediately to a manual pace change", () => {
  const tokens = parseText("The very long word appears.").tokens;
  const slow = buildTimingPlan(tokens, { base: 150 }),
    fast = buildTimingPlan(tokens, { base: 300 });
  fast.forEach((d, i) => near(d * 2, slow[i]));
});
test("late timers never steal display time from following words", () => {
  let now = 0,
    callback,
    delay;
  const words = [];
  const r = new Playback({
    length: 3,
    clock: () => now,
    duration: () => 200,
    onWord: (i) => {
      words.push(i);
      now += 5;
    },
    onEnd: () => {},
    schedule: (fn, ms) => {
      callback = fn;
      delay = ms;
      return 1;
    },
    cancel: () => {},
  });
  r.play();
  near(delay, 200);
  now = 1000;
  callback();
  near(delay, 200);
  assert.deepEqual(words, [0, 1]);
  r.retime();
  near(delay, 200);
});

test("short words retain the minimum even among long words and punctuation", () => {
  const { tokens } = parseText(
    "a extraordinary; incomprehensibilities. an extraordinary; incomprehensibilities!",
  );
  for (const base of [80, 260, 300, 400, 500, 600]) {
    const plan = buildTimingPlan(tokens, { base });
    const average = 60000 / base;
    near(sum(plan), tokens.length * average);
    for (const duration of plan)
      assert.ok(duration >= minimumWordTime(average) - 0.000001);
  }
  near(minimumWordTime(200), 170);
});
test("floor allocation preserves order and total even for extreme weights", () => {
  for (const weights of [
    [1, 100, 1, 200],
    [1],
    [1, 1, 1],
    [0.1, 0.2, 0.3, 50],
  ]) {
    const result = allocateWordTimes(weights, weights.length * 200);
    near(sum(result), weights.length * 200);
    assert.ok(result.every((t) => t >= 170 - 0.000001));
  }
  assert.deepEqual(allocateWordTimes([], 0), []);
});
