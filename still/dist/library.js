import {
  native,
  nativeGet,
  nativeList,
  nativeCommit,
  encodeSource,
  decodeSource,
} from "./native-runtime.js";
// Same-device library. No reading content leaves this origin.
let database;
function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("still-library-v1", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("readings"))
          db.createObjectStore("readings", { keyPath: "id" });
        if (!db.objectStoreNames.contains("summaries"))
          db.createObjectStore("summaries", { keyPath: "id" });
        if (!db.objectStoreNames.contains("sources"))
          db.createObjectStore("sources", { keyPath: "id" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        database = null;
        reject(request.error);
      };
      request.onblocked = () => {
        database = null;
        reject(
          new Error(
            "Library is open in another tab. Reload Still and try again.",
          ),
        );
      };
    });
  return database;
}
export function readingSummary(record) {
  const { id, title, index, wordCount, updatedAt, finished } = record;
  return {
    id,
    title,
    index,
    wordCount,
    updatedAt,
    finished: !!finished,
    ...(record.shelfState ? { shelfState: record.shelfState } : {}),
  };
}
export async function saveReading(record) {
  if (!record.id || typeof record.text !== "string" || !record.text.trim())
    throw Error("A reading must contain text.");
  if (native)
    return nativeCommit([
      ["reading:" + record.id, record],
      ["summary:" + record.id, readingSummary(record)],
    ]);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["readings", "summaries"], "readwrite");
    tx.objectStore("readings").put(record);
    tx.objectStore("summaries").put(readingSummary(record));
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || Error("Could not save reading."));
  });
}
async function readStore(store, key) {
  if (native) {
    const prefix = {
      readings: "reading:",
      summaries: "summary:",
      sources: "source:",
    }[store];
    const result =
      key === undefined
        ? await nativeList(prefix)
        : await nativeGet(prefix + key);
    return store === "sources"
      ? Array.isArray(result)
        ? result.map(decodeSource)
        : decodeSource(result)
      : result;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request =
      key === undefined
        ? tx.objectStore(store).getAll()
        : tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function listReadings() {
  return (await readStore("summaries")).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}
export const getReading = (id) => readStore("readings", id);

export const getSource = (id) => readStore("sources", id);
export async function saveSource(id, source) {
  if (native)
    return nativeCommit([
      ["source:" + id, await encodeSource({ id, ...source })],
    ]);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sources", "readwrite");
    tx.objectStore("sources").put({ id, ...source });
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || Error("Could not save original PDF."));
  });
}

export async function librarySnapshot() {
  if (native)
    return {
      readings: await readStore("readings"),
      sources: await readStore("sources"),
    };
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["readings", "sources"], "readonly");
    const readings = tx.objectStore("readings").getAll(),
      sources = tx.objectStore("sources").getAll();
    tx.oncomplete = () =>
      resolve({ readings: readings.result, sources: sources.result });
    tx.onerror = tx.onabort = () =>
      reject(tx.error || Error("Could not read bookshelf."));
  });
}
// Restore in one transaction. Existing IDs are preserved; conflicting readings become copies.
export async function restoreLibrary(bundle) {
  if (native) {
    const ids = new Set((await listReadings()).map((r) => r.id)),
      mapping = new Map(),
      writes = [];
    for (const r of bundle.readings) {
      const id = ids.has(r.id) ? crypto.randomUUID() : r.id;
      mapping.set(r.id, id);
      const record = {
        ...r,
        id,
        title: ids.has(r.id) ? r.title + " (restored copy)" : r.title,
      };
      writes.push(
        ["reading:" + id, record],
        ["summary:" + id, readingSummary(record)],
      );
    }
    for (const s of bundle.sources) {
      const id = mapping.get(s.id);
      writes.push(["source:" + id, await encodeSource({ ...s, id })]);
    }
    await nativeCommit(writes);
    return bundle.readings.length;
  }
  const db = await openDatabase();
  const existing = await listReadings();
  const ids = new Set(existing.map((r) => r.id)),
    mapping = new Map();
  const readings = bundle.readings.map((r) => {
    const id = ids.has(r.id) ? crypto.randomUUID() : r.id;
    mapping.set(r.id, id);
    return {
      ...r,
      id,
      title: ids.has(r.id) ? r.title + " (restored copy)" : r.title,
    };
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["readings", "summaries", "sources"],
      "readwrite",
    );
    for (const r of readings) {
      tx.objectStore("readings").put(r);
      tx.objectStore("summaries").put(readingSummary(r));
    }
    for (const source of bundle.sources)
      tx.objectStore("sources").put({ ...source, id: mapping.get(source.id) });
    tx.oncomplete = () => resolve(readings.length);
    tx.onabort = tx.onerror = () =>
      reject(tx.error || Error("Restore failed; no readings were added."));
  });
}

export async function setShelfState(id, state) {
  const r = await getReading(id);
  if (!r) throw Error("Reading not found.");
  await saveReading({ ...r, shelfState: state, updatedAt: Date.now() });
}
export async function deleteReading(id) {
  if (native)
    return nativeCommit([], ["reading:" + id, "summary:" + id, "source:" + id]);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["readings", "summaries", "sources"],
      "readwrite",
    );
    for (const name of ["readings", "summaries", "sources"])
      tx.objectStore(name).delete(id);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(Error("Deletion could not finish."));
  });
}
export async function eraseLibrary() {
  if (native) {
    const records = await listReadings();
    return nativeCommit(
      [],
      records.flatMap((r) => [
        "reading:" + r.id,
        "summary:" + r.id,
        "source:" + r.id,
      ]),
    );
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["readings", "summaries", "sources"],
      "readwrite",
    );
    for (const name of ["readings", "summaries", "sources"])
      tx.objectStore(name).clear();
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(Error("Erasing could not finish."));
  });
}

// IDs of readings whose text contains `query` (case-insensitive).
// Scans one reading at a time so a large shelf never sits in memory at once.
export async function searchReadingText(query) {
  const needle = query.trim().toLocaleLowerCase();
  const found = new Set();
  if (needle.length < 2) return found;
  if (native) {
    for (const r of await nativeList("reading:"))
      if (r?.text?.toLocaleLowerCase().includes(needle)) found.add(r.id);
    return found;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("readings", "readonly")
      .objectStore("readings")
      .openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(found);
      if (cursor.value.text?.toLocaleLowerCase().includes(needle))
        found.add(cursor.value.id);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
