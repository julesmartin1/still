import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unzipEpub } from "../dist/epub.js";
import { decodeBackup } from "../dist/backup.js";
async function fixture() {
  const b = await readFile(new URL("./fixtures/ordered.epub", import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
test("EPUB central/local filename disagreement is rejected", async () => {
  const b = await fixture();
  new Uint8Array(b)[30] ^= 1;
  await assert.rejects(unzipEpub(b), /headers do not match/);
});
test("EPUB CRC corruption is detected after decompression", async () => {
  const b = await fixture(),
    v = new DataView(b);
  let i = 0;
  while (i < v.byteLength - 46 && v.getUint32(i, true) !== 0x02014b50) i++;
  v.setUint32(i + 16, 0, true);
  const zip = await unzipEpub(b);
  await assert.rejects(zip.read("META-INF/container.xml"), /integrity check/);
});
test("EPUB truncation and mutated directory boundaries fail closed", async () => {
  const b = await fixture();
  for (const n of [0, 10, 22, 100, b.byteLength - 1])
    await assert.rejects(unzipEpub(b.slice(0, n)));
  const v = new DataView(b);
  v.setUint32(b.byteLength - 22 + 12, 0xffffffff, true);
  await assert.rejects(unzipEpub(b), /damaged/);
});
test("backup limits identifiers and filters nonnumeric lookup values", () => {
  const r = {
    id: "a",
    title: "safe",
    text: "one two",
    index: 0,
    profile: { lookups: { safe: 123, bad: "script", infinite: Infinity } },
  };
  const make = () => ({
    format: "still-bookshelf",
    version: 1,
    readings: [r],
    sources: [],
  });
  assert.deepEqual(decodeBackup(make()).readings[0].profile.lookups, {
    safe: 123,
  });
  r.id = "x".repeat(201);
  assert.throws(() => decodeBackup(make()), /valid Still/);
});
test("native bundle has no remote font, remote server or unrestricted script policy", async () => {
  const css = await readFile(
    new URL("../dist/style.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /https?:\/\//);
  const config = JSON.parse(
    await readFile(new URL("../capacitor.config.json", import.meta.url)),
  );
  assert.equal(config.server.url, undefined);
  assert.deepEqual(config.server.allowNavigation, []);
  const html = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /frame-src 'none'/);
  assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/);
});
