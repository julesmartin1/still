// How a single word is placed and brought on screen.
//
// Placement: readers recognise a word fastest when the eye lands slightly
// left of its centre (the "optimal viewing position"). In focus mode the
// letter at that point sits exactly under the reader's fixation marks, so
// the eye never has to re-find the word as lengths change. Centred mode
// keeps the original behaviour.
//
// Change: an instant swap gives each word a hard onset (the "pop"). A soft
// change fades the word in over a few frames. It is kept very short because
// a word needs roughly its first 50-60 ms of clear view to be recognised;
// a longer fade would eat into that time at faster speeds. Two words are
// never shown on top of each other (no cross-fade), since overlapping words
// mask each other.

// Index of the focus letter for a word, counted in letters (1-based length).
// Short words: 2nd letter; grows to about a third of the way in.
export function focusLetter(letters) {
  if (letters <= 1) return 0;
  if (letters <= 5) return 1;
  if (letters <= 9) return 2;
  if (letters <= 13) return 3;
  return 4;
}

// Splits a word into [before, focus, after] around its focus character,
// ignoring leading punctuation such as quotes when counting letters.
export function splitAtFocus(word) {
  const chars = Array.from(word); // keeps emoji and surrogate pairs whole
  const letterPositions = [];
  chars.forEach((c, i) => {
    if (/[\p{L}\p{N}]/u.test(c)) letterPositions.push(i);
  });
  if (!letterPositions.length) return ["", word, ""];
  const at = letterPositions[focusLetter(letterPositions.length)];
  return [
    chars.slice(0, at).join(""),
    chars[at],
    chars.slice(at + 1).join(""),
  ];
}

// Length of the soft fade for a word shown for `wordMs` milliseconds:
// 12% of the word's time, between 12 and 40 ms (1-2 frames at 60 Hz).
export function fadeDuration(wordMs) {
  if (!Number.isFinite(wordMs) || wordMs <= 0) return 0;
  return Math.round(Math.min(40, Math.max(12, wordMs * 0.12)));
}

// Repeated words ("that that", "had had"): swapping a word for itself shows
// no change, so the reader can't see that a second word went by. The repeat
// starts with a blank moment, taken from its own time so the pace is
// unchanged: a quarter of the word's time, between 40 and 90 ms (two to
// five frames, enough to see), and never more than half of it, so the word
// keeps the clear view it needs to be read.
export function repeatGap(previous, word, wordMs) {
  if (!word || word !== previous) return 0;
  if (!Number.isFinite(wordMs) || wordMs <= 0) return 0;
  return Math.round(Math.min(90, Math.max(40, wordMs * 0.25), wordMs / 2));
}
