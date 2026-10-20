import { test } from "node:test";
import assert from "node:assert/strict";
import { screenAwake } from "../dist/screen-awake.js";

// A fake Screen Wake Lock and document.
function fakes({ refuse = false } = {}) {
  const locks = [];
  const wakeLock = {
    async request(type) {
      assert.equal(type, "screen");
      if (refuse) throw Error("NotAllowedError");
      const listeners = [];
      const lock = {
        released: false,
        addEventListener: (name, fn) => listeners.push(fn),
        async release() {
          if (lock.released) return;
          lock.released = true;
          listeners.forEach((fn) => fn());
        },
      };
      locks.push(lock);
      return lock;
    },
  };
  const handlers = [];
  const doc = {
    hidden: false,
    addEventListener: (name, fn) =>
      name === "visibilitychange" && handlers.push(fn),
    setHidden(hidden) {
      this.hidden = hidden;
      handlers.forEach((fn) => fn());
    },
  };
  return { wakeLock, doc, locks };
}

test("holds the screen on while wanted and lets it go after", async () => {
  const f = fakes();
  const awake = screenAwake(f);
  assert.equal(awake.supported, true);
  await awake.set(true);
  assert.equal(awake.held, true);
  await awake.set(true); // asking again doesn't stack locks
  assert.equal(f.locks.length, 1);
  await awake.set(false);
  assert.equal(awake.held, false);
  assert.equal(f.locks[0].released, true);
});

test("asks again when the page comes back, only if still wanted", async () => {
  const f = fakes();
  const awake = screenAwake(f);
  await awake.set(true);
  // The browser drops the lock when the page is hidden.
  await f.locks[0].release();
  f.doc.setHidden(true);
  assert.equal(awake.held, false);
  f.doc.setHidden(false);
  await new Promise((r) => setTimeout(r));
  assert.equal(awake.held, true);
  assert.equal(f.locks.length, 2);
  await awake.set(false);
  f.doc.setHidden(true);
  f.doc.setHidden(false);
  await new Promise((r) => setTimeout(r));
  assert.equal(f.locks.length, 2);
});

test("a lock granted after reading stopped is let go at once", async () => {
  const f = fakes();
  const awake = screenAwake(f);
  const asked = awake.set(true);
  await awake.set(false);
  await asked;
  assert.equal(awake.held, false);
  assert.equal(f.locks[0].released, true);
});

test("without the API, or when refused, reading carries on", async () => {
  const none = screenAwake({ wakeLock: undefined, doc: fakes().doc });
  assert.equal(none.supported, false);
  await none.set(true);
  assert.equal(none.held, false);
  const refused = screenAwake(fakes({ refuse: true }));
  await refused.set(true);
  assert.equal(refused.held, false);
});
