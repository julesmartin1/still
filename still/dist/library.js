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
