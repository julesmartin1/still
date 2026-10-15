// The natural voice's worker (see natural-voice.js): runs Kokoro-82M with the
// runtime in vendor/kokoro/, so turning text into speech never blocks the
// page. The runtime is only loaded when a natural voice is used.
//
// Messages in:  { type: "load", id, download }
//               { type: "speak", id, text, words, voice, speed }
// Messages out: { type: "progress", loaded, total }
//               { type: "ready", id } or { type: "load-error", id, code }
//               { type: "audio", id, samples, sampleRate, weights }
//               { type: "speak-error", id }
//
// The only network requests are for the model's files on huggingface.co
// (the first time, when the reader asked for the download). The text to
// speak stays in this worker.
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_FILE = "onnx/model_quantized.onnx";
const MODEL_BYTES = 92361116;
const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/${MODEL_FILE}`;
const CACHE = "still-natural-voice-v1";

let kokoro = null;
let tts = null;
let loading = Promise.resolve();
let queue = Promise.resolve();

async function load(download) {
  const cache = await caches.open(CACHE);
  if (!download && !(await cache.match(MODEL_URL))) throw { code: "missing" };
  let lib;
  try {
    lib = kokoro ||= await import("./vendor/kokoro/kokoro.js");
  } catch {
    throw { code: "unsupported" };
  }
  // Model files are saved in our own cache, read from it after the first
  // time, and never looked for on this site.
  lib.env.useBrowserCache = false;
  lib.env.useCustomCache = true;
  lib.env.customCache = cache;
  lib.env.allowLocalModels = false;
  lib.env.allowRemoteModels = true;
  const files = new Map();
  let downloaded = false;
  const report = (info) => {
    if (info.status === "progress" && info.file) {
      files.set(info.file, {
        loaded: info.loaded || 0,
        total: info.total || 0,
      });
      let loaded = 0,
        total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      postMessage({
        type: "progress",
        loaded,
        total: Math.max(total, MODEL_BYTES),
      });
    }
    if (info.status === "done" && info.file === MODEL_FILE) downloaded = true;
  };
  try {
    tts = await lib.KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: report,
    });
  } catch (error) {
    console.warn("Natural voice did not load", error);
    throw {
      code: downloaded ? "unsupported" : download ? "download" : "missing",
    };
  }
  // Saving can fail when the device is short of space: say so, since it
  // would mean downloading again next time.
  if (!(await cache.match(MODEL_URL))) throw { code: "storage" };
  // A first, tiny run compiles the model, so the reader's first sentence
  // doesn't wait for it.
  await tts.generate("Hi.", { voice: "af_heart", speed: 1 });
}

// How many sounds each word has, so the shown word can follow the voice.
// Falls back to null (letters are used instead) if a word can't be read.
async function phonemeWeights(words, voice) {
  const language = voice.startsWith("b") ? "en" : "en-us";
  try {
    const weights = [];
    for (const word of words) {
      const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!clean) {
        weights.push(0);
        continue;
      }
      const sounds = (await kokoro.phonemize(clean, language)).join(" ");
      weights.push(sounds.replace(/[\sˈˌ]/g, "").length);
    }
    return weights;
  } catch {
    return null;
  }
}

async function speak({ id, text, words, voice, speed }) {
  try {
    const audio = await tts.generate(text, { voice, speed });
    // A copy, so the transfer can't detach the runtime's own memory.
    const samples = new Float32Array(audio.audio);
    const weights = await phonemeWeights(words || [], voice);
    postMessage(
      {
        type: "audio",
        id,
        samples,
        sampleRate: audio.sampling_rate,
        weights,
      },
      [samples.buffer],
    );
  } catch (error) {
    console.warn("Natural voice could not speak", error);
    postMessage({ type: "speak-error", id });
  }
}

self.onmessage = ({ data }) => {
  if (data?.type === "load") {
    // In turn: a "load" without download that finds nothing saved fails
    // with "missing", and a later one with download then fetches the model.
    const { id, download } = data;
    loading = loading
      .then(() => tts || load(!!download))
      .then(
        () => postMessage({ type: "ready", id }),
        (error) =>
          postMessage({
            type: "load-error",
            id,
            code: error?.code || "failed",
          }),
      );
  } else if (data?.type === "speak") {
    // One at a time, in the order asked.
    queue = queue.then(() =>
      tts ? speak(data) : postMessage({ type: "speak-error", id: data.id }),
    );
  }
};
