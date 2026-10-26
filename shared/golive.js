// The Go Live hub's listing: the saved Mass plans and Praise & Worship sessions for one date, and which of them the hub
// selects first. Plain JS with no React, so the rules can be tested without the app. Types live in golive.d.ts.

/** A Mass plan is a Mass; a Praise & Worship session is a worship night. The hub shows both on one date. */
export const GO_LIVE_KINDS = ['mass', 'pw'];

/** Whether an ISO date (YYYY-MM-DD) falls on a Sunday. Parsed as a calendar date, so the local time zone does not move it. */
export function isSunday(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/**
 * The entries for `date`: every Mass plan and Praise & Worship session dated that day, Mass first. Each entry keeps the
 * id it has in its own module, so opening it reads the same record the module does.
 */
export function listForDate(date, massPlans = [], pwSessions = []) {
  const mass = massPlans.filter((p) => p.liturgicalDate === date).map((p) => ({ kind: 'mass', id: p.id, name: p.name, date: p.liturgicalDate }));
  const pw = pwSessions.filter((s) => s.liturgicalDate === date).map((s) => ({ kind: 'pw', id: s.id, name: s.name, date: s.liturgicalDate }));
  return [...mass, ...pw];
}

/**
 * The entry the hub selects first. On a Sunday that is the Mass plan, otherwise the Praise & Worship session. When a date
 * has only one kind, that one is chosen. Returns null when the date has nothing.
 */
export function defaultChoice(date, entries) {
  const mass = entries.find((e) => e.kind === 'mass') ?? null;
  const pw = entries.find((e) => e.kind === 'pw') ?? null;
  if (isSunday(date)) return mass ?? pw;
  return pw ?? mass;
}
