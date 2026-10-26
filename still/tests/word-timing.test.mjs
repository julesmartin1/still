import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseText,
  wordWeight,
  buildTimingPlan,
  frequencyWeight,
  FREQUENCY_SLOPE,
  UNLISTED_ZIPF,
  VIEW_START,
  sentenceSpans,
  spanAt,
  VIEW_MAX_WORDS,
} from "../dist/engine.js";
import {
  parseFrequencies,
  frequencyLookup,
  loadFrequencies,
  FREQUENCY_LANGUAGES,
} from "../dist/word-frequency.js";

const sum = (values) => values.reduce((a, b) => a + b, 0);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const list = (lang) =>
  readFile(new URL(`../dist/frequency/${lang}.txt`, import.meta.url), "utf8");

test("frequency lists parse to Zipf values and look words up as cleaned", () => {
  const zipf = parseFrequencies("77 the\n57 house home\n\n23 quixotic\n");
  assert.equal(zipf.get("the"), 7.7);
  assert.equal(zipf.get("home"), 5.7);
  const lookup = frequencyLookup(zipf);
  assert.equal(lookup("quixotic"), 2.3);
  assert.equal(lookup("house's"), 5.7); // possessive
  assert.equal(lookup("zzz"), undefined);
  const curly = frequencyLookup(parseFrequencies("60 don't"));
  assert.equal(curly("don’t"), 6);
});

test("every shipped list is in order and has the common words", async () => {
  for (const lang of FREQUENCY_LANGUAGES) {
    const text = await list(lang);
    const bands = text.trim().split("\n").map((l) => Number(l.split(" ")[0]));
    assert.ok(bands.every((b, i) => !i || b < bands[i - 1]), lang);
    assert.ok(parseFrequencies(text).size > 15000, lang);
  }
  const en = frequencyLookup(parseFrequencies(await list("en")));
  assert.ok(en("the") > 7.5);
  assert.ok(en("house") > en("extraordinary"));
  assert.ok(en("extraordinary") > en("ominous"));
  assert.equal(en("quixotic"), undefined); // rarer than the list goes
});

test("a list loads once per language; others have none", async () => {
  let fetched = 0;
  const fetcher = async (url) => {
    fetched++;
    assert.equal(url, "./frequency/fr.txt");
    return { ok: true, text: async () => "70 le\n50 maison" };
  };
  const fr = await loadFrequencies("fr-CA", fetcher);
  assert.equal(fr("maison"), 5);
  assert.equal(await loadFrequencies("fr", fetcher), fr);
  assert.equal(fetched, 1);
  assert.equal(await loadFrequencies("ja", fetcher), null);
  assert.equal(await loadFrequencies("", fetcher), null);
  // A failed load gives no list, and is tried again next time.
  const failing = async () => ({ ok: false });
  assert.equal(await loadFrequencies("de", failing), null);
  const de = await loadFrequencies("de", async () => ({
    ok: true,
    text: async () => "60 haus",
  }));
  assert.equal(de("haus"), 6);
});

test("rarer words get more time, a step of Zipf at a time", () => {
  near(frequencyWeight(5), 0);
  near(frequencyWeight(4), FREQUENCY_SLOPE);
  near(frequencyWeight(6), -FREQUENCY_SLOPE);
  // Limits: a very rare word is not held forever, nor "the" rushed.
  near(frequencyWeight(-10), 0.4);
  near(frequencyWeight(9), -0.2);
  // Each time a rare word comes again it needs less.
  near(frequencyWeight(3, 3), (2 * FREQUENCY_SLOPE) / 2);
  // Common words are quick however often they come.
  near(frequencyWeight(7, 8), -2 * FREQUENCY_SLOPE);
  const bare = (word) => ({ norm: word, text: word, complexity: 0 });
  const zipf = { cat: 4.8, vat: 2.6 };
  const frequency = (w) => zipf[w];
  // Same length and sound, different frequency.
  assert.ok(
    wordWeight(bare("vat"), { frequency }) >
      wordWeight(bare("cat"), { frequency }),
  );
  near(
    wordWeight(bare("qat"), { frequency }) - wordWeight(bare("cat"), { frequency }),
    frequencyWeight(UNLISTED_ZIPF) - frequencyWeight(4.8),
  );
  // Numbers are timed by how long they are to say, not by the list.
  near(
    wordWeight(bare("1984"), { frequency }),
    wordWeight(bare("1984")),
  );
  // Without a list, the old rule: a long uncommon word gets about 0.16.
  const rare = { ...bare("ephemeral"), rare: true };
  near(wordWeight(rare) - wordWeight(bare("ephemeral")), 0.162);
});

