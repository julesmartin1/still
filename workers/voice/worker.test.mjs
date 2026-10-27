// The Cloudflare Worker wrapper around the voice server (worker.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

const PAGES = "https://julesmartin1.github.io";
const ask = (path = "/api/speak", method = "POST") =>
  new Request("https://still-voice.example.workers.dev" + path, {
    method,
    headers: { "Content-Type": "application/json", Origin: PAGES },
    body: method === "POST" ? JSON.stringify({ text: "Hi." }) : undefined,
  });
const limit = (success) => ({ limit: async () => ({ success }) });

test("answers only at /api/speak", async () => {
  const response = await worker.fetch(ask("/other", "GET"), {});
  assert.equal(response.status, 404);
});

test("says whether the voice is set up, with CORS for the Pages app", async () => {
  const on = await worker.fetch(ask("/api/speak", "GET"), {
    OPENAI_API_KEY: "sk-test",
  });
  assert.equal(on.status, 204);
  assert.equal(on.headers.get("access-control-allow-origin"), PAGES);
  const off = await worker.fetch(ask("/api/speak", "GET"), {});
  assert.equal(off.status, 503);
});

test("turns away a reader over the rate limit before calling OpenAI", async () => {
  const response = await worker.fetch(ask(), {
    OPENAI_API_KEY: "sk-test",
    SPEAK_LIMIT: limit(false),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("access-control-allow-origin"), PAGES);
});
