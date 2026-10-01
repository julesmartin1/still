// Daily reading goal and streak.
//
// A small, steady habit does more for reading than an occasional long
// session, and it is the part people find hardest. So, like a language app,
// Still asks for a few minutes a day, shows how close today is, and counts
// the days in a row the goal was met. Everything stays on the device.
//
// Only time spent actually playing words counts (paused, background and
// dialog time do not). A day keeps "met" once reached, so lowering or raising
// the goal later never rewrites past days.

export const GOALS = [
  { minutes: 5, label: "Casual" },
  { minutes: 10, label: "Regular" },
  { minutes: 15, label: "Serious" },
  { minutes: 20, label: "Intense" },
];
export const DEFAULT_GOAL = 5;
const KEEP_DAYS = 400; // a little over a year of history
const MAX_CHUNK_MS = 30 * 60 * 1000; // ignore impossible gaps (a sleeping tab)

const pad = (n) => String(n).padStart(2, "0");
// Local calendar day, so a streak follows the reader's own midnight.
export const dayKey = (time = Date.now()) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// The day before `key`, built from calendar parts (safe across DST changes).
function previousDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
}

export function normalizeHabits(raw) {
  const goal = GOALS.some((g) => g.minutes === raw?.goal)
    ? raw.goal
    : DEFAULT_GOAL;
  const days = {};
  if (raw && typeof raw.days === "object" && raw.days !== null) {
    const keys = Object.keys(raw.days)
      .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort()
      .slice(-KEEP_DAYS);
    for (const key of keys) {
      const day = raw.days[key] || {};
      const ms = Math.max(0, Number(day.ms) || 0);
      const words = Math.max(0, Math.round(Number(day.words) || 0));
      days[key] = { ms, words, ...(day.met ? { met: true } : {}) };
    }
  }
  return { goal, days };
}

// Adds a stretch of reading to today. Returns new habits; never mutates.
export function recordReading(habits, { ms = 0, words = 0, now = Date.now() }) {
  const add = Math.min(MAX_CHUNK_MS, Math.max(0, Number(ms) || 0));
  const key = dayKey(now);
  const before = habits.days[key] || { ms: 0, words: 0 };
  const day = {
    ms: before.ms + add,
    words: before.words + Math.max(0, Math.round(words) || 0),
  };
  if (before.met || day.ms >= habits.goal * 60000) day.met = true;
  return normalizeHabits({ ...habits, days: { ...habits.days, [key]: day } });
}

export const dayMet = (habits, key) => {
  const day = habits.days[key];
  return !!day && (!!day.met || day.ms >= habits.goal * 60000);
};

// Today's reading against the goal. `extraMs` is reading in progress that
// hasn't been recorded yet.
export function today(habits, { now = Date.now(), extraMs = 0 } = {}) {
  const day = habits.days[dayKey(now)] || { ms: 0, words: 0 };
  const ms = day.ms + Math.max(0, extraMs);
  const goalMs = habits.goal * 60000;
  return {
    ms,
    words: day.words,
    goalMs,
    met: !!day.met || ms >= goalMs,
    fraction: Math.min(1, ms / goalMs),
  };
}

// Days in a row with the goal met, ending today (if met) or yesterday. A
// streak that ended yesterday is still alive today until midnight.
export function streak(habits, { now = Date.now(), extraMs = 0 } = {}) {
  const key = dayKey(now);
  const metToday = today(habits, { now, extraMs }).met;
  let count = metToday ? 1 : 0;
  let cursor = previousDay(key);
  while (dayMet(habits, cursor)) {
    count++;
    cursor = previousDay(cursor);
  }
  return { count, metToday, alive: count > 0 };
}

// The last seven days, oldest first, for the week strip.
export function week(habits, { now = Date.now(), extraMs = 0, locale } = {}) {
  const out = [];
  const todayKey = dayKey(now);
  let key = todayKey;
  const keys = [];
  for (let i = 0; i < 7; i++) {
    keys.unshift(key);
    key = previousDay(key);
  }
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const longDay = new Intl.DateTimeFormat(locale, { weekday: "long" });
  for (const k of keys) {
    const [y, m, d] = k.split("-").map(Number);
    const date = new Date(y, m - 1, d, 12);
    const isToday = k === todayKey;
    const ms = (habits.days[k]?.ms || 0) + (isToday ? extraMs : 0);
    out.push({
      key: k,
      label: weekday.format(date),
      name: longDay.format(date),
      ms,
      met: dayMet(habits, k) || (isToday && ms >= habits.goal * 60000),
      today: isToday,
    });
  }
  return out;
}

// "Under a minute", "4 min", "1 h 20 min".
export function formatDuration(ms) {
  const minutes = Math.round(Math.max(0, ms) / 60000);
  if (ms < 60000 * 0.75) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Short, exact-ish reading time for a finished stretch: "45 s", "3 min 10 s".
export function formatElapsed(ms) {
  const s = Math.round(Math.max(0, ms) / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60),
    r = s % 60;
  if (m >= 60) return formatDuration(ms);
  return r ? `${m} min ${r} s` : `${m} min`;
}
