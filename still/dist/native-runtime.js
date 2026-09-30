// Web build of the storage runtime.
//
// The iOS app ships its own native-runtime.js (still-ios/dist/native-runtime.js)
// that stores everything in the protected native vault through Capacitor.
// Every other file in dist/ is shared between the web and iOS builds and kept
// identical by scripts/sync-shared.mjs at the repository root. Shared code only
// uses the exports below and checks `native` before calling native-only APIs.

export const native = false;

export async function initializeStorage() {}

export const storage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

export const flushStorage = () => Promise.resolve();

export async function exportFile(payload) {
  const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download =
    "still-bookshelf-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const nativeOnly = () => {
  throw Error("Native storage is only available in the iOS app.");
};
export const nativeGet = nativeOnly;
export const nativeList = nativeOnly;
export const nativeCommit = nativeOnly;
export const encodeSource = nativeOnly;
export const decodeSource = nativeOnly;
