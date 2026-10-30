import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import { parseTextStyle, sanitizeTextStyle } from '../shared/text-style.js';
import { createLectionaryWriter, isCalendarDate, parseBackup, READING_TYPES, readAllLectionary } from './lectionary-backup.js';

export { READING_TYPES };
const BACKUP_FILE_NAME = 'apccmma_lectionary_backup.json';
/** The widest date range an overview answers for, so one call cannot read the whole library by accident. */
const MAX_OVERVIEW_DAYS = 400;
/** Entered here for Praise & Worship. Mass plans leave it out, so the Mass planner behaves as it did before it existed. */
export const GOSPEL_ACCLAMATION = 'Gospel Acclamation';
const PSALM = 'Responsorial Psalm';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 20000;
const MAX_LABEL = 160;

/**
 * One row per date and reading slot. Texts are not shipped: they are copyrighted
 * and vary by region, so the operator pastes them in.
 */
export const LECTIONARY_MIGRATIONS = [
  `
  CREATE TABLE lectionary_readings (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    liturgical_date         TEXT NOT NULL CHECK (liturgical_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    liturgical_season_info  TEXT NOT NULL DEFAULT '',
    reading_type            TEXT NOT NULL CHECK (reading_type IN ('First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel')),
    citation                TEXT NOT NULL DEFAULT '',
    congregation_response   TEXT NOT NULL DEFAULT '',
    raw_text                TEXT NOT NULL DEFAULT '',
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (liturgical_date, reading_type)
  );
  `,
];

const requireDate = (date) => {
  if (!DATE.test(String(date ?? ''))) throw new Error('Date must be in the form YYYY-MM-DD.');
  return date;
};

const requireSlot = (type) => {
  if (!READING_TYPES.includes(type)) throw new Error(`Reading must be one of: ${READING_TYPES.join(', ')}.`);
  return type;
};

const clean = (value, max, label) => {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
};

// How a reading is set on the projector: font, size, colour, background and alignment. One style per reading, saved as JSON.
export const LECTIONARY_STYLE_MIGRATIONS = [`ALTER TABLE lectionary_readings ADD COLUMN style TEXT;`];

/**
 * Rebuilds lectionary_readings so its CHECK constraint accepts 'Gospel Acclamation'. SQLite cannot change a CHECK
 * in place, so the table is copied, as the Mass plan rebuilds do. Existing readings keep their ids and text.
 */
export const LECTIONARY_ACCLAMATION_MIGRATIONS = [
  `
  CREATE TABLE lectionary_readings_new (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    liturgical_date         TEXT NOT NULL CHECK (liturgical_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    liturgical_season_info  TEXT NOT NULL DEFAULT '',
    reading_type            TEXT NOT NULL CHECK (reading_type IN ('First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel Acclamation', 'Gospel')),
    citation                TEXT NOT NULL DEFAULT '',
    congregation_response   TEXT NOT NULL DEFAULT '',
    raw_text                TEXT NOT NULL DEFAULT '',
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    style                   TEXT,
    UNIQUE (liturgical_date, reading_type)
  );
  INSERT INTO lectionary_readings_new
    (id, liturgical_date, liturgical_season_info, reading_type, citation, congregation_response, raw_text, updated_at, style)
    SELECT id, liturgical_date, liturgical_season_info, reading_type, citation, congregation_response, raw_text, updated_at, style
    FROM lectionary_readings;
  DROP TABLE lectionary_readings;
  ALTER TABLE lectionary_readings_new RENAME TO lectionary_readings;
  `,
];

