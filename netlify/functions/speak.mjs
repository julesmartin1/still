// Read aloud's natural voice: turns one short chunk of a reading (a sentence
// or two) into speech with OpenAI's text-to-speech and returns it as MP3.
// The API key stays here, on Netlify (OPENAI_API_KEY); nothing is stored.
//
// It only serves this site's own pages (and the same app on GitHub Pages), takes small chunks of text, a fixed
// set of voices, and a limited number of requests a minute from each reader,
// so the key can't be used as a general-purpose voice service.
export const VOICES = ["marin", "cedar", "coral", "sage"];
export const MAX_CHARS = 1200;
// Newest first; the next one is tried if OpenAI doesn't offer a model (yet,
// or any more). OPENAI_TTS_MODEL overrides the first choice.
export const MODELS = ["gpt-4o-mini-tts-2025-12-15", "gpt-4o-mini-tts"];
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
// The app's other home, which calls this site across origins.
export const OTHER_ORIGINS = ["https://julesmartin1.github.io"];

// How the voice should read: like an unhurried audiobook narrator, a little
// slower or quicker to match the reader's pace, and in one even voice: left
// to itself the voice acts out quoted speech in other voices, which sounds
// odd when the words are read a sentence at a time.
export function readingInstructions(speed) {
  const pace =
    speed <= 0.85
      ? "Speak slowly, with clear gaps between sentences."
      : speed >= 1.2
        ? "Speak at a brisk but clear pace."
        : "Speak at a calm, steady pace.";
  return `Read this aloud like a warm, unhurried audiobook narrator. ${pace} Keep the same voice and tone from one sentence to the next. Read dialogue and quoted words in that same narrator voice: don't act out characters or change your voice for them. Read only the words; never say punctuation, such as quotation marks, aloud.`;
}

const reply = (status, message, cors = {}) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors,
    },
  });

// Whether a page at this origin may use the voice: this site's own pages
// (including its deploy previews, which share the host) or OTHER_ORIGINS.
function allowedOrigin(origin, requestUrl) {
  if (!origin) return false;
  if (OTHER_ORIGINS.includes(origin)) return true;
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

export async function handle(
  request,
  { env = {}, fetch: fetcher = fetch } = {},
) {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigin(origin, request.url);
  const cors =
    allowed && OTHER_ORIGINS.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
  // The browser's check before a cross-origin POST.
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: allowed ? 204 : 403,
      headers: allowed
        ? {
            ...cors,
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
          }
        : {},
    });
  // A GET asks whether the voice is set up here, without using it.
  if (request.method === "GET")
    return new Response(null, {
      status: env.OPENAI_API_KEY ? 204 : 503,
      headers: { "Cache-Control": "no-store", ...cors },
    });
  if (request.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, POST, OPTIONS" },
    });
  // Browsers always say where a POST comes from.
  if (!allowed) return reply(403, "Not allowed from here.");
  const key = env.OPENAI_API_KEY;
  if (!key)
    return reply(503, "The natural voice isn't set up on this site.", cors);
  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, "Expected JSON.", cors);
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_CHARS)
    return reply(400, `Send between 1 and ${MAX_CHARS} characters.`, cors);
  const voice = VOICES.includes(body.voice) ? body.voice : VOICES[0];
  const speed = Math.min(1.5, Math.max(0.6, Number(body.speed) || 1));
  const models = [
    ...new Set([env.OPENAI_TTS_MODEL, ...MODELS].filter(Boolean)),
  ];
  let upstream = null;
  for (const model of models) {
    // The speed option isn't honoured by every model; the instructions carry
    // the pace too, and a request is retried without it if it's refused.
    for (const withSpeed of [true, false]) {
      try {
        upstream = await fetcher(SPEECH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            voice,
            input: text,
            instructions: readingInstructions(speed),
            response_format: "mp3",
            ...(withSpeed ? { speed } : {}),
          }),
        });
      } catch {
        return reply(502, "The voice service couldn't be reached.", cors);
      }
      if (upstream.ok || upstream.status !== 400) break;
    }
    if (upstream.ok || ![400, 404].includes(upstream.status)) break;
  }
  if (!upstream.ok)
    return reply(
      upstream.status === 429 ? 429 : 502,
      upstream.status === 429
        ? "The voice service is busy. Try again in a moment."
        : "The voice service couldn't read this.",
      cors,
    );
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}

export default (request) => handle(request, { env: process.env });

export const config = {
  path: "/api/speak",
  // About one request every two seconds is plenty to read aloud at any pace.
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
