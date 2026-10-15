import { test } from "node:test";
import assert from "node:assert/strict";
import { parseText } from "../dist/engine.js";
import {
  wpmToRate,
  chunkEnd,
  utteranceText,
  wordAtChar,
  estimateWordTimes,
  guessLanguage,
  pickVoice,
  speechSupported,
  SpokenPlayback,
  MAX_CHUNK_WORDS,
  START_TIMEOUT_MS,
} from "../dist/read-aloud.js";

test("words per minute map to a voice rate, clamped to 0.5–2", () => {
  assert.equal(wpmToRate(180), 1);
  assert.equal(wpmToRate(270), 1.5);
  assert.equal(wpmToRate(40), 0.5);
  assert.equal(wpmToRate(600), 2);
  assert.equal(wpmToRate(Number.NaN), 1);
});

test("utterance text keeps a char offset for every word", () => {
  const words = ["Hello,", "quiet", "world."];
  const { text, offsets } = utteranceText(words);
  assert.equal(text, "Hello, quiet world.");
  assert.deepEqual(offsets, [0, 7, 13]);
  words.forEach((w, i) => assert.equal(text.slice(offsets[i]).indexOf(w), 0));
});

test("words of scripts without spaces are joined back together", () => {
  const { text, offsets } = utteranceText(["在一个", "安静的", "早晨。"]);
  assert.equal(text, "在一个安静的早晨。");
  assert.deepEqual(offsets, [0, 3, 6]);
});

test("a boundary's charIndex maps back to its word", () => {
  const { offsets } = utteranceText(["Hello,", "quiet", "world."]);
  assert.equal(wordAtChar(offsets, 0), 0);
  assert.equal(wordAtChar(offsets, 3), 0);
  assert.equal(wordAtChar(offsets, 6), 0); // the space after "Hello,"
  assert.equal(wordAtChar(offsets, 7), 1);
  assert.equal(wordAtChar(offsets, 13), 2);
  assert.equal(wordAtChar(offsets, 99), 2);
});

test("chunks end at each sentence and paragraph end", () => {
  const { tokens } = parseText("One two three. Four five!\n\nSix seven");
  assert.equal(chunkEnd(tokens, 0), 2);
  assert.equal(chunkEnd(tokens, 1), 2);
  assert.equal(chunkEnd(tokens, 3), 4);
  assert.equal(chunkEnd(tokens, 5), 6);
});

test("very long sentences are split at a clause, or at the word limit", () => {
  const words = Array.from({ length: 150 }, (_, i) => `w${i}`);
  words[30] += ",";
  words[45] += ";";
  const { tokens } = parseText(words.join(" ") + ".");
  assert.equal(chunkEnd(tokens, 0), 45); // the last clause end in range
  assert.equal(chunkEnd(tokens, 46), 46 + MAX_CHUNK_WORDS - 1);
  // A clause end before MIN_SPLIT_WORDS doesn't count.
  const early = Array.from({ length: 80 }, (_, i) => (i === 5 ? "a," : "a"));
  assert.equal(chunkEnd(parseText(early.join(" ")).tokens, 0), 59);
});

test("estimated word times keep the pace on average", () => {
  const words = ["A", "considerably", "long", "sentence,", "here."];
  const times = estimateWordTimes(words, 180);
  const total = times.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - words.length * (60000 / 180)) < 1e-6);
  assert.ok(times[1] > times[0]);
  assert.ok(times[4] > times[2]);
  assert.deepEqual(estimateWordTimes([], 200), []);
});