/** Reading data access. Pure: takes a database handle. */
export function createLectionaryService(db, deps = {}) {
  const { showSaveDialog, showOpenDialog } = deps;
  const writer = createLectionaryWriter(db);
  const q = {
    day: db.prepare(`
      SELECT reading_type AS readingType, liturgical_season_info AS seasonInfo, citation,
             congregation_response AS congregationResponse, raw_text AS rawText, style AS styleJson
      FROM lectionary_readings WHERE liturgical_date = ?`),
    upsert: db.prepare(`
      INSERT INTO lectionary_readings
        (liturgical_date, liturgical_season_info, reading_type, citation, congregation_response, raw_text, style, updated_at)
      VALUES (@date, @seasonInfo, @readingType, @citation, @congregationResponse, @rawText, @style, datetime('now'))
      ON CONFLICT (liturgical_date, reading_type) DO UPDATE SET
        liturgical_season_info = excluded.liturgical_season_info,
        citation = excluded.citation,
        congregation_response = excluded.congregation_response,
        raw_text = excluded.raw_text,
        style = excluded.style,
        updated_at = excluded.updated_at`),
    remove: db.prepare('DELETE FROM lectionary_readings WHERE liturgical_date = ? AND reading_type = ?'),
    setSeasonInfo: db.prepare("UPDATE lectionary_readings SET liturgical_season_info = ?, updated_at = datetime('now') WHERE liturgical_date = ?"),
  };

  return {
    /** Returns the four reading slots for the date, empty where nothing has been saved. */
    getDay(date) {
      requireDate(date);
      const rows = q.day.all(date);
      const seasonInfo = rows[0]?.seasonInfo ?? '';
      const readings = READING_TYPES.map((readingType) => {
        const row = rows.find((r) => r.readingType === readingType);
        return {
          readingType,
          citation: row?.citation ?? '',
          congregationResponse: row?.congregationResponse ?? '',
          rawText: row?.rawText ?? '',
          style: parseTextStyle(row?.styleJson),
        };
      });
      return { date, seasonInfo, readings };
    },

    /** Saves one slot. Clearing the text removes the slot's row. */
    saveReading(input = {}) {
      const date = requireDate(input.date);
      const readingType = requireSlot(input.readingType);
      const rawText = clean(input.rawText, MAX_TEXT, 'Reading text');
      if (!rawText) return this.clearReading(date, readingType);

      q.upsert.run({
        date,
        seasonInfo: clean(input.seasonInfo, MAX_LABEL, 'Liturgical label'),
        readingType,
        citation: clean(input.citation, MAX_LABEL, 'Citation'),
        // The response only means something for the psalm; other slots store nothing.
        congregationResponse: readingType === PSALM ? clean(input.congregationResponse, MAX_LABEL, 'Congregation response') : '',
        rawText,
        style: sanitizeTextStyle(input.style) ? JSON.stringify(sanitizeTextStyle(input.style)) : null,
      });
      return true;
    },

    clearReading(date, readingType) {
      requireDate(date);
      requireSlot(readingType);
      return q.remove.run(date, readingType).changes > 0;
    },

    /**
     * What is in the library, and which slots are saved on each date from `from` to `to`. Read only. A slot with no text has no row,
     * so a slot in the list is a slot with a reading.
     */
    overview(from, to) {
      if (!isCalendarDate(from) || !isCalendarDate(to)) throw new Error('Dates must be real dates in the form YYYY-MM-DD.');
      if (from > to) throw new Error('The start date is after the end date.');
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_OVERVIEW_DAYS) throw new Error(`Ask for ${MAX_OVERVIEW_DAYS} days or fewer.`);

      const totals = db.prepare('SELECT COUNT(*) AS readings, COUNT(DISTINCT liturgical_date) AS days, MIN(liturgical_date) AS earliest, MAX(liturgical_date) AS latest FROM lectionary_readings').get();
      const bySlot = Object.fromEntries(READING_TYPES.map((type) => [type, 0]));
      for (const row of db.prepare('SELECT reading_type AS readingType, COUNT(*) AS n FROM lectionary_readings GROUP BY reading_type').all()) bySlot[row.readingType] = row.n;

      const days = new Map();
      for (const row of db.prepare('SELECT liturgical_date AS date, liturgical_season_info AS seasonInfo, reading_type AS readingType FROM lectionary_readings WHERE liturgical_date BETWEEN ? AND ? ORDER BY liturgical_date').all(from, to)) {
        const day = days.get(row.date) ?? { date: row.date, seasonInfo: row.seasonInfo, slots: [] };
        if (!day.seasonInfo) day.seasonInfo = row.seasonInfo;
        day.slots.push(row.readingType);
        days.set(row.date, day);
      }
      return { readings: totals.readings, days: totals.days, earliest: totals.earliest, latest: totals.latest, bySlot, range: [...days.values()] };
    },

    /** Asks where to save, then writes every reading to a JSON file. Resolves to null if cancelled. */
    async exportBackup(win) {
      const picked = await showSaveDialog(win, {
        title: 'Export lectionary readings',
        defaultPath: BACKUP_FILE_NAME,
        filters: [{ name: 'JSON backup', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      const backup = readAllLectionary(db);
      await fs.promises.writeFile(picked.filePath, `${JSON.stringify(backup, null, 2)}
`, 'utf8');
      return { path: picked.filePath, readings: backup.lectionary_readings.length };
    },

    /**
     * Asks for a backup file, checks every reading, then writes them all in one transaction. A file with any bad reading changes
     * nothing. Readings already saved on the same date and slot are replaced. Resolves to null if cancelled.
     */
    async importBackup(win) {
      const picked = await showOpenDialog(win, {
        title: 'Import lectionary readings',
        properties: ['openFile'],
        filters: [{ name: 'JSON backup', extensions: ['json'] }],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const source = picked.filePaths[0];
      let data;
      try {
        data = JSON.parse(await fs.promises.readFile(source, 'utf8'));
      } catch {
        throw new Error('This file is not valid JSON.');
      }
      const rows = parseBackup(data);
      writer.write(rows);
      return { path: source, readings: rows.readings.length };
    },

    /** Applies the day's liturgical label (e.g. "3rd Sunday of Lent") to every slot saved for that date. */
    setSeasonInfo(date, seasonInfo) {
      requireDate(date);
      return q.setSeasonInfo.run(clean(seasonInfo, MAX_LABEL, 'Liturgical label'), date).changes;
    },
  };
}

/** Registers the `lectionary:*` IPC channels. Called once from the main process. */
export function setupLectionary(db) {
  const service = createLectionaryService(db, {
    showSaveDialog: (win, options) => (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)),
    showOpenDialog: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
  });
  // The window that asked is passed first, so a file dialog opens over it.
  const handle = (channel, fn) => ipcMain.handle(`lectionary:${channel}`, (event, ...args) => fn(BrowserWindow.fromWebContents(event.sender), ...args));

  handle('getDay', (_win, date) => service.getDay(date));
  handle('saveReading', (_win, input) => service.saveReading(input));
  handle('clearReading', (_win, date, readingType) => service.clearReading(date, readingType));
  handle('setSeasonInfo', (_win, date, seasonInfo) => service.setSeasonInfo(date, seasonInfo));
  handle('overview', (_win, from, to) => service.overview(from, to));
  handle('exportJSON', (win) => service.exportBackup(win));
  handle('importJSON', (win) => service.importBackup(win));
}