test("frequency and repeats move time around a paragraph, not add to it", () => {
  const { tokens } = parseText(
    "Gregor woke. Gregor saw the room. Gregor sighed and the day began.",
  );
  const frequency = (w) => ({ the: 7.7, woke: 4.3, saw: 5.6, room: 5.3 })[w];
  const plain = buildTimingPlan(tokens, { base: 240 });
  const timed = buildTimingPlan(tokens, { base: 240, frequency });
  near(sum(timed), sum(plain));
  near(sum(timed), (tokens.length * 60000) / 240);
  // A name not on the list is slow the first time and quicker after.
  const gregor = tokens.flatMap((t, i) => (t.norm === "gregor" ? [i] : []));
  assert.ok(timed[gregor[0]] > timed[gregor[1]]);
  assert.ok(timed[gregor[1]] > timed[gregor[2]]);
});

test("a sentence at a time: each sentence is one view", () => {
  const { tokens } = parseText(
    "The hare ran. It slept!\n\nThe tortoise kept going and won",
  );
  const spans = sentenceSpans(tokens);
  assert.deepEqual(spans, [
    [0, 2],
    [3, 4],
    [5, 10],
  ]);
  assert.deepEqual(spanAt(spans, 4), [3, 4]);
  assert.deepEqual(spanAt(spans, 0), [0, 2]);
  assert.deepEqual(spanAt(spans, 10), [5, 10]);
  assert.equal(spanAt(spans, 11), null);
  assert.deepEqual(sentenceSpans([]), []);
});

test("a long sentence is split at a clause end that fits on screen", () => {
  const words = Array.from({ length: 70 }, (_, i) =>
    i === 19 ? "word," : i === 5 ? "early," : "word",
  );
  words[69] += ".";
  const { tokens } = parseText(words.join(" "));
  const spans = sentenceSpans(tokens);
  // Split after the comma at 19 (not the one at 5, too early), then at the
  // longest a view can be, since the rest has no clause end.
  assert.deepEqual(spans[0], [0, 19]);
  assert.deepEqual(spans[1], [20, 20 + VIEW_MAX_WORDS - 1]);
  assert.equal(spans.at(-1)[1], 69);
  // The spans cover every word once, in order.
  let next = 0;
  for (const [start, end] of spans) {
    assert.equal(start, next);
    assert.ok(end >= start && end - start < VIEW_MAX_WORDS);
    next = end + 1;
  }
  assert.equal(next, tokens.length);
});

test("a new sentence on screen gets time to find its start", () => {
  const { tokens } = parseText(
    "Gentle morning light arrived. Everyone wandered outside slowly.",
  );
  const viewStarts = new Set(sentenceSpans(tokens).map(([s]) => s));
  const plain = buildTimingPlan(tokens, { base: 300 });
  const viewed = buildTimingPlan(tokens, { base: 300, viewStarts });
  near(sum(viewed), sum(plain));
  assert.ok(viewed[4] > plain[4]); // "Everyone" opens the second sentence
  assert.ok(viewed[5] < plain[5]);
  near(viewed[0] / viewed[1], plain[0] / plain[1]); // the first needs none
  assert.ok(VIEW_START > 0);
});
