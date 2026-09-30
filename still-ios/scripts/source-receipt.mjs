import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const ignored = new Set([
  ".git",
  "node_modules",
  "www",
  ".build",
  ".swiftpm",
  "public",
  "xcuserdata",
]);
const files = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(e.name)) continue;
    const p = dir + "/" + e.name;
    if (e.isDirectory()) await walk(p);
    else if (!p.endsWith(".DS_Store")) files.push(p);
  }
}
await walk(".");
files.sort();
const digest = createHash("sha256");
for (const p of files) digest.update(p).update(await readFile(p));
await writeFile(
  "../app-store-release/evidence/source-receipt.json",
  JSON.stringify(
    { time: new Date().toISOString(), sha256: digest.digest("hex"), files },
    null,
    2,
  ),
);