test("the reading's language is guessed from its words or script", () => {
  const words = (text) => parseText(text).tokens;
  assert.equal(
    guessLanguage(words("The cat sat on the mat and it was happy with this.")),
    "en",
  );
  assert.equal(
    guessLanguage(
      words("Il est dans la maison et elle ne veut pas sortir avec nous."),
    ),
    "fr",
  );
  assert.equal(
    guessLanguage(
      words(
        "El perro y los gatos están en la casa con una niña para su madre.",
      ),
    ),
    "es",
  );
  assert.equal(
    guessLanguage(words("在一个安静的早晨，阳光慢慢地移过地板。")),
    "zh",
  );
  assert.equal(
    guessLanguage(words("静かな朝に、光がゆっくりと床を動く。")),
    "ja",
  );
  assert.equal(guessLanguage(words("Xq zv brt plo.")), "");
  assert.equal(guessLanguage([]), "");
});

const voice = (name, lang, localService = true, isDefault = false) => ({
  name,
  lang,
  localService,
  default: isDefault,
});

test("voices: on the device only, in the reading's language when known", () => {
  const voices = [
    voice("Cloud", "en-US", false, true),
    voice("Local English", "en-GB"),
    voice("Local French", "fr-FR"),
    voice("Cloud French", "fr-CA", false),
  ];
  assert.equal(pickVoice(voices, "fr").name, "Local French");
  // Unknown language: the default's language, on the device.
  assert.equal(pickVoice(voices, "").name, "Local English");
  // No voice for the language on the device: the device's own voice.
  assert.equal(pickVoice(voices, "de").name, "Local English");
  assert.equal(
    pickVoice([voice("A", "en-US"), voice("B", "en-GB", true, true)], "en")
      .name,
    "B",
  );
  assert.equal(
    pickVoice([voice("A", "en-US"), voice("B", "en-GB")], "en", "en-GB").name,
    "B",
  );
  assert.equal(pickVoice([voice("Cloud", "en-US", false, true)], "en"), null);
  assert.equal(pickVoice([], "en"), null);
});

test("speech support needs both speechSynthesis and utterances", () => {
  assert.equal(speechSupported({}), false);
  assert.equal(speechSupported({ speechSynthesis: { speak() {} } }), false);
  assert.equal(
    speechSupported({
      speechSynthesis: { speak() {} },
      SpeechSynthesisUtterance: function () {},
    }),
    true,
  );
});

// A fake speechSynthesis and clock, driven by hand.
function harness(text, options = {}) {
  const { tokens } = parseText(text);
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const spoken = [];
  const synth = {
    speaking: false,
    paused: false,
    cancels: 0,
    voices: options.voices ?? [voice("Local", "en-US", true, true)],
    getVoices() {
      return this.voices;
    },
    speak(u) {
      spoken.push(u);
      if (options.autoStart !== false) u.onstart?.({});
    },
    cancel() {
      this.cancels++;
    },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const shown = [];
  const events = [];
  const player = new SpokenPlayback({
    length: tokens.length,
    tokens,
    onWord: (i) => shown.push(i),
    onEnd: () => events.push("end"),
    breakAfter: options.breakAfter ?? null,
    onBreak: (i) => events.push(`break ${i}`),
    onSilent: (reason) => events.push(`silent ${reason}`),
    wpm: () => options.wpm ?? 180,
    synth,
    Utterance,
    uiLanguage: "en-US",
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    cancel: (id) => timers.delete(id),
    clock: () => now,
  });
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  const say = (u, word) => {
    const start = u.text.indexOf(word);
    assert.ok(start >= 0, `${word} not in "${u.text}"`);
    u.onboundary?.({ name: "word", charIndex: start });
  };
  return { tokens, player, synth, spoken, shown, events, advance, say };
}

test("speaks sentence by sentence and follows word boundaries", () => {
  const h = harness("One two three. Four five.");
  h.player.play();
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].text, "One two three.");
  assert.equal(h.spoken[0].rate, 1);
  assert.equal(h.spoken[0].voice.name, "Local");
  h.say(h.spoken[0], "One");
  h.say(h.spoken[0], "two");
  assert.equal(h.player.index, 1);
  h.say(h.spoken[0], "three.");
  assert.equal(h.player.index, 2);
  h.spoken[0].onend();
  assert.equal(h.spoken[1].text, "Four five.");
  assert.equal(h.player.index, 3);
  h.say(h.spoken[1], "five.");
  h.spoken[1].onend();
  assert.deepEqual(h.events, ["end"]);
  assert.equal(h.player.finished, true);
  assert.deepEqual(h.shown, [0, 1, 2, 3, 4]);
});

