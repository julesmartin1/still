import { test } from "node:test";
import assert from "node:assert/strict";
import { parseText } from "../dist/engine.js";
import {
  NATURAL_VOICES,
  naturalVoiceId,
  naturalVoiceValue,
  naturalReadsLanguage,
  naturalSupported,
  speedForWpm,
  learnOneWpm,
  voicedSpan,
  letterWeights,
  naturalWordStarts,
  NaturalPlayback,
  NaturalVoiceEngine,
  NATURAL_ONE_WPM,
  WAIT_LIMIT_MS,
  FIRST_WAIT_LIMIT_MS,
  END_GRACE_MS,
} from "../dist/natural-voice.js";

test("words a minute map to the voice's speed, clamped to 0.6–1.5", () => {
  assert.equal(speedForWpm(NATURAL_ONE_WPM), 1);
  assert.equal(speedForWpm(240, 160), 1.5);
  assert.equal(speedForWpm(600, 160), 1.5);
  assert.equal(speedForWpm(40, 160), 0.6);
  assert.equal(speedForWpm(Number.NaN, 160), 1);
  // Steps of 0.05, so a clip made ahead is reused after small changes.
  assert.equal(speedForWpm(170, 160), 1.05);
  assert.equal(speedForWpm(200, 200), 1);
});

test("the pace at speed 1 is learned from long chunks only", () => {
  assert.equal(learnOneWpm(160, 3, 1000, 1), 160);
  assert.equal(learnOneWpm(160, 10, 1000, 1), 160); // under 1.5 s
  // 20 words in 6 s at speed 1 is 200 a minute: the estimate moves 30% there.
  assert.equal(learnOneWpm(160, 20, 6000, 1), 172);
  // The same words at speed 1.25 mean 160 a minute at speed 1.
  assert.equal(learnOneWpm(160, 20, 6000, 1.25), 160);
  assert.equal(learnOneWpm(160, 200, 6000, 1), 240); // clamped
});

test("the voiced part of a clip skips leading and trailing silence", () => {
  const rate = 1000;
  const samples = new Float32Array(2000);
  for (let i = 300; i < 1700; i++) samples[i] = 0.5;
  const { lead, tail } = voicedSpan(samples, rate);
  assert.equal(lead, 280); // 300 ms less the 20 ms backoff
  assert.equal(tail, 280);
  assert.deepEqual(voicedSpan(new Float32Array(100), rate), {
    lead: 0,
    tail: 0,
  });
  // Never more than 40% of the clip either side.
  const late = new Float32Array(1000);
  late[990] = 1;
  assert.equal(voicedSpan(late, rate).lead, 400);
});

test("word starts follow phoneme counts over the voiced part of the clip", () => {
  const words = ["A", "long", "word"];
  // Weights 1, 3, 4: the second word starts 1/8 in, the third 4/8 in.
  const starts = naturalWordStarts(words, 1000, [1, 3, 4], {
    lead: 100,
    tail: 100,
  });
  assert.deepEqual(starts, [0, 100 + 800 / 8, 100 + (800 * 4) / 8]);
  // Starts always rise and stay inside the clip.
  const many = naturalWordStarts(
    "This is, after all, a test. Of words.".split(" "),
    5000,
  );
  for (let i = 1; i < many.length; i++) assert.ok(many[i] > many[i - 1]);
  assert.ok(many.at(-1) < 5000);
});

test("commas and sentence ends inside a chunk get extra time", () => {
  const plain = naturalWordStarts(["one", "two", "six"], 900, [3, 3, 3]);
  const comma = naturalWordStarts(["one,", "two", "six"], 900, [3, 3, 3]);
  const stop = naturalWordStarts(["one.", "two", "six"], 900, [3, 3, 3]);
  assert.equal(plain[1], 300);
  assert.ok(comma[1] > plain[1]);
  assert.ok(stop[1] > comma[1]);
  // The last word's punctuation adds nothing: the clip's own silence is it.
  assert.deepEqual(
    naturalWordStarts(["one", "two", "six."], 900, [3, 3, 3]),
    plain,
  );
});

test("without phoneme counts, letters stand in", () => {
  assert.deepEqual(letterWeights(["a", "word", "—"]), [1, 3.4, 1]);
  const starts = naturalWordStarts(["a", "longer"], 1000, null);
  assert.ok(starts[1] < 300); // "a" is short
  const bad = naturalWordStarts(["a", "longer"], 1000, [0, Number.NaN]);
  assert.deepEqual(bad, starts);
});

