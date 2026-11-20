// The Plans page's month calendar, as the church laptop's Liturgical Calendar lays it out: each day lists its Holy Masses as schedule badges in
// the order they are celebrated ("6:00 AM · EN", "8:00 AM · CEB", "+N more") and its Praise & Worship plans. A click on a day that already has
// a Holy Mass opens Available Holy Mass Schedules; an empty day goes to New plan with that date. Pure, so the tests run it without a browser.
import { cellScheduleBadges, massDayAction, schedulesOn } from './holy-mass-schedule.js';
import { asSchedulePlan } from './schedule-ui.js';

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');

/** A month as YYYY-MM, from a date (YYYY-MM-DD) or a month; anything unreadable is null. */
export function monthOf(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value ?? ''));
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? `${match[1]}-${match[2]}` : null;
}

/** The month `step` months after `month` (YYYY-MM). */
export function shiftMonth(month, step) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + step, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** "December 2026". */
export function monthTitle(month) {
  const [year, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

/** The six weeks shown for a month, Sunday first: 42 days, each `{ iso, day, inMonth }`. */
export function monthGrid(month) {
  const [year, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { iso, day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 };
  });
}

/** One day's plans: its Holy Masses in the order they are celebrated, and its Praise & Worship plans by name. */
export function plansOnDay(plans, iso) {
  const list = (plans ?? []).map(asSchedulePlan);
  return {
    mass: schedulesOn(list.filter((p) => p.kind !== 'pw'), iso),
    pw: list.filter((p) => p.kind === 'pw' && p.liturgicalDate === iso).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A day cell's badges: up to two Holy Masses and "+N more", as the laptop's calendar shows them. */
export const dayBadges = (massOnDay, max = 2) => cellScheduleBadges(massOnDay, max);

/**
 * What a click on a day does: 'pick' opens Available Holy Mass Schedules once the day has a Holy Mass, or a plan of either kind; 'create'
 * goes to New plan with the date when the day is empty and the person can create; 'none' for a viewer on an empty day.
 */
export function dayAction({ mass, pw }, canCreate) {
  if (massDayAction(mass) === 'pick' || pw.length) return 'pick';
  return canCreate ? 'create' : 'none';
}

/** New plan for a date, as a Holy Mass or a Praise & Worship plan. The page sits at the site root. */
export const newPlanHref = (iso, kind = 'mass') => `plan/new.html?date=${encodeURIComponent(iso)}&kind=${kind === 'pw' ? 'pw' : 'mass'}`;
