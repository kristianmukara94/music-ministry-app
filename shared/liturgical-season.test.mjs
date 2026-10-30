// Tests for the liturgical season. Run with: node --test shared/liturgical-season.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_SEASON_THEME, baptismOfTheLord, easterSunday, resolveTheme, seasonOf } from './liturgical-season.js';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const season = (y, m, d) => seasonOf(new Date(y, m - 1, d));

test('Easter Sunday for known years', () => {
  const known = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2038: '2038-04-25' };
  for (const [year, date] of Object.entries(known)) assert.equal(ymd(easterSunday(Number(year))), date, year);
});

test('the Baptism of the Lord, including the year Epiphany falls on 7 January', () => {
  assert.equal(ymd(baptismOfTheLord(2025)), '2025-01-12'); // Epiphany Jan 5
  assert.equal(ymd(baptismOfTheLord(2026)), '2026-01-11'); // Epiphany Jan 4
  assert.equal(ymd(baptismOfTheLord(2024)), '2024-01-08'); // Epiphany Jan 7: the Monday after
});

test('every season of 2025-2026 begins and ends on the right day', () => {
  assert.equal(season(2025, 11, 29), 'ordinary-time'); // the Saturday before Advent
  assert.equal(season(2025, 11, 30), 'advent');
  assert.equal(season(2025, 12, 24), 'advent');
  assert.equal(season(2025, 12, 25), 'christmas');
  assert.equal(season(2026, 1, 11), 'christmas'); // Baptism of the Lord
  assert.equal(season(2026, 1, 12), 'ordinary-time');
  assert.equal(season(2026, 2, 17), 'ordinary-time'); // Shrove Tuesday
  assert.equal(season(2026, 2, 18), 'lent'); // Ash Wednesday
  assert.equal(season(2026, 3, 28), 'lent'); // Saturday before Palm Sunday
  assert.equal(season(2026, 3, 29), 'holy-week'); // Palm Sunday
  assert.equal(season(2026, 4, 4), 'holy-week'); // Holy Saturday
  assert.equal(season(2026, 4, 5), 'easter');
  assert.equal(season(2026, 5, 23), 'easter'); // Saturday before Pentecost
  assert.equal(season(2026, 5, 24), 'pentecost');
  assert.equal(season(2026, 5, 25), 'ordinary-time');
});

test('early January belongs to Christmas, and the year boundary holds', () => {
  assert.equal(season(2026, 1, 1), 'christmas');
  assert.equal(season(2025, 12, 31), 'christmas');
});

test('Automatic resolves to the date\'s season theme; other ids pass through', () => {
  assert.equal(resolveTheme(AUTO_SEASON_THEME, new Date(2026, 2, 1)), 'lent');
  assert.equal(resolveTheme('obsidian', new Date(2026, 2, 1)), 'obsidian');
});
