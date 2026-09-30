import { cleanWord } from "./engine.js";
const cache = new Map();
export function candidateForms(word) {
  const w = cleanWord(word),
    forms = [w];
  if (w.endsWith("'s")) forms.push(w.slice(0, -2));
  if (w.endsWith("ies")) forms.push(w.slice(0, -3) + "y");
  if (w.endsWith("s")) forms.push(w.slice(0, -1));
  if (w.endsWith("es")) forms.push(w.slice(0, -2));
  if (w.endsWith("ing")) {
    const stem = w.slice(0, -3);
    forms.push(stem, stem + "e");
    if (stem.at(-1) === stem.at(-2)) forms.push(stem.slice(0, -1));
  }
  if (w.endsWith("ed")) {
    const stem = w.slice(0, -2);
    forms.push(stem, stem + "e");
    if (stem.at(-1) === stem.at(-2)) forms.push(stem.slice(0, -1));
  }
  return [...new Set(forms)];
}
export async function lookupWord(word) {
  for (const form of candidateForms(word)) {
    const letter = form[0];
    if (!/^[a-z]$/.test(letter || "")) continue;
    let entries = cache.get(letter);
    if (!entries) {
      const response = await fetch("./dictionary/" + letter + ".json");
      if (!response.ok) throw Error("Dictionary could not load");
      entries = await response.json();
      cache.set(letter, entries);
    }
    if (Object.hasOwn(entries, form))
      return { word: form, meanings: entries[form] };
  }
  return null;
}
