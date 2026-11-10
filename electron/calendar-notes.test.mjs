// The parish's own titles for calendar days, against the real schema. Run with: node --test electron/calendar-notes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { CALENDAR_DAY_NOTE_MIGRATIONS, MAX_DAY_NOTE, cleanDayNote, createCalendarNoteService } = await import('./calendar-notes.js');

function open() {
  const db = new DatabaseSync(':memory:');
  for (const sql of CALENDAR_DAY_NOTE_MIGRATIONS) db.exec(sql);
  return db;
}

test('a day without its own title is not listed, so the calendar shows its Ordo name', () => {
  const service = createCalendarNoteService(open());
  assert.deepEqual(service.getDayNotes(), {});
});

test('saving a title upserts it by date, and deleting it reverts the day', () => {
  const service = createCalendarNoteService(open());
  assert.equal(service.saveDayNote('2026-11-15', 'Parish 50th Anniversary'), 'Parish 50th Anniversary');
  assert.equal(service.saveDayNote('2026-11-22', 'Youth Sunday'), 'Youth Sunday');
  assert.deepEqual(service.getDayNotes(), { '2026-11-15': 'Parish 50th Anniversary', '2026-11-22': 'Youth Sunday' });

  assert.equal(service.saveDayNote('2026-11-15', 'Confirmation Mass'), 'Confirmation Mass', 'a second save replaces the first');
  assert.equal(service.getDayNotes()['2026-11-15'], 'Confirmation Mass');

  assert.equal(service.deleteDayNote('2026-11-15'), true);
  assert.equal(service.deleteDayNote('2026-11-15'), false, 'nothing left to delete');
  assert.deepEqual(service.getDayNotes(), { '2026-11-22': 'Youth Sunday' });
});

test('a blank title removes the day instead of storing an empty override', () => {
  const service = createCalendarNoteService(open());
  service.saveDayNote('2026-11-15', 'Parish 50th Anniversary');
  assert.equal(service.saveDayNote('2026-11-15', '   \n\t '), null);
  assert.deepEqual(service.getDayNotes(), {});
});

test('titles are kept as one trimmed line, cut to the limit', () => {
  assert.equal(cleanDayNote('  Youth\n\nSunday \u0007 Mass  '), 'Youth Sunday Mass');
  assert.equal(cleanDayNote(42), '');
  assert.equal(cleanDayNote('x'.repeat(500)).length, MAX_DAY_NOTE);
});

test('only real YYYY-MM-DD dates are accepted', () => {
  const service = createCalendarNoteService(open());
  for (const bad of ['2026-02-30', '2026-13-01', '15/11/2026', '2026-11-15T00:00', '', null, 20261115]) {
    assert.throws(() => service.saveDayNote(bad, 'x'), /YYYY-MM-DD/, String(bad));
    assert.throws(() => service.deleteDayNote(bad), /YYYY-MM-DD/, String(bad));
  }
  assert.equal(service.saveDayNote('2028-02-29', 'Leap day'), 'Leap day');
});

test('titles persist: a reopened database file still has them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-notes-'));
  const file = path.join(dir, 'app.db');
  try {
    const first = new DatabaseSync(file);
    for (const sql of CALENDAR_DAY_NOTE_MIGRATIONS) first.exec(sql);
    createCalendarNoteService(first).saveDayNote('2026-11-15', 'Parish 50th Anniversary');
    first.close();

    const again = new DatabaseSync(file);
    // The migration is CREATE TABLE IF NOT EXISTS: running it on the existing file keeps the rows.
    for (const sql of CALENDAR_DAY_NOTE_MIGRATIONS) again.exec(sql);
    assert.deepEqual(createCalendarNoteService(again).getDayNotes(), { '2026-11-15': 'Parish 50th Anniversary' });
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
