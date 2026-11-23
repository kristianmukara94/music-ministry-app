// Annual Planner Cleanup: which plans a bulk delete would remove, and when the once-a-year reminder shows. Pure rules, used by both the Planner
// (its modal and banner) and the main process (which re-resolves the same filter before it deletes, so the two can never disagree).
// A plan is a Holy Mass plan ('mass') or a Praise & Worship session ('pw'); its day is `liturgicalDate`, 'YYYY-MM-DD'.

export const CLEANUP_PLAN_TYPES = ['all', 'mass', 'pw'];
export const CLEANUP_DISMISS_KEY = 'apccmma.plannerCleanup.dismissedYear';

/** The plan's calendar year, or null for a date that is not YYYY-MM-DD. */
export function planYear(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso ?? ''));
  return m ? Number(m[1]) : null;
}

/** The plan's month, 0 (January) to 11 (December), or null. */
export function planMonth(iso) {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(String(iso ?? ''));
  const month = m ? Number(m[1]) - 1 : -1;
  return month >= 0 && month <= 11 ? month : null;
}

/** A plan type from a request, defaulting to every plan. */
export function cleanupPlanType(value) {
  return CLEANUP_PLAN_TYPES.includes(value) ? value : 'all';
}

/** Months from a request: whole numbers 0-11, each once, in order. `null` / not an array means the entire year. */
export function cleanupMonths(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((m) => Number.isInteger(m) && m >= 0 && m <= 11))].sort((a, b) => a - b);
}

/**
 * The plans a cleanup matches. `mass` and `pw` are lists of { id, liturgicalDate }. `months` null means the entire year; an empty list matches
 * nothing (a month scope with no month picked). Returns { mass, pw } in their original order.
 */
export function matchCleanup({ mass = [], pw = [] }, { year, months = null, planType = 'all' }) {
  const type = cleanupPlanType(planType);
  const wanted = months == null ? null : new Set(cleanupMonths(months));
  const hit = (plan) => {
    if (planYear(plan.liturgicalDate) !== Number(year)) return false;
    return wanted == null || wanted.has(planMonth(plan.liturgicalDate));
  };
  return { mass: type === 'pw' ? [] : mass.filter(hit), pw: type === 'mass' ? [] : pw.filter(hit) };
}

/** How many plans each month of `year` holds for `planType`, as 12 numbers (January first). Ignores the month choice, so a pill shows its own count. */
export function monthCounts({ mass = [], pw = [] }, year, planType = 'all') {
  const counts = new Array(12).fill(0);
  const { mass: m, pw: p } = matchCleanup({ mass, pw }, { year, months: null, planType });
  for (const plan of [...m, ...p]) counts[planMonth(plan.liturgicalDate)] += 1;
  return counts;
}

/** Every year that holds a plan, plus `extraYears`, newest first, each with its plan count (all types). */
export function yearOptions({ mass = [], pw = [] }, extraYears = []) {
  const counts = new Map(extraYears.map((y) => [Number(y), 0]));
  for (const plan of [...mass, ...pw]) {
    const y = planYear(plan.liturgicalDate);
    if (y != null) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return [...counts.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
}

/** The dismissed year as stored, or null. A read failure (no storage, private window) is "never dismissed". */
export function readDismissedYear(storage) {
  try {
    const n = Number(storage?.getItem(CLEANUP_DISMISS_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Marks `year`'s reminder as dismissed or done, so it does not show again until the next calendar year. Never throws. */
export function dismissCleanupPrompt(storage, year) {
  if (!storage) return false;
  try {
    storage.setItem(CLEANUP_DISMISS_KEY, String(year));
    return true;
  } catch {
    return false;
  }
}

/**
 * The once-a-year reminder. Shows when plans from before `currentYear` exist and this year's reminder was not dismissed or completed.
 * Returns { show, count, year }: `count` plans from before this year, and `year` the latest earlier year that has any (the modal opens on it).
 */
export function annualCleanupPrompt({ mass = [], pw = [] }, currentYear, dismissedYear) {
  const years = [...mass, ...pw].map((p) => planYear(p.liturgicalDate)).filter((y) => y != null && y < currentYear);
  const year = years.length ? Math.max(...years) : null;
  const show = years.length > 0 && !(dismissedYear != null && dismissedYear >= currentYear);
  return { show, count: years.length, year };
}

/** The toast after a cleanup: "Deleted 12 plans from 2025." / "...from Jan, Feb 2025." */
export function cleanupScopeLabel(year, months, monthNames) {
  const picked = cleanupMonths(months);
  if (picked == null || picked.length === 12) return String(year);
  return `${picked.map((m) => monthNames[m] ?? String(m + 1)).join(', ')} ${year}`;
}
