// Keeps the screen on while words play, so a phone doesn't dim and lock in
// the middle of a sentence. Uses the Screen Wake Lock API where the browser
// has it (Safari 16.4+, Chrome, Edge); elsewhere it quietly does nothing.
//
// The browser drops the lock whenever the page is hidden, so it is asked for
// again when the page comes back while reading is still meant to keep it.
export function screenAwake({
  wakeLock = globalThis.navigator?.wakeLock,
  doc = globalThis.document,
} = {}) {
  let wanted = false,
    sentinel = null,
    asking = null;
  const supported = !!wakeLock && typeof wakeLock.request === "function";
  async function acquire() {
    if (!supported || sentinel || asking || doc?.hidden) return;
    asking = wakeLock
      .request("screen")
      .then((lock) => {
        if (!wanted) return lock.release().catch(() => {});
        sentinel = lock;
        lock.addEventListener?.("release", () => {
          if (sentinel === lock) sentinel = null;
        });
      })
      // Refused (low battery, no permission, not visible): read without it.
      .catch(() => {})
      .finally(() => (asking = null));
    return asking;
  }
  function release() {
    const lock = sentinel;
    sentinel = null;
    return lock?.release().catch(() => {});
  }
  doc?.addEventListener?.("visibilitychange", () => {
    if (wanted && !doc.hidden) acquire();
  });
  return {
    supported,
    get held() {
      return !!sentinel;
    },
    // Ask for the screen to stay on (true) or let it sleep again (false).
    set(on) {
      wanted = !!on;
      return wanted ? acquire() : release();
    },
  };
}
