// Annual Planner Cleanup rules: which plans a year / month / type choice matches, and the once-a-year reminder with its per-year dismissal.
// Synthetic plans only. Run with: node --test shared/planner-cleanup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLEANUP_DISMISS_KEY,
  annualCleanupPrompt,
  cleanupMonths,
  cleanupScopeLabel,
  dismissCleanupPrompt,
  matchCleanup,
  monthCounts,
  planMonth,
  planYear,
  readDismissedYear,
  yearOptions,
} from './planner-cleanup.js';

const mass = [
  { id: 1, name: 'Sample Mass Plan', liturgicalDate: '2025-01-05' },
  { id: 2, name: 'Sample Mass Plan', liturgicalDate: '2025-01-26' },
  { id: 3, name: 'Sample Mass Plan', liturgicalDate: '2025-12-25' },
  { id: 4, name: 'Sample Mass Plan', liturgicalDate: '2026-03-01' },
];
const pw = [
  { id: 1, name: 'Sample Worship Plan', liturgicalDate: '2025-01-12' },
  { id: 2, name: 'Sample Worship Plan', liturgicalDate: '2025-06-15' },
  { id: 3, name: 'Sample Worship Plan', liturgicalDate: '2026-03-08' },
];
const ids = (list) => list.map((p) => p.id);

test('year and month are read from YYYY-MM-DD, and nothing else', () => {
  assert.equal(planYear('2025-01-05'), 2025);
  assert.equal(planMonth('2025-01-05'), 0);
  assert.equal(planMonth('2025-12-25'), 11);
  assert.equal(planYear('25-1-5'), null);
  assert.equal(planMonth('2025-13-01'), null);
  assert.equal(planYear(undefined), null);
});

test('the entire year matches every plan of that year and no other year', () => {
  const found = matchCleanup({ mass, pw }, { year: 2025, months: null, planType: 'all' });
  assert.deepEqual(ids(found.mass), [1, 2, 3]);
  assert.deepEqual(ids(found.pw), [1, 2]);
});

test('selected months (January to December) match only those months', () => {
  assert.deepEqual(ids(matchCleanup({ mass, pw }, { year: 2025, months: [0] }).mass), [1, 2]);
  assert.deepEqual(ids(matchCleanup({ mass, pw }, { year: 2025, months: [0] }).pw), [1]);
  assert.deepEqual(ids(matchCleanup({ mass, pw }, { year: 2025, months: [11] }).mass), [3]);
  assert.deepEqual(ids(matchCleanup({ mass, pw }, { year: 2025, months: [5, 11] }).pw), [2]);
  // The same month of another year is never touched.
  assert.deepEqual(ids(matchCleanup({ mass, pw }, { year: 2026, months: [0] }).mass), []);
});

test('a month scope with no month picked matches nothing', () => {
  const found = matchCleanup({ mass, pw }, { year: 2025, months: [] });
  assert.equal(found.mass.length + found.pw.length, 0);
});

test('the plan type narrows to Holy Mass only, Praise & Worship only, or all', () => {
  assert.deepEqual(matchCleanup({ mass, pw }, { year: 2025, planType: 'mass' }).pw, []);
  assert.deepEqual(matchCleanup({ mass, pw }, { year: 2025, planType: 'pw' }).mass, []);
  assert.equal(matchCleanup({ mass, pw }, { year: 2025, planType: 'pw' }).pw.length, 2);
  assert.equal(matchCleanup({ mass, pw }, { year: 2025, planType: 'nonsense' }).mass.length, 3);
});

test('month pills count their own month, for the chosen plan type', () => {
  const all = monthCounts({ mass, pw }, 2025, 'all');
  assert.equal(all.length, 12);
  assert.equal(all[0], 3);
  assert.equal(all[5], 1);
  assert.equal(all[11], 1);
  assert.equal(all[1], 0);
  assert.equal(monthCounts({ mass, pw }, 2025, 'mass')[0], 2);
});

test('year options list every year with plans plus the extra years, newest first, with their counts', () => {
  assert.deepEqual(yearOptions({ mass, pw }, [2026, 2027]), [
    { year: 2027, count: 0 },
    { year: 2026, count: 2 },
    { year: 2025, count: 5 },
  ]);
});

test('months from a request are whole numbers 0-11, once each, in order', () => {
  assert.deepEqual(cleanupMonths([5, 0, 5, 12, -1, 'x', 1.5]), [0, 5]);
  assert.equal(cleanupMonths(null), null);
  assert.equal(cleanupMonths(undefined), null);
});

function memoryStorage(fail = false) {
  const map = new Map();
  return {
    getItem: (k) => { if (fail) throw new Error('blocked'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (fail) throw new Error('blocked'); map.set(k, v); },
  };
}

test('the reminder shows once plans from an earlier year exist, and names the latest earlier year', () => {
  const p = annualCleanupPrompt({ mass, pw }, 2026, null);
  assert.equal(p.show, true);
  assert.equal(p.count, 5);
  assert.equal(p.year, 2025);
});

test('the reminder stays quiet with no earlier plans, or only this year\'s', () => {
  assert.equal(annualCleanupPrompt({ mass: [], pw: [] }, 2026, null).show, false);
  assert.equal(annualCleanupPrompt({ mass: [mass[3]], pw: [pw[2]] }, 2026, null).show, false);
});

test('dismissing the reminder is remembered for that calendar year only', () => {
  const storage = memoryStorage();
  assert.equal(readDismissedYear(storage), null);
  assert.equal(annualCleanupPrompt({ mass, pw }, 2026, readDismissedYear(storage)).show, true);
  assert.equal(dismissCleanupPrompt(storage, 2026), true);
  assert.equal(storage.getItem(CLEANUP_DISMISS_KEY), '2026');
  assert.equal(annualCleanupPrompt({ mass, pw }, 2026, readDismissedYear(storage)).show, false);
  // New year, new reminder.
  assert.equal(annualCleanupPrompt({ mass, pw }, 2027, readDismissedYear(storage)).show, true);
});

test('unreadable storage means "never dismissed", and a failed write never throws', () => {
  const blocked = memoryStorage(true);
  assert.equal(readDismissedYear(blocked), null);
  assert.equal(dismissCleanupPrompt(blocked, 2026), false);
  assert.equal(readDismissedYear(null), null);
  assert.equal(dismissCleanupPrompt(null, 2026), false);
});

test('the scope label names the whole year, or the chosen months', () => {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  assert.equal(cleanupScopeLabel(2025, null, names), '2025');
  assert.equal(cleanupScopeLabel(2025, [0, 1], names), 'Jan, Feb 2025');
  assert.equal(cleanupScopeLabel(2025, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], names), '2025');
});
