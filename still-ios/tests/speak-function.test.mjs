// The server side of read aloud's natural voice (netlify/functions/speak.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handle,
  config,
  MAX_CHARS,
  MODELS,
  readingInstructions,
} from "../../netlify/functions/speak.mjs";

const SITE = "https://still123.netlify.app";
const ask = (body, { origin = SITE, method = "POST" } = {}) =>
  new Request(SITE + "/api/speak", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
// A fake OpenAI that answers each call with the next status.
function openai(...statuses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, body: JSON.parse(init.body) });
    const status = statuses[Math.min(calls.length, statuses.length) - 1];
    return new Response(status === 200 ? "mp3" : "{}", { status });
  };
  return { calls, fetch };
}
const env = { OPENAI_API_KEY: "sk-test" };

test("speaks a chunk with the chosen voice and returns MP3", async () => {
  const api = openai(200);
  const response = await handle(
    ask({ text: " Hello there. ", voice: "cedar", speed: 1.1 }),
    { env, fetch: api.fetch },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(await response.text(), "mp3");
  const call = api.calls[0];
  assert.equal(call.url, "https://api.openai.com/v1/audio/speech");
  assert.equal(call.headers.Authorization, "Bearer sk-test");
  assert.equal(call.body.model, MODELS[0]);
  assert.equal(call.body.voice, "cedar");
  assert.equal(call.body.input, "Hello there.");
  assert.equal(call.body.speed, 1.1);
  assert.equal(call.body.response_format, "mp3");
  assert.match(call.body.instructions, /audiobook/);
});

test("only this site's pages may use it, and only by POST", async () => {
  const api = openai(200);
  for (const origin of [null, "https://elsewhere.example"]) {
    const response = await handle(ask({ text: "Hi." }, { origin }), {
      env,
      fetch: api.fetch,
    });
    assert.equal(response.status, 403);
  }
  const put = await handle(ask(null, { method: "PUT" }), {
    env,
    fetch: api.fetch,
  });
  assert.equal(put.status, 405);
  assert.equal(api.calls.length, 0);
});

test("small chunks, known voices and sane speeds only", async () => {
  const api = openai(200);
  const status = async (body) =>
    (await handle(ask(body), { env, fetch: api.fetch })).status;
  assert.equal(await status({ text: "" }), 400);
  assert.equal(await status({ text: "x".repeat(MAX_CHARS + 1) }), 400);
  assert.equal(await status({ text: 42 }), 400);
  assert.equal(api.calls.length, 0);
  assert.equal(await status({ text: "Hi.", voice: "nope", speed: 9 }), 200);
  assert.equal(api.calls[0].body.voice, "marin");
  assert.equal(api.calls[0].body.speed, 1.5);
});

test("a GET says whether the voice is set up, without using it", async () => {
  const api = openai(200);
  const probe = (env) =>
    handle(ask(null, { method: "GET", origin: null }), {
      env,
      fetch: api.fetch,
    });
  assert.equal((await probe(env)).status, 204);
  assert.equal((await probe({})).status, 503);
  assert.equal(api.calls.length, 0);
});

test("without a key it says the voice isn't set up", async () => {
  const api = openai(200);
  const response = await handle(ask({ text: "Hi." }), {
    env: {},
    fetch: api.fetch,
  });
  assert.equal(response.status, 503);
  assert.equal(api.calls.length, 0);
});

test("a refused speed is dropped and a missing model falls back", async () => {
  let api = openai(400, 200);
  let response = await handle(ask({ text: "Hi.", speed: 0.7 }), {
    env,
    fetch: api.fetch,
  });
  assert.equal(response.status, 200);
  assert.equal(api.calls[0].body.speed, 0.7);
  assert.equal("speed" in api.calls[1].body, false);
  assert.match(api.calls[1].body.instructions, /slowly/);

  api = openai(404, 200);
  response = await handle(ask({ text: "Hi." }), { env, fetch: api.fetch });
  assert.equal(response.status, 200);
  assert.deepEqual(
    api.calls.map((c) => c.body.model),
    MODELS.slice(0, 2),
  );

  // OPENAI_TTS_MODEL picks the model to try first.
  api = openai(200);
  await handle(ask({ text: "Hi." }), {
    env: { ...env, OPENAI_TTS_MODEL: "some-new-tts" },
    fetch: api.fetch,
  });
  assert.equal(api.calls[0].body.model, "some-new-tts");
});

test("upstream trouble is reported, never passed through", async () => {
  let response = await handle(ask({ text: "Hi." }), {
    env,
    fetch: openai(429).fetch,
  });
  assert.equal(response.status, 429);
  response = await handle(ask({ text: "Hi." }), {
    env,
    fetch: openai(500).fetch,
  });
  assert.equal(response.status, 502);
  response = await handle(ask({ text: "Hi." }), {
    env,
    fetch: async () => {
      throw new TypeError("network down");
    },
  });
  assert.equal(response.status, 502);
});

test("served at /api/speak with a per-reader rate limit", () => {
  assert.equal(config.path, "/api/speak");
  assert.ok(config.rateLimit.windowLimit > 0);
  assert.ok(config.rateLimit.windowSize <= 180);
  assert.deepEqual(config.rateLimit.aggregateBy, ["ip", "domain"]);
  assert.match(readingInstructions(1), /steady/);
  assert.match(readingInstructions(1.3), /brisk/);
  // Quoted speech in the narrator's own voice, with no marks read out.
  assert.match(readingInstructions(1), /same narrator voice/);
  assert.match(readingInstructions(1), /never say punctuation/);
});