test("natural voice values in settings", () => {
  assert.equal(naturalVoiceId(naturalVoiceValue("af_heart")), "af_heart");
  assert.equal(naturalVoiceId("natural:nope"), "");
  assert.equal(naturalVoiceId("Samantha"), "");
  assert.equal(naturalVoiceId(undefined), "");
  assert.ok(NATURAL_VOICES.length >= 2 && NATURAL_VOICES.length <= 4);
  assert.ok(naturalReadsLanguage("en") && naturalReadsLanguage(""));
  assert.ok(!naturalReadsLanguage("fr"));
});

test("natural voice support needs WebAssembly, workers, Web Audio and the Cache API", () => {
  const scope = {
    WebAssembly: { instantiate() {} },
    Worker: function () {},
    AudioContext: function () {},
    caches: { open() {} },
  };
  assert.equal(naturalSupported(scope), true);
  assert.equal(naturalSupported({ ...scope, WebAssembly: undefined }), false);
  assert.equal(naturalSupported({ ...scope, caches: undefined }), false);
  assert.equal(naturalSupported({ ...scope, AudioContext: undefined }), false);
});

// A fake synthesizer and audio clock, driven by hand.
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(text, options = {}) {
  const { tokens } = parseText(text);
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const requests = [];
  const synth = {
    ready: options.ready ?? true,
    synthesize(request, { urgent }) {
      let resolve, reject;
      const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
      requests.push({ ...request, urgent, resolve, reject });
      return promise;
    },
  };
  // A clip of `ms` milliseconds at 1 kHz, all voiced.
  const clip = (ms, weights = null) => ({
    samples: new Float32Array(ms).fill(0.5),
    sampleRate: 1000,
    weights,
  });
  const sounds = [];
  const audio = {
    unlocks: 0,
    unlock() {
      this.unlocks++;
    },
    now: () => now,
    play(c, onEnded) {
      const sound = { clip: c, onEnded, stopped: false, startedAt: now };
      sound.stop = () => (sound.stopped = true);
      sounds.push(sound);
      return sound;
    },
  };
  const shown = [];
  const events = [];
  const rates = new Map();
  const player = new NaturalPlayback({
    length: tokens.length,
    tokens,
    onWord: (i) => shown.push(i),
    onEnd: () => events.push("end"),
    breakAfter: options.breakAfter ?? null,
    onBreak: (i) => events.push(`break ${i}`),
    onFail: (reason) => events.push(`fail ${reason}`),
    wpm: () => options.wpm ?? NATURAL_ONE_WPM,
    voice: "af_heart",
    synth,
    audio,
    rates,
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    cancel: (id) => timers.delete(id),
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
  // Ends the sound playing now, as the audio output would.
  const end = () => sounds.at(-1).onEnded();
  return {
    tokens,
    player,
    requests,
    sounds,
    shown,
    events,
    advance,
    end,
    clip,
    audio,
    rates,
  };
}

test("speaks chunk by chunk, words follow the clip, the next chunk is made ahead", async () => {
  const h = harness("One two three. Four five.");
  h.player.play();
  assert.equal(h.audio.unlocks, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].text, "One two three.");
  assert.deepEqual(h.requests[0].words, ["One", "two", "three."]);
  assert.equal(h.requests[0].speed, 1);
  assert.equal(h.requests[0].voice, "af_heart");
  assert.equal(h.requests[0].urgent, true);
  assert.deepEqual(h.shown, [0]);
  // Equal weights over 900 ms: words start at 0, 300 and 600 ms.
  h.requests[0].resolve(h.clip(900, [3, 3, 3]));
  await tick();
  assert.equal(h.sounds.length, 1);
  // The next sentence is asked for while this one plays.
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].text, "Four five.");
  assert.equal(h.requests[1].urgent, false);
  h.advance(299);
  assert.equal(h.player.index, 0);
  h.advance(2);
  assert.equal(h.player.index, 1);
  h.advance(300);
  assert.equal(h.player.index, 2);
  h.requests[1].resolve(h.clip(600, [2, 2]));
  await tick();
  h.advance(300);
  h.end();
  // The clip made ahead plays at once: nothing new is asked for.
  await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.sounds.length, 2);
  assert.equal(h.player.index, 3);
  h.advance(300);
  assert.equal(h.player.index, 4);
  h.end();
  assert.deepEqual(h.events, ["end"]);
  assert.equal(h.player.finished, true);
  assert.equal(h.player.playing, false);
  assert.deepEqual(h.shown, [0, 1, 2, 3, 4]);
});

