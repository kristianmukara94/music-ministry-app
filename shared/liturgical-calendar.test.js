// Run with: node --test shared/liturgical-calendar.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDayOf, liturgicalColorOf, monthGrid, planStatusOf, requiredSlotsFor, seasonsOfMonth, shortDayName } from './liturgical-calendar.js';
import { MASS_SLOTS } from './mass-slots.js';

test('a month grid is whole weeks from Sunday to Saturday', () => {
  const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday and ends on a Monday.
  assert.equal(weeks[0][0], '2026-11-01');
  assert.equal(weeks.at(-1)[0], '2026-11-29');
  assert.equal(weeks.at(-1)[6], '2026-12-05');
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(monthGrid(2026, 1)[0][0], '2026-02-01'); // February 2026: four exact weeks.
  assert.equal(monthGrid(2026, 1).length, 4);
  assert.equal(monthGrid(2026, 4)[0][0], '2026-04-26'); // May 2026 starts on a Friday.
});

test('liturgical colours follow the rubrics', () => {
  assert.equal(calendarDayOf('2026-11-22').color, 'white'); // Christ the King
  assert.equal(calendarDayOf('2026-11-22').rank, 'solemnity');
  assert.equal(calendarDayOf('2026-11-15').color, 'green'); // 33rd Sunday in Ordinary Time
  assert.equal(calendarDayOf('2026-11-29').color, 'violet'); // 1st Sunday of Advent
  assert.equal(calendarDayOf('2026-11-30').color, 'red'); // St Andrew
  assert.equal(calendarDayOf('2026-11-30').rank, 'feast');
  assert.equal(calendarDayOf('2026-11-02').color, 'violet'); // All Souls
  assert.equal(calendarDayOf('2026-12-13').color, 'rose'); // Gaudete
  assert.equal(calendarDayOf('2026-12-08').color, 'white'); // Immaculate Conception
  assert.equal(calendarDayOf('2026-12-21').color, 'violet');
  assert.equal(calendarDayOf('2026-12-25').color, 'white');
  assert.equal(calendarDayOf('2026-03-15').color, 'rose'); // Laetare
  assert.equal(calendarDayOf('2026-03-29').color, 'red'); // Palm Sunday
  assert.equal(calendarDayOf('2026-03-30').color, 'violet'); // Monday of Holy Week
  assert.equal(calendarDayOf('2026-04-02').color, 'white'); // Holy Thursday
  assert.equal(calendarDayOf('2026-04-03').color, 'red'); // Good Friday
  assert.equal(calendarDayOf('2026-04-05').color, 'white'); // Easter
  assert.equal(calendarDayOf('2026-05-24').color, 'red'); // Pentecost
  assert.equal(calendarDayOf('2026-02-18').color, 'violet'); // Ash Wednesday
  assert.equal(liturgicalColorOf('holy-family'), 'white');
});

test('a weekday name drops the weekday the column already shows', () => {
  assert.equal(shortDayName('Tuesday of the 34th Week in Ordinary Time'), '34th Week in Ordinary Time');
  assert.equal(shortDayName('Monday within the Octave of Easter'), 'Monday within the Octave of Easter');
  assert.equal(shortDayName('Saint Andrew, Apostle'), 'Saint Andrew, Apostle');
});

test('a plan is ready when every slot its day needs is filled', () => {
  const sunday = requiredSlotsFor('2026-11-22');
  const weekday = requiredSlotsFor('2026-11-24');
  assert.ok(sunday.includes('gloria') && sunday.includes('second-reading'));
  assert.ok(!weekday.includes('gloria') && !weekday.includes('second-reading'));
  assert.ok(!sunday.includes('homily'));
  assert.equal(planStatusOf('2026-11-24', weekday), 'ready');
  assert.equal(planStatusOf('2026-11-22', weekday), 'draft');
  assert.equal(planStatusOf('2026-11-22', MASS_SLOTS.map((s) => s.id)), 'ready');
  assert.equal(planStatusOf('2026-11-22', []), 'draft');
  assert.equal(planStatusOf('2026-11-22', undefined), 'draft');
});

test('a month lists the seasons its days fall in', () => {
  assert.deepEqual(seasonsOfMonth(2026, 10), ['ordinary-time', 'advent']);
  assert.deepEqual(seasonsOfMonth(2026, 11), ['advent', 'christmas']);
  assert.deepEqual(seasonsOfMonth(2026, 6), ['ordinary-time']);
});
