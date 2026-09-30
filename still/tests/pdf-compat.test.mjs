import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../dist/pdf-compat.js";

test("Map and WeakMap upsert helpers behave like the proposal", () => {
  const map = new Map([["a", 1]]);
  let calls = 0;
  assert.equal(
    map.getOrInsertComputed("a", () => ++calls),
    1,
  );
  assert.equal(
    map.getOrInsertComputed("b", (k) => (++calls, k + "!")),
    "b!",
  );
  assert.equal(map.get("b"), "b!");
  assert.equal(calls, 1);
  assert.equal(map.getOrInsert("c", 3), 3);
  assert.equal(map.getOrInsert("c", 4), 3);
  const key = {};
  const weak = new WeakMap();
  assert.equal(
    weak.getOrInsertComputed(key, () => 7),
    7,
  );
  assert.equal(weak.getOrInsert(key, 8), 7);
});

test("Promise.try runs sync callbacks and captures throws", async () => {
  assert.equal(await Promise.try((a, b) => a + b, 2, 3), 5);
  await assert.rejects(
    Promise.try(() => {
      throw Error("boom");
    }),
    /boom/,
  );
});

test("Math.sumPrecise, base64 and hex helpers", () => {
  assert.equal(Math.sumPrecise([1, 2, 3]), 6);
  assert.equal(Math.sumPrecise([1e20, 0.1, -1e20]), 0.1);
  const bytes = new Uint8Array([0, 15, 255, 128]);
  assert.equal(bytes.toHex(), "000fff80");
  assert.deepEqual([...Uint8Array.fromHex("000fff80")], [...bytes]);
  assert.deepEqual([...Uint8Array.fromBase64(bytes.toBase64())], [...bytes]);
  const buffer = new Uint8Array([1, 2, 3, 4]).buffer.transferToFixedLength(2);
  assert.deepEqual([...new Uint8Array(buffer)], [1, 2]);
});

test("every direct PDF.js dependency on a recent built-in is covered", async () => {
  // If PDF.js is upgraded and starts calling another new built-in, add a
  // shim to pdf-compat.js and list it here.
  const shimmed = [
    "getOrInsertComputed",
    "getOrInsert",
    "Promise.try",
    "Promise.withResolvers",
    "sumPrecise",
    "toBase64",
    "fromBase64",
    "toHex",
    "transferToFixedLength",
  ];
  const source = await readFile(
    new URL("../dist/pdf-compat.js", import.meta.url),
    "utf8",
  );
  for (const name of shimmed)
    assert.ok(source.includes(`"${name.split(".").at(-1)}"`), name);
});
