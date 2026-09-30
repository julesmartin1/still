// Keeps the reader code shared between the web app (still/) and the iOS app
// (still-ios/) identical.
//
//   node scripts/sync-shared.mjs          copy shared files still/ -> still-ios/
//   node scripts/sync-shared.mjs --check  fail if any shared file differs
//
// Edit shared files in still/dist and still/tests, then run the sync.
// Per-platform files are listed in PLATFORM_ONLY and are never copied.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "still");
const ios = join(root, "still-ios");

// Paths relative to each package that differ on purpose.
const PLATFORM_ONLY = new Set([
  "dist/native-runtime.js", // localStorage/IndexedDB on web, native vault on iOS
  "dist/offline-assets.js", // generated per package by offline-assets.mjs
  "tests/native-adapter.test.mjs", // iOS-only (exercises the native vault)
]);
const SHARED_DIRS = ["dist", "tests"];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const check = process.argv.includes("--check");
const different = [];
let copied = 0;
for (const dir of SHARED_DIRS) {
  for (const file of await walk(join(web, dir))) {
    const rel = relative(web, file);
    if (PLATFORM_ONLY.has(rel)) continue;
    const target = join(ios, rel);
    const source = await readFile(file);
    let current = null;
    try {
      current = await readFile(target);
    } catch {}
    if (current && Buffer.compare(source, current) === 0) continue;
    if (check) different.push(rel);
    else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
      copied++;
    }
  }
}
if (check) {
  if (different.length) {
    console.error(
      "Shared files differ between still/ and still-ios/:\n  " +
        different.join("\n  ") +
        "\nEdit them in still/ and run: node scripts/sync-shared.mjs",
    );
    process.exit(1);
  }
  console.log("Shared web and iOS files are identical.");
} else console.log(`Synced ${copied} shared file(s) from still/ to still-ios/.`);
