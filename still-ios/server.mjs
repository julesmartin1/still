import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("www");
http
  .createServer(async (req, res) => {
    try {
      const path = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (path !== root && !path.startsWith(root + "/")) throw Error();
      const file = path === root ? path + "/index.html" : path;
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".wasm": "application/wasm",
          ".json": "application/json",
        }[extname(file)] || "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  })
  .listen(4174, "127.0.0.1", () =>
    console.log("Still is running at http://127.0.0.1:4174"),
  );
