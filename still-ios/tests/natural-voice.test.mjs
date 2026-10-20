import { test } from "node:test";
import assert from "node:assert/strict";
import { parseText } from "../dist/engine.js";
import {
  NATURAL_VOICES,
  naturalVoiceId,
  naturalVoiceValue,
  naturalSupported,
  speedForWpm,
  learnOneWpm,
  voicedSpan,
  letterWeights,
  naturalWordStarts,
  NaturalPlayback,
  CloudVoiceEngine,
  MAX_SPEAK_CHARS,
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
  assert.equal(naturalVoiceId(naturalVoiceValue("marin")), "marin");
  assert.equal(naturalVoiceId("natural:nope"), "");
  assert.equal(naturalVoiceId("Samantha"), "");
  assert.equal(naturalVoiceId(undefined), "");
  assert.ok(NATURAL_VOICES.length >= 2 && NATURAL_VOICES.length <= 4);
});

test("natural voice support needs Web Audio and fetch", () => {
  const scope = { AudioContext: function () {}, fetch() {} };
  assert.equal(naturalSupported(scope), true);
  assert.equal(naturalSupported({ ...scope, AudioContext: undefined }), false);
  assert.equal(
    naturalSupported({ webkitAudioContext: function () {}, fetch() {} }),
    true,
  );
  assert.equal(naturalSupported({ ...scope, fetch: undefined }), false);
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
    voice: "marin",
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
  assert.equal(h.requests[0].voice, "marin");
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

  // While the voice isn't ready yet, the first chunk may take longer.
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

test("the voice's pace is learned so later sentences match the reader's", async () => {
  const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
  const h = harness(`${words}. ${words}.`, { wpm: 200 });
  h.player.play();
  assert.equal(h.requests[0].speed, 1.25);
  // 20 words in 4.8 s at speed 1.25 → 200 a minute at speed 1.
  h.requests[0].resolve(h.clip(4800));
  await tick();
  assert.equal(h.rates.get("marin"), 160 * 0.7 + 200 * 0.3);
});

test("the server engine posts the chunk and decodes the clip", async () => {
  const calls = [];
  const engine = new CloudVoiceEngine({
    fetch: async (url, init) => {
      calls.push({ url, ...init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, arrayBuffer: async () => "mp3 bytes" };
    },
    decode: async (bytes) => ({ samples: [bytes], sampleRate: 24000 }),
  });
  assert.equal(engine.ready, true);
  const clip = await engine.synthesize({
    text: "Hello there.",
    words: ["Hello", "there."],
    voice: "sage",
    speed: 1.1,
  });
  assert.deepEqual(clip, { samples: ["mp3 bytes"], sampleRate: 24000 });
  assert.equal(calls[0].url, "/api/speak");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    text: "Hello there.",
    voice: "sage",
    speed: 1.1,
  });
  // Never more than the server takes.
  await engine.synthesize({ text: "x".repeat(5000), voice: "sage", speed: 1 });
  assert.equal(calls[1].body.text.length, MAX_SPEAK_CHARS);
});

test("server and network problems become reasons the app can explain", async () => {
  const failing = (respond) =>
    new CloudVoiceEngine({ fetch: respond, decode: async () => ({}) });
  const code = (engine) =>
    engine.synthesize({ text: "Hi.", voice: "marin", speed: 1 }).then(
      () => "ok",
      (error) => error.code,
    );
  const offline = failing(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(await code(offline), "offline");
  for (const [status, expected] of [
    [503, "unavailable"],
    [404, "unavailable"],
    [429, "busy"],
    [502, "failed"],
  ])
    assert.equal(
      await code(failing(async () => ({ ok: false, status }))),
      expected,
    );
  const undecodable = new CloudVoiceEngine({
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => 1 }),
    decode: async () => {
      throw new Error("bad audio");
    },
  });
  assert.equal(await code(undecodable), "failed");
});
