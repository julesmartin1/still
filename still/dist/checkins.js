// Comprehension check-ins.
//
// At a natural stopping point (a paragraph end, ideally a section end) the
// reader is asked, optionally, to put what they just read into a few words,
// and then how well it landed. This is deliberately not a quiz: nothing is
// graded and there are no right answers.
//
// Why this shape:
// - Recalling something in your own words (retrieval practice) strengthens
//   memory of it more than re-reading does.
// - People are poor judges of their own understanding, but writing a few
//   keywords first makes that self-judgment noticeably more accurate. So the
//   recap comes before the rating.
// - One-word-at-a-time reading removes the glances back that normally repair
//   missed meaning, so "I lost the thread" leads straight to a slower replay.
import { clamp } from "./engine.js";

export const CHECKIN_MODES = ["interval", "sections", "off"];
export const RATINGS = ["clear", "mostly", "lost"];
export const CHECKIN_MINUTES = 3; // "every few minutes" of reading time
export const MIN_SEGMENT_WORDS = 60; // never check in after a tiny stretch
export const MIN_END_WORDS = 80; // end-of-reading check-in threshold

// Whether to pause for a check-in after the word at `index`.
// `wordsRead` counts words actually shown since the last check-in.
// `sectionStarts` holds 1-based original paragraph numbers of headings.
export function checkInDue({
  tokens,
  index,
  wordsRead,
  mode = "interval",
  base = 260,
  sectionStarts = new Set(),
}) {
  if (mode === "off") return false;
  const token = tokens[index],
    next = tokens[index + 1];
  if (!token?.paragraphEnd || !next) return false;
  if (wordsRead < MIN_SEGMENT_WORDS) return false;
  const atSection = sectionStarts.has(
    (next.originalParagraph ?? next.paragraph) + 1,
  );
  if (mode === "sections") return atSection;
  const interval = Math.round(clamp(base, 80, 600) * CHECKIN_MINUTES);
  // Prefer a section boundary once at least half the interval has passed.
  return wordsRead >= interval || (atSection && wordsRead >= interval / 2);
}

export const endCheckInDue = (wordsRead, mode = "interval") =>
  mode !== "off" && wordsRead >= MIN_END_WORDS;

// What to offer after a rating: a slower replay after "lost", or a slightly
// faster pace after three clear check-ins in a row.
export function followUp(checkins) {
  const last = checkins.at(-1);
  if (!last) return null;
  if (last.rating === "lost") return "replay";
  const recent = checkins.slice(-3);
  if (recent.length === 3 && recent.every((c) => c.rating === "clear"))
    return "faster";
  return null;
}

export function summarizeCheckins(checkins = []) {
  const counts = { clear: 0, mostly: 0, lost: 0 };
  for (const c of checkins) if (c.rating in counts) counts[c.rating]++;
  return { ...counts, total: checkins.length };
}

// Validates stored check-ins (from storage or a backup).
// `words` is the number of source words in the reading.
export function normalizeCheckins(list, words) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (c) =>
        c &&
        typeof c.id === "string" &&
        c.id.length <= 200 &&
        RATINGS.includes(c.rating) &&
        Number.isInteger(c.start) &&
        Number.isInteger(c.end) &&
        c.start >= 0 &&
        c.end >= c.start &&
        c.end < words,
    )
    .slice(-500)
    .map((c) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      rating: c.rating,
      recap: typeof c.recap === "string" ? c.recap.slice(0, 1000) : "",
      quote: typeof c.quote === "string" ? c.quote.slice(0, 300) : "",
      createdAt: Number(c.createdAt) || Date.now(),
    }));
}
