// Find my pace: three short passages at different speeds, each followed by
// "how did that feel?". Nothing is graded; the reader's own sense of comfort
// sets the starting pace, and the usual adjustments carry on from there.
//
// Speeds adapt: comfortable -> try faster; a bit fast -> ease back a little;
// too fast -> ease back more. The result is the fastest pace that felt
// comfortable, or just under the slowest one that felt fast.

export const PASSAGES = [
  "The ferry left at seven, and by the time it cleared the harbour the town had shrunk to a row of pale houses under the hill. Gulls followed for a while, then gave up. On deck, people stopped talking and simply watched the water change colour as the morning came on.",
  "Most cities grow by accident. A crossing point on a river becomes a market, the market needs a wall, and the wall decides where the streets will run for the next five hundred years. Planners arrive much later, and usually find that the most important decisions were made long before them.",
  "She kept a notebook for things she noticed but did not understand: why the bus was always late on Tuesdays, why her neighbour whistled only in the rain. Most of the questions were never answered. That was not the point. Writing them down made the ordinary days feel slightly less ordinary.",
];

export const START = 250;
export const MIN = 120;
export const MAX = 600;

const clampPace = (n) => Math.min(MAX, Math.max(MIN, Math.round(n / 10) * 10));

// history: [{ wpm, feel: "comfortable" | "fast" | "too-fast" }]
export function nextPace(history) {
  if (!history.length) return START;
  const last = history.at(-1);
  const step = { comfortable: 60, fast: -30, "too-fast": -60 }[last.feel] ?? 0;
  let next = clampPace(last.wpm + step);
  // Don't go back above a pace that already felt fast.
  const tooFast = history.filter((h) => h.feel !== "comfortable").map((h) => h.wpm);
  if (tooFast.length) next = Math.min(next, Math.min(...tooFast) - 20);
  // Don't repeat a pace already tried.
  while (history.some((h) => h.wpm === next) && next > MIN) next -= 10;
  return clampPace(next);
}

export function suggestedPace(history) {
  const comfortable = history.filter((h) => h.feel === "comfortable").map((h) => h.wpm);
  const fast = history.filter((h) => h.feel !== "comfortable").map((h) => h.wpm);
  if (comfortable.length) {
    const best = Math.max(...comfortable);
    // If something just above felt fast, settle a touch below it.
    const ceiling = fast.filter((w) => w > best);
    return clampPace(
      ceiling.length ? Math.min(best, Math.min(...ceiling) - 20) : best,
    );
  }
  return clampPace((fast.length ? Math.min(...fast) : START) - 40);
}
