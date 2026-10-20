// A privacy-friendly visit counter for the web app.
//
//   POST /api/visit   counts one visit (the app sends this once per tab)
//   GET  /api/visit   shows daily totals for the last 30 days
//
// Counts live in a Netlify Blobs store on this site, so nothing goes to a
// third party, and only two numbers are kept per day.
import { getStore } from "@netlify/blobs";
import { record, report } from "../visits.mjs";

export default async (request) => {
  const store = getStore("visits");
  if (request.method === "POST") {
    let first = false;
    try {
      first = (await request.json()).first === true;
    } catch {}
    await record(store, { first });
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET")
    return new Response(await report(store), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/visit" };
