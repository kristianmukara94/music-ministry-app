import { ipcMain } from 'electron';

/**
 * The parish's own title for a calendar day ("Parish Anniversary Mass", "Youth Sunday"), shown on the Planner's calendar in place of the
 * day's Ordo name. One row per date; a day without a row shows its Ordo name. The Ordo itself is never changed.
 */
export const CALENDAR_DAY_NOTE_MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS calendar_day_notes (
    liturgical_date TEXT PRIMARY KEY,
    note            TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

/** The longest day title kept: it shares a calendar cell with the day's badges, and plan names stop at 120 too. */
export const MAX_DAY_NOTE = 120;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as "YYYY-MM-DD", or throws. */
function checkDate(date) {
  const match = typeof date === 'string' ? ISO_DATE.exec(date) : null;
  if (match) {
    const [, y, m, d] = match.map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d) return date;
  }
  throw new Error('A calendar date is needed, as YYYY-MM-DD.');
}

/** One line of text: control characters and runs of whitespace become single spaces, then it is trimmed and cut to MAX_DAY_NOTE. */
export function cleanDayNote(note) {
  if (typeof note !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return note.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, MAX_DAY_NOTE).trim();
}

/** Day-note data access. Pure: takes a database handle. */
export function createCalendarNoteService(db) {
  const q = {
    all: db.prepare('SELECT liturgical_date AS date, note FROM calendar_day_notes ORDER BY liturgical_date'),
    upsert: db.prepare(`
      INSERT INTO calendar_day_notes (liturgical_date, note) VALUES (?, ?)
      ON CONFLICT(liturgical_date) DO UPDATE SET note = excluded.note, updated_at = datetime('now')`),
    remove: db.prepare('DELETE FROM calendar_day_notes WHERE liturgical_date = ?'),
  };

  return {
    /** Every day with its own title: { "2026-11-15": "Parish 50th Anniversary" }. */
    getDayNotes() {
      const out = {};
      for (const row of q.all.all()) out[row.date] = row.note;
      return out;
    },

    /** Sets the day's title and returns it as kept. A blank title removes the day's row instead, and returns null. */
    saveDayNote(date, note) {
      checkDate(date);
      const clean = cleanDayNote(note);
      if (!clean) {
        q.remove.run(date);
        return null;
      }
      q.upsert.run(date, clean);
      return clean;
    },

    /** Removes the day's title, so it shows its Ordo name again. True when there was one. */
    deleteDayNote(date) {
      checkDate(date);
      return q.remove.run(date).changes > 0;
    },
  };
}

/** Registers the `calendar:*` IPC channels. Called once from the main process. */
export function setupCalendarNotes(db) {
  const service = createCalendarNoteService(db);
  ipcMain.handle('calendar:get_day_notes', () => service.getDayNotes());
  ipcMain.handle('calendar:save_day_note', (_event, date, note) => service.saveDayNote(date, note));
  ipcMain.handle('calendar:delete_day_note', (_event, date) => service.deleteDayNote(date));
  return service;
}
