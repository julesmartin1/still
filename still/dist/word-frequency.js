// How common each word is, for timing (see engine.wordWeight). One list per
// language in frequency/<lang>.txt, from wordfreq (see frequency/README.txt):
// each line is a Zipf value in tenths, then the words with that value.
// A list is loaded once, when a reading in its language is opened.
export const FREQUENCY_LANGUAGES = ["en", "fr", "es", "de", "it", "pt", "nl"];

export function parseFrequencies(text) {
  const zipf = new Map();
  for (const line of String(text).split("\n")) {
    const [band, ...words] = line.trim().split(" ");
    const value = Number(band) / 10;
    if (!Number.isFinite(value)) continue;
    for (const word of words) if (!zipf.has(word)) zipf.set(word, value);
  }
  return zipf;
}

// The lookup engine.wordWeight takes: a word as engine.cleanWord leaves it
// (lower case, outer punctuation gone) to its Zipf value, or undefined.
export function frequencyLookup(zipf) {
  return (norm) => {
    const word = String(norm).replace(/[’‘]/g, "'");
    return (
      zipf.get(word) ??
      (/'s$/.test(word) ? zipf.get(word.slice(0, -2)) : undefined)
    );
  };
}

const loaded = new Map(); // lang → Promise of a lookup, or null
// The lookup for a language, or null when there is no list for it (or it
// could not load; timing then falls back to word length alone).
export function loadFrequencies(lang, fetcher = (...a) => globalThis.fetch(...a)) {
  lang = String(lang || "").toLowerCase().split(/[-_]/)[0];
  if (!FREQUENCY_LANGUAGES.includes(lang)) return Promise.resolve(null);
  if (!loaded.has(lang))
    loaded.set(
      lang,
      Promise.resolve()
        .then(() => fetcher(`./frequency/${lang}.txt`))
        .then((response) => {
          if (!response.ok) throw Error("Word list could not load");
          return response.text();
        })
        .then((text) => frequencyLookup(parseFrequencies(text)))
        .catch(() => {
          loaded.delete(lang); // try again next time
          return null;
        }),
    );
  return loaded.get(lang);
}