test("pause stops the sound and keeps the word; play speaks again from it", async () => {
  const h = harness("One two three four. Five.");
  h.player.play();
  h.requests[0].resolve(h.clip(1200, [3, 3, 3, 3]));
  await tick();
  h.advance(350);
  assert.equal(h.player.index, 1);
  h.player.pause();
  assert.equal(h.sounds[0].stopped, true);
  // Late events from the stopped sound change nothing.
  h.sounds[0].onEnded();
  h.advance(2000);
  assert.equal(h.player.index, 1);
  assert.equal(h.player.playing, false);
  h.player.play();
  const again = h.requests.at(-1);
  assert.equal(again.text, "two three four.");
  assert.equal(again.urgent, true);
  again.resolve(h.clip(900, [3, 3, 3]));
  await tick();
  assert.equal(h.sounds.length, 2);
  h.advance(310);
  assert.equal(h.player.index, 2);
});

test("a clip that arrives after a pause is not played", async () => {
  const h = harness("One two. Three.");
  h.player.play();
  h.player.pause();
  h.requests[0].resolve(h.clip(600));
  await tick();
  assert.equal(h.sounds.length, 0);
  // Playing again reuses it.
  h.player.play();
  await tick();
  assert.equal(h.requests.length, 2); // the second is the next chunk, ahead
  assert.equal(h.requests[1].text, "Three.");
  assert.equal(h.sounds.length, 1);
});

test("seeking speaks from the new word; a pace change re-speaks at the new speed", async () => {
  const h = harness("One two. Three four five. Six.");
  h.player.play();
  h.player.seek(3);
  assert.equal(h.player.playing, false);
  h.player.play();
  assert.equal(h.requests.at(-1).text, "four five.");
  const count = h.requests.length;
  // The same speed: nothing to redo.
  h.player.retime();
  assert.equal(h.requests.length, count);
  h.player.wpm = () => 240;
  h.player.retime();
  assert.equal(h.requests.length, count + 1);
  assert.equal(h.requests.at(-1).text, "four five.");
  assert.equal(h.requests.at(-1).speed, 1.5);
});

test("paces slower than the voice goes hold the sentence's last word", async () => {
  const h = harness("One two. Three.", { wpm: 40 });
  h.player.play();
  assert.equal(h.requests[0].speed, 0.6);
  h.requests[0].resolve(h.clip(1000, [3, 3]));
  await tick();
  h.requests[1].resolve(h.clip(500));
  h.advance(1000);
  h.end();
  // Two words at 40 a minute take 3 s; the voice took 1 s.
  assert.equal(h.player.index, 1);
  await tick();
  assert.equal(h.sounds.length, 1);
  h.advance(1900);
  assert.equal(h.player.index, 1);
  h.advance(200);
  assert.equal(h.player.index, 2);
  await tick();
  assert.equal(h.sounds.length, 2);
});

test("stops where breakAfter says, like normal playback", async () => {
  const h = harness("One two. Three four.", { breakAfter: (i) => i === 1 });
  h.player.play();
  h.requests[0].resolve(h.clip(600, [3, 3]));
  await tick();
  h.advance(600);
  h.end();
  assert.deepEqual(h.events, ["break 1"]);
  assert.equal(h.player.index, 1);
  assert.equal(h.player.playing, false);
});

test("a failed clip, a voice too slow or a stuck sound hands back to the app", async () => {
  let h = harness("One two. Three.");
  h.player.play();
  h.requests[0].reject({ code: "failed" });
  await tick();
  assert.deepEqual(h.events, ["fail failed"]);
  assert.equal(h.player.playing, false);
  assert.equal(h.player.index, 0);

  h = harness("One two. Three.");
  h.player.play();
  h.advance(WAIT_LIMIT_MS + 1);
  assert.deepEqual(h.events, ["fail slow"]);
  assert.equal(h.player.playing, false);

  // While the voice is still loading, the first chunk may take longer.
  h = harness("One two. Three.", { ready: false });
  h.player.play();
  h.advance(WAIT_LIMIT_MS + 1);
  assert.deepEqual(h.events, []);
  h.advance(FIRST_WAIT_LIMIT_MS);
  assert.deepEqual(h.events, ["fail slow"]);

  h = harness("One two. Three.");
  h.player.play();
  h.requests[0].resolve(h.clip(600));
  await tick();
  h.advance(600 + END_GRACE_MS + 1); // the sound never said it ended
  assert.deepEqual(h.events, ["fail failed"]);
  assert.equal(h.sounds[0].stopped, true);
});

test("a chunk dropped from the queue is asked for again", async () => {
  const h = harness("One two. Three.");
  h.player.play();
  h.requests[0].reject({ code: "dropped" });
  await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].text, "One two.");
  assert.deepEqual(h.events, []);
});

test("the voice's pace is learned so later sentences match the reader's", async () => {
  const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
  const h = harness(`${words}. ${words}.`, { wpm: 200 });
  h.player.play();
  assert.equal(h.requests[0].speed, 1.25);
  // 20 words in 4.8 s at speed 1.25 → 200 a minute at speed 1.
  h.requests[0].resolve(h.clip(4800));
  await tick();
  assert.equal(h.rates.get("af_heart"), 160 * 0.7 + 200 * 0.3);
});

