// The dashboard's countdown to the next Mass: the parish's Mass times are read in the region's zone, not the laptop's. Run with:
// node --test shared/service-schedule.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVERY_DAY, STARTED_GRACE_MS, countdownParts, formatCountdown, nextMassStart, sanitizeMassTimes } from './service-schedule.js';

// Manila is UTC+8 all year. 2026-11-07 is a Saturday.
const MANILA = 'Asia/Manila';
const manila = (iso) => new Date(`${iso}+08:00`).getTime();

test('a damaged saved list keeps only valid, unique entries, sorted', () => {
  const list = sanitizeMassTimes([
    { day: 0, time: '10:00' },
    { day: 0, time: '08:00' },
    { day: 0, time: '08:00' },
    { day: 7, time: '08:00' },
    { day: 1, time: '25:00' },
    { day: 'x', time: '08:00' },
    null,
    { day: EVERY_DAY, time: '06:00' },
  ]);
  assert.deepEqual(list, [
    { day: -1, time: '06:00' },
    { day: 0, time: '08:00' },
    { day: 0, time: '10:00' },
  ]);
  assert.deepEqual(sanitizeMassTimes('nope'), []);
});

test('no times set: there is no next Mass', () => {
  assert.equal(nextMassStart(new Date(), [], MANILA), null);
});

test('Saturday evening counts down to Sunday morning in Manila time', () => {
  const next = nextMassStart(manila('2026-11-07T20:00:00'), [{ day: 0, time: '08:00' }], MANILA);
  assert.equal(next.at, manila('2026-11-08T08:00:00'));
  assert.equal(next.day, 0);
  assert.equal(next.started, false);
});

test('the earliest of several times wins, and an every-day Mass counts on any day', () => {
  const times = [{ day: 0, time: '08:00' }, { day: EVERY_DAY, time: '18:00' }];
  const next = nextMassStart(manila('2026-11-07T12:00:00'), times, MANILA);
  assert.equal(next.at, manila('2026-11-07T18:00:00'));
});

test('a Mass that just began is reported as started, then the next one takes over after the grace window', () => {
  const times = [{ day: 6, time: '17:00' }, { day: 0, time: '08:00' }];
  const justStarted = nextMassStart(manila('2026-11-07T17:05:00'), times, MANILA);
  assert.equal(justStarted.at, manila('2026-11-07T17:00:00'));
  assert.equal(justStarted.started, true);
  const later = nextMassStart(manila('2026-11-07T17:00:00') + STARTED_GRACE_MS + 1000, times, MANILA);
  assert.equal(later.at, manila('2026-11-08T08:00:00'));
});

test('a weekday Mass already past this week wraps to next week', () => {
  // Saturday noon, Friday 06:00 Mass: six days away.
  const next = nextMassStart(manila('2026-11-07T12:00:00'), [{ day: 5, time: '06:00' }], MANILA);
  assert.equal(next.at, manila('2026-11-13T06:00:00'));
});

test('the zone is the region\'s, so the same instant gives a different wall-clock target in New York', () => {
  // 2026-11-08 08:00 in New York (EST, UTC-5) is 13:00 UTC.
  const next = nextMassStart(Date.UTC(2026, 10, 8, 3, 0), [{ day: 0, time: '08:00' }], 'America/New_York');
  assert.equal(next.at, Date.UTC(2026, 10, 8, 13, 0));
});

test('daylight saving: a Mass on the day clocks change still lands on its wall-clock time', () => {
  // US clocks go back on 2026-11-01 at 02:00. 09:00 that Sunday is EST (UTC-5) = 14:00 UTC.
  const next = nextMassStart(Date.UTC(2026, 10, 1, 4, 0), [{ day: 0, time: '09:00' }], 'America/New_York');
  assert.equal(next.at, Date.UTC(2026, 10, 1, 14, 0));
});

test('countdown parts and text', () => {
  assert.deepEqual(countdownParts(((26 * 60 + 3) * 60 + 9) * 1000), { days: 1, hours: 2, minutes: 3, seconds: 9 });
  assert.equal(formatCountdown(((26 * 60 + 3) * 60 + 9) * 1000), '1d 02:03:09');
  assert.equal(formatCountdown(59_999), '00:00:59');
  assert.equal(formatCountdown(-5000), '00:00:00');
});

test('a Mass time keeps its label, tidied, and the countdown reports it', () => {
  const list = sanitizeMassTimes([{ day: 0, time: '08:00', label: '  Sunday   Morning Mass ' }, { day: 0, time: '17:00', label: '   ' }]);
  assert.deepEqual(list, [{ day: 0, time: '08:00', label: 'Sunday Morning Mass' }, { day: 0, time: '17:00' }]);
  assert.equal(sanitizeMassTimes([{ day: 1, time: '06:00', label: 'x'.repeat(200) }])[0].label.length, 60);
  const next = nextMassStart(manila('2026-11-07T20:00:00'), list, MANILA);
  assert.equal(next.label, 'Sunday Morning Mass');
});
