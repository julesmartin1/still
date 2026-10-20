import test from "node:test";
import assert from "node:assert/strict";
import { record, report } from "./visits.mjs";

const memoryStore = () => {
  const data = new Map();
  return {
    data,
    get: async (key) => (data.has(key) ? JSON.parse(data.get(key)) : null),
    setJSON: async (key, value) => data.set(key, JSON.stringify(value)),
  };
};

test("visits are counted per day, with first-time visits apart", async () => {
  const store = memoryStore();
  const today = new Date("2026-10-20T09:00:00Z");
  await record(store, { first: true }, today);
  await record(store, {}, today);
  await record(store, {}, new Date("2026-10-19T23:59:00Z"));
  assert.deepEqual(JSON.parse(store.data.get("2026-10-20")), {
    visits: 2,
    first: 1,
  });
  assert.deepEqual(JSON.parse(store.data.get("2026-10-19")), {
    visits: 1,
    first: 0,
  });
  // Only the two counts are stored.
  assert.deepEqual([...store.data.keys()].sort(), ["2026-10-19", "2026-10-20"]);
});

test("the report lists recent days newest first with totals", async () => {
  const store = memoryStore();
  const today = new Date("2026-10-20T09:00:00Z");
  await record(store, { first: true }, today);
  await record(store, {}, new Date("2026-10-18T12:00:00Z"));
  const text = await report(store, 3, today);
  assert.match(text, /2 visits, 1 from people opening Still for the first time/);
  const days = text.trim().split("\n").slice(-3);
  assert.match(days[0], /^2026-10-20\s+1 visits\s+1 new$/);
  assert.match(days[1], /^2026-10-19\s+0 visits\s+0 new$/);
  assert.match(days[2], /^2026-10-18\s+1 visits\s+0 new$/);
});
