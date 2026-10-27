// Read aloud's natural voice on Cloudflare Workers: the same server as
// netlify/functions/speak.mjs (see there for what it accepts), for when the
// app is served from GitHub Pages. The OpenAI key is a Worker secret
// (OPENAI_API_KEY); nothing is stored.
//
// Netlify limited requests per reader in its function config; here the
// SPEAK_LIMIT rate-limit binding (wrangler.toml) does the same.
import { handle } from "../../netlify/functions/speak.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/speak")
      return new Response("Not found", { status: 404 });
    if (request.method === "POST" && env.SPEAK_LIMIT) {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const { success } = await env.SPEAK_LIMIT.limit({ key: ip });
      if (!success) {
        const origin = request.headers.get("origin") || "";
        return new Response(
          JSON.stringify({ error: "Too many requests. Try again in a moment." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
            },
          },
        );
      }
    }
    return handle(request, { env });
  },
};
