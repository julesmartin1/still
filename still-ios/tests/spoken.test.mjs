import { test } from "node:test";
import assert from "node:assert/strict";
import {
  syllables,
  sounds,
  spokenWords,
  spokenBeats,
  numberWords,
  DEFAULT_VOICE_TIMING,
  learnSpeech,
  learnPause,
  learnFromClip,
  normalVoiceTiming,
  spokenMs,
} from "../dist/spoken.js";

test("syllables follow English spelling rules of thumb", () => {
  const cases = {
    the: 1,
    make: 1,
    makes: 1,
    crossed: 1,
    table: 2,
    people: 2,
    boxes: 2,
    wanted: 2,
    steady: 2,
    unbelievable: 5,
    rhythm: 1,
  };
  for (const [word, count] of Object.entries(cases))
    assert.equal(syllables(word), count, word);
  assert.equal(syllables("—"), 0);
  // Letter pairs that make one sound count once.
  assert.equal(sounds("the"), 2);
  assert.equal(sounds("ship"), 3);
});

test("numbers, symbols and abbreviations are as long as they are to say", () => {
  assert.deepEqual(numberWords(1984), ["nineteen", "eighty", "four"]);
  assert.deepEqual(numberWords(2024), ["two", "thousand", "twenty", "four"]);
  assert.deepEqual(numberWords(305), ["three", "hundred", "five"]);
  assert.deepEqual(spokenWords("$5,000."), ["dollars", "five", "thousand"]);
  assert.deepEqual(spokenWords("3.14"), ["three", "point", "one", "four"]);
  assert.deepEqual(spokenWords("Dr."), ["doctor"]);
  assert.deepEqual(spokenWords("50%"), ["fifty", "percent"]);
  // Short capitals are spelled out; words in capitals and acronyms said as
  // words are not.
  assert.equal(spokenWords("FBI").length, 3);
  assert.deepEqual(spokenWords("THE"), ["THE"]);
  assert.deepEqual(spokenWords("NASA"), ["NASA"]);
  // Property names are words too, not lookups.
  assert.deepEqual(spokenWords("constructor"), ["constructor"]);
  assert.ok(spokenBeats("1984") > 3 * spokenBeats("year"));
  assert.ok(spokenBeats("a") < spokenBeats("the"));
  assert.ok(spokenBeats("the") < spokenBeats("extraordinary"));
  assert.equal(spokenBeats("—"), 1);
});

test("the voice's pace is learned from stretches of speech", () => {
  // A voice that takes 60 ms per word plus 70 ms per beat.
  let t = { ...DEFAULT_VOICE_TIMING };
  for (let i = 0; i < 80; i++) {
    const words = 3 + (i % 9),
      beats = words * (2 + (i % 5) * 0.8) + (i % 4);
    t = learnSpeech(t, { words, beats, ms: 60 * words + 70 * beats });
  }
  // Close to it, with a little of the defaults still mixed in.
  assert.ok(Math.abs(t.perWord - 60) < 5, t.perWord);
  assert.ok(Math.abs(t.perBeat - 70) < 2, t.perBeat);
  assert.equal(t.samples, 80);
  // Nonsense is ignored.
  assert.equal(learnSpeech(t, { words: 0, beats: 3, ms: 100 }), t);
});

test("pauses after commas and full stops are learned, within reason", () => {
  let t = { ...DEFAULT_VOICE_TIMING };
  for (let i = 0; i < 60; i++) t = learnPause(t, "stop", 600);
  assert.ok(Math.abs(t.stop - 600) < 5);
  t = learnPause(t, "comma", 99999);
  assert.ok(t.comma <= 700);
  assert.equal(learnPause(t, "other", 300).comma, t.comma);
});

test("a clip teaches from its stretches without punctuation inside", () => {
  const words = ["Slow", "and", "steady,", "wins", "the", "race", "today."];
  const learned = learnFromClip(DEFAULT_VOICE_TIMING, {
    words,
    speed: 1.25,
    // Two stretches between pauses; the first has a comma at its end only.
    stretches: [
      [0, 3, 0, 800],
      [3, 7, 1100, 2000],
    ],
    matches: [{ word: 3, gap: { from: 800, to: 1100 } }],
  });
  assert.equal(learned.samples, 2);
  // The 300 ms pause after "steady," at speed 1.25 is 375 ms at speed 1.
  assert.ok(learned.comma > DEFAULT_VOICE_TIMING.comma);
  // A stretch with a comma inside it says nothing about word lengths.
  const skipped = learnFromClip(DEFAULT_VOICE_TIMING, {
    words,
    stretches: [[0, 7, 0, 2000]],
  });
  assert.equal(skipped.samples, 0);
});

test("stored timing is checked before use", () => {
  assert.deepEqual(normalVoiceTiming(null), DEFAULT_VOICE_TIMING);
  assert.deepEqual(normalVoiceTiming("junk"), DEFAULT_VOICE_TIMING);
  const t = normalVoiceTiming({
    perWord: 9999,
    perBeat: "x",
    comma: 200,
    extra: 1,
  });
  assert.equal(t.perWord, 260);
  assert.equal(t.perBeat, DEFAULT_VOICE_TIMING.perBeat);
  assert.equal(t.comma, 200);
  assert.equal("extra" in t, false);
  assert.ok(spokenMs("extraordinary", t) > spokenMs("a", t));
});
