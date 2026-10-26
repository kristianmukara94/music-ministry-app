// Go Live hub listing and default choice. Run with: node --test shared/golive.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultChoice, isSunday, listForDate } from './golive.js';

const mass = [
  { id: 1, name: 'Mass of the Sunday', liturgicalDate: '2026-11-08' },
  { id: 2, name: 'Weekday Mass', liturgicalDate: '2026-11-09' },
];
const pw = [
  { id: 7, name: 'Praise night', liturgicalDate: '2026-11-08' },
  { id: 8, name: 'Friday worship', liturgicalDate: '2026-11-13' },
];

test('isSunday reads the calendar date, not the time zone', () => {
  assert.equal(isSunday('2026-11-08'), true); // a Sunday
  assert.equal(isSunday('2026-11-09'), false); // a Monday
  assert.equal(isSunday('2026-11-01'), true); // the first of the month, a Sunday
});

test('listForDate returns only the entries dated that day, Mass first', () => {
  const entries = listForDate('2026-11-08', mass, pw);
  assert.deepEqual(entries.map((e) => [e.kind, e.id]), [['mass', 1], ['pw', 7]]);
});

test('listForDate keeps each entry id in its own module', () => {
  const [m, p] = listForDate('2026-11-08', mass, pw);
  assert.equal(m.name, 'Mass of the Sunday');
  assert.equal(p.name, 'Praise night');
  assert.equal(p.kind, 'pw');
});

test('a date with one kind lists only that kind', () => {
  assert.deepEqual(listForDate('2026-11-09', mass, pw).map((e) => e.kind), ['mass']);
  assert.deepEqual(listForDate('2026-11-13', mass, pw).map((e) => e.kind), ['pw']);
});

test('a date with nothing lists nothing and has no default', () => {
  const entries = listForDate('2026-12-25', mass, pw);
  assert.deepEqual(entries, []);
  assert.equal(defaultChoice('2026-12-25', entries), null);
});

test('both on one date: a Sunday defaults to the Mass plan', () => {
  const entries = listForDate('2026-11-08', mass, pw);
  assert.equal(defaultChoice('2026-11-08', entries).kind, 'mass');
});

test('both on one weekday: the Praise & Worship session is the default', () => {
  const massOnWeekday = [{ id: 3, name: 'Weekday Mass', liturgicalDate: '2026-11-13' }];
  const pwOnWeekday = [{ id: 8, name: 'Friday worship', liturgicalDate: '2026-11-13' }];
  const entries = listForDate('2026-11-13', massOnWeekday, pwOnWeekday);
  assert.deepEqual(entries.map((e) => e.kind), ['mass', 'pw'], 'both are listed');
  assert.equal(defaultChoice('2026-11-13', entries).kind, 'pw');
});

test('a single entry on a Sunday is still chosen', () => {
  const entries = listForDate('2026-11-08', [], pw);
  assert.equal(defaultChoice('2026-11-08', entries).kind, 'pw');
});
