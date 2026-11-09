// The parish's regular Mass times, for the planner's "Mass time" choice. A plan is for one date, so a plan saves only the time ("HH:MM");
// the day is the plan's date. The entries use the same shape as the laptop's Pre-Service Mass times (shared/service-schedule.js): `day` is
// 0 = Sunday … 6 = Saturday, or -1 for every day, and `time` is a 24-hour "HH:MM" in Philippine time.
//
// TO CONFIRM: these times are a starting point, not the parish bulletin. Replace them with Assumption Parish's published schedule. A planner
// can still pick any other time for a plan, so a missing time never blocks anyone.

export const EVERY_DAY = -1;

export const PARISH_MASS_SCHEDULE = [
  { day: 0, time: '06:00', label: 'Early Sunday Holy Mass' },
  { day: 0, time: '08:00' },
  { day: 0, time: '10:00', label: 'Solemn Holy Mass' },
  { day: 0, time: '16:00' },
  { day: 0, time: '17:30', label: 'Youth Holy Mass' },
  { day: 0, time: '18:00' },
  { day: 6, time: '17:30', label: 'Anticipated Sunday Holy Mass' },
  { day: EVERY_DAY, time: '06:00', label: 'Morning Holy Mass' },
  { day: EVERY_DAY, time: '18:00', label: 'Evening Holy Mass' },
];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isMassTime = (value) => typeof value === 'string' && TIME.test(value);

/** "08:00" as it reads on the page: "8:00 AM". Fixed wording, so no locale changes it. */
export function timeLabel(time) {
  if (!isMassTime(time)) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The weekday of a plan's date (YYYY-MM-DD), 0 = Sunday. */
export function weekdayOf(isoDate) {
  const [year, month, day] = String(isoDate ?? '').split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/**
 * The Mass times offered for a plan's date: that weekday's own times, then the every-day times. Where both name the same time, the day's own
 * entry (and its label) is kept. Sorted by time. `schedule` defaults to the parish's.
 */
export function massTimesFor(isoDate, schedule = PARISH_MASS_SCHEDULE) {
  const weekday = weekdayOf(isoDate);
  const valid = schedule.filter((e) => isMassTime(e.time));
  const list = [...valid.filter((e) => e.day === weekday), ...valid.filter((e) => e.day === EVERY_DAY)];
  const seen = new Set();
  return list
    .filter((e) => (seen.has(e.time) ? false : seen.add(e.time)))
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((e) => ({ time: e.time, label: e.label ? `${timeLabel(e.time)} · ${e.label}` : timeLabel(e.time) }));
}
