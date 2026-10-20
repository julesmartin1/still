// The visit counter's bookkeeping, kept free of Netlify imports so it can be
// unit tested. One record per day holds two numbers and nothing else: no
// addresses, no device details, no cookies.
//
// `store` is anything with get(key, { type: "json" }) and setJSON(key, value),
// such as a Netlify Blobs store.

export const day = (date = new Date()) => date.toISOString().slice(0, 10);

// Counts one visit. `first` is true when this browser had never opened Still.
export async function record(store, { first = false } = {}, date = new Date()) {
  const key = day(date);
  const counts = (await store.get(key, { type: "json" })) || {
    visits: 0,
    first: 0,
  };
  counts.visits++;
  if (first) counts.first++;
  await store.setJSON(key, counts);
  return counts;
}

// The last `days` days, newest first, as plain text that reads well on a phone.
export async function report(store, days = 30, date = new Date()) {
  const lines = [];
  let visits = 0,
    first = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - i);
    const counts = (await store.get(day(d), { type: "json" })) || {
      visits: 0,
      first: 0,
    };
    visits += counts.visits;
    first += counts.first;
    lines.push(
      `${day(d)}  ${String(counts.visits).padStart(5)} visits  ${String(counts.first).padStart(5)} new`,
    );
  }
  return (
    `Still visits, last ${days} days (UTC)\n` +
    `${visits} visits, ${first} from people opening Still for the first time\n\n` +
    lines.join("\n") +
    "\n"
  );
}