// A fake worker for the engine's messages.
function fakeWorker() {
  const worker = {
    sent: [],
    terminated: false,
    postMessage(message) {
      this.sent.push(message);
    },
    reply(message) {
      this.onmessage({ data: message });
    },
    terminate() {
      this.terminated = true;
    },
  };
  return worker;
}

test("the engine loads once, reports progress and speaks in turn", async () => {
  const worker = fakeWorker();
  const engine = new NaturalVoiceEngine({ createWorker: () => worker });
  const progress = [];
  const loaded = engine.load({
    download: true,
    onProgress: (p) => progress.push(p),
  });
  assert.equal(engine.state, "loading");
  assert.deepEqual(worker.sent[0], { type: "load", id: 1, download: true });
  worker.reply({ type: "progress", loaded: 50, total: 100 });
  worker.reply({ type: "ready", id: 1 });
  await loaded;
  assert.equal(engine.ready, true);
  assert.deepEqual(progress, [
    { type: "progress", loaded: 50, total: 100 },
    { done: true },
  ]);

  const first = engine.synthesize({
    text: "One.",
    words: ["One."],
    voice: "af_heart",
    speed: 1,
  });
  const second = engine.synthesize({
    text: "Two.",
    words: ["Two."],
    voice: "af_heart",
    speed: 1,
  });
  await tick();
  // One at a time.
  assert.equal(worker.sent.filter((m) => m.type === "speak").length, 1);
  const a = worker.sent.at(-1);
  assert.equal(a.text, "One.");
  worker.reply({
    type: "audio",
    id: a.id,
    samples: new Float32Array(3),
    sampleRate: 24000,
    weights: [1],
  });
  assert.equal((await first).sampleRate, 24000);
  const b = worker.sent.at(-1);
  assert.equal(b.text, "Two.");
  worker.reply({ type: "speak-error", id: b.id });
  await assert.rejects(second, (e) => e.code === "failed");
});

test("an urgent chunk goes first and drops chunks not started", async () => {
  const worker = fakeWorker();
  const engine = new NaturalVoiceEngine({ createWorker: () => worker });
  engine.load();
  worker.reply({ type: "ready", id: 1 });
  await tick();
  const busy = engine.synthesize({ text: "A." });
  const ahead = engine.synthesize({ text: "B." });
  await tick();
  const now = engine.synthesize({ text: "C." }, { urgent: true });
  await assert.rejects(ahead, (e) => e.code === "dropped");
  await tick();
  const a = worker.sent.at(-1);
  assert.equal(a.text, "A.");
  worker.reply({
    type: "audio",
    id: a.id,
    samples: new Float32Array(1),
    sampleRate: 1,
  });
  await busy;
  assert.equal(worker.sent.at(-1).text, "C.");
  worker.reply({
    type: "audio",
    id: worker.sent.at(-1).id,
    samples: new Float32Array(1),
    sampleRate: 1,
  });
  await now;
});

test("without the download, a voice not saved yet fails as missing", async () => {
  const worker = fakeWorker();
  const engine = new NaturalVoiceEngine({ createWorker: () => worker });
  const speaking = engine.synthesize({ text: "One." });
  worker.reply({ type: "load-error", id: 1, code: "missing" });
  await assert.rejects(speaking, (e) => e.code === "missing");
  assert.equal(engine.state, "idle");
  assert.equal(worker.terminated, false);
  // Asking for the download then works.
  const loaded = engine.load({ download: true });
  assert.deepEqual(worker.sent.at(-1), { type: "load", id: 2, download: true });
  worker.reply({ type: "ready", id: 2 });
  await loaded;
});

test("a download asked for while a plain load waits takes over from it", async () => {
  const worker = fakeWorker();
  const engine = new NaturalVoiceEngine({ createWorker: () => worker });
  const plain = engine.load();
  const download = engine.load({ download: true });
  worker.reply({ type: "load-error", id: 1, code: "missing" }); // replaced: ignored
  worker.reply({ type: "ready", id: 2 });
  await download;
  await plain;
  assert.equal(engine.ready, true);
});

test("a worker that can't run fails everything waiting on it", async () => {
  const worker = fakeWorker();
  const engine = new NaturalVoiceEngine({ createWorker: () => worker });
  const loaded = engine.load({ download: true });
  const speaking = engine.synthesize({ text: "One." });
  worker.onerror({ preventDefault() {} });
  await assert.rejects(loaded, (e) => e.code === "unsupported");
  await assert.rejects(speaking, (e) => e.code === "unsupported");
  assert.equal(engine.state, "failed");
  assert.equal(worker.terminated, true);
});
