// The parish's Mass times and the countdown to the next one, for the dashboard's Pre-Service widget. Pure: the clock and the time zone are
// passed in, so the tests can pin both. A time is a weekday (0 = Sunday … 6 = Saturday, or -1 for every day) and a wall-clock "HH:MM" in the
// region's zone, so "Sunday 08:00" stays 08:00 in Manila whatever zone the laptop itself is set to.

export const EVERY_DAY = -1;
/** A Mass is still "starting" for this long after its time, so the widget says so instead of jumping to next week's at once. */
export const STARTED_GRACE_MS = 10 * 60 * 1000;
export const MAX_MASS_TIMES = 40;
/** The longest label a Mass time can carry, e.g. "Sunday Morning Mass". */
export const MASS_LABEL_MAX = 60;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Keeps the valid entries, without duplicates, sorted by day then time. A damaged saved list never breaks the dashboard. */
export function sanitizeMassTimes(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const day = Number(entry?.day);
    const time = typeof entry?.time === 'string' ? entry.time.trim() : '';
    if (!Number.isInteger(day) || day < EVERY_DAY || day > 6 || !TIME.test(time)) continue;
    const key = `${day}|${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof entry?.label === 'string' ? entry.label.trim().replace(/\s+/g, ' ').slice(0, MASS_LABEL_MAX) : '';
    out.push(label ? { day, time, label } : { day, time });
    if (out.length >= MAX_MASS_TIMES) break;
  }
  return out.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

const formatters = new Map();

/** The wall-clock fields of `ms` in `timeZone`. */
function wallClock(ms, timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = {};
  for (const p of formatter.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

/** The instant at which the wall clock in `timeZone` reads the given date and time. Two passes settle a daylight-saving change. */
function instantOf(year, month, day, hour, minute, timeZone) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i += 1) {
    const w = wallClock(guess, timeZone);
    const shown = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    guess += wanted - shown;
  }
  return guess;
}

/**
 * The next Mass from `now`: `{ at, day, time, label?, started }` where `at` is the start in milliseconds. A Mass that began less than
 * STARTED_GRACE_MS ago is returned with `started: true`. Null when no times are set.
 */
export function nextMassStart(now, times, timeZone) {
  const list = sanitizeMassTimes(times);
  if (list.length === 0) return null;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const today = wallClock(nowMs, timeZone);
  let best = null;
  // Yesterday through a week ahead: yesterday's late Mass can still be in its grace window just after midnight.
  for (let offset = -1; offset <= 7; offset += 1) {
    const civil = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = civil.getUTCDay();
    for (const entry of list) {
      if (entry.day !== EVERY_DAY && entry.day !== weekday) continue;
      const [hour, minute] = entry.time.split(':').map(Number);
      const at = instantOf(civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate(), hour, minute, timeZone);
      if (at <= nowMs - STARTED_GRACE_MS) continue;
      if (!best || at < best.at) best = { at, day: weekday, time: entry.time, ...(entry.label ? { label: entry.label } : {}), started: at <= nowMs };
    }
  }
  return best;
}

/** Splits a span in milliseconds into whole days, hours, minutes and seconds. A negative span counts as zero. */
export function countdownParts(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** "2d 03:15:09", or "03:15:09" under a day. */
export function formatCountdown(ms) {
  const { days, hours, minutes, seconds } = countdownParts(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}
