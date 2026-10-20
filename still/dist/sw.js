importScripts("./offline-assets.js");
const CACHE = "still-offline-" + self.STILL_VERSION;
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(
        self.STILL_ASSETS.filter(
          (p) => !p.includes("/dictionary/") && !p.includes("/vendor/"),
        ),
      );
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      // Each release has its own cache; delete older ones so storage does
      // not grow by the full app size (about 16 MB offline) per update.
      for (const name of await caches.keys())
        if (name.startsWith("still-offline-") && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // The natural voice's server function is never cached.
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok && !response.redirected)
          await cache.put(event.request, response.clone());
        return response;
      } catch {
        const cached =
          (await cache.match(event.request)) ||
          (await caches.match(event.request));
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const shell = await cache.match("./index.html");
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "prepare") return;
  event.waitUntil(
    (async () => {
      const port = event.ports[0];
      try {
        const cache = await caches.open(CACHE);
        let count = 0;
        for (let i = 0; i < self.STILL_ASSETS.length; i += 6) {
          await Promise.all(
            self.STILL_ASSETS.slice(i, i + 6).map(async (path) => {
              const response = await fetch(path, { cache: "reload" });
              if (!response.ok || response.redirected)
                throw Error("Unavailable");
              await cache.put(path, response);
              count++;
            }),
          );
          port.postMessage({ count, total: self.STILL_ASSETS.length });
        }
        port.postMessage({ done: true });
      } catch {
        port.postMessage({ error: true });
      }
    })(),
  );
});