test("pause cancels speech; play speaks again from the current word", () => {
  const h = harness("One two three four. Five.");
  h.player.play();
  h.say(h.spoken[0], "two");
  h.player.pause();
  assert.equal(h.synth.cancels, 1);
  // The cancelled utterance's late events change nothing.
  h.spoken[0].onboundary({ name: "word", charIndex: 8 });
  h.spoken[0].onend();
  assert.equal(h.player.index, 1);
  assert.equal(h.spoken.length, 1);
  h.player.play();
  assert.equal(h.spoken[1].text, "two three four.");
});

test("seeking and pace changes restart speech from the new word", () => {
  const h = harness("One two. Three four five. Six.", { wpm: 360 });
  h.player.play();
  h.player.seek(3);
  assert.equal(h.player.playing, false);
  h.player.play();
  assert.equal(h.spoken.at(-1).text, "four five.");
  assert.equal(h.spoken.at(-1).rate, 2);
  h.player.retime();
  assert.equal(h.spoken.length, 3);
  assert.equal(h.spoken.at(-1).text, "four five.");
});

test("paces slower than any voice wait between sentences", () => {
  const h = harness("One two. Three.", { wpm: 45 });
  h.player.play();
  assert.equal(h.spoken[0].rate, 0.5);
  h.say(h.spoken[0], "two.");
  h.advance(600);
  h.spoken[0].onend();
  // Two words at 45 a minute take about 2.7 s; the voice took 0.6 s.
  assert.equal(h.player.index, 1);
  assert.equal(h.spoken.length, 1);
  h.advance(2000);
  assert.equal(h.spoken.length, 1);
  h.advance(200);
  assert.equal(h.spoken.length, 2);
  assert.equal(h.player.index, 2);
});

test("stops where breakAfter says, like normal playback", () => {
  const h = harness("One two. Three four.", {
    breakAfter: (i) => i === 1,
  });
  h.player.play();
  h.say(h.spoken[0], "two.");
  h.spoken[0].onend();
  assert.deepEqual(h.events, ["break 1"]);
  assert.equal(h.player.playing, false);
  assert.equal(h.player.index, 1);
  assert.equal(h.spoken.length, 1);
});

test("voices without word boundaries move words on a timer", () => {
  const h = harness("One two three four.");
  h.player.play();
  assert.equal(h.player.index, 0);
  h.advance(3000); // long enough for the whole sentence
  assert.equal(h.player.index, 3); // stays on the last word until `end`
  assert.deepEqual(h.events, []);
  h.spoken[0].onend();
  assert.deepEqual(h.events, ["end"]);
  // Remembered: the next utterance uses the timer straight away.
  assert.equal(h.player.boundaries, false);
});

test("words carry on at the pace when the voice never starts", () => {
  const h = harness("One two. Three.", { autoStart: false });
  h.player.play();
  h.advance(START_TIMEOUT_MS + 10);
  assert.deepEqual(h.events, ["silent failed"]);
  h.advance(5000);
  assert.equal(h.player.index, 2);
  assert.deepEqual(h.events, ["silent failed", "end"]);
  assert.equal(h.spoken.length, 1); // no more tries until play is pressed
});

test("never falls back to a voice that runs off the device", () => {
  const h = harness("One two.", {
    voices: [voice("Cloud", "en-US", false, true)],
  });
  h.player.play();
  assert.equal(h.spoken.length, 0);
  assert.deepEqual(h.events, ["silent no-voice"]);
});
