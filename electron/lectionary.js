import { ipcMain } from 'electron';
import { parseTextStyle, sanitizeTextStyle } from '../shared/text-style.js';

export const READING_TYPES = ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel'];
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

/** Reading data access. Pure: takes a database handle. */
export function createLectionaryService(db) {
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

    /** Applies the day's liturgical label (e.g. "3rd Sunday of Lent") to every slot saved for that date. */
    setSeasonInfo(date, seasonInfo) {
      requireDate(date);
      return q.setSeasonInfo.run(clean(seasonInfo, MAX_LABEL, 'Liturgical label'), date).changes;
    },
  };
}

/** Registers the `lectionary:*` IPC channels. Called once from the main process. */
export function setupLectionary(db) {
  const service = createLectionaryService(db);
  const handle = (channel, fn) => ipcMain.handle(`lectionary:${channel}`, (_event, ...args) => fn(...args));

  handle('getDay', (date) => service.getDay(date));
  handle('saveReading', (input) => service.saveReading(input));
  handle('clearReading', (date, readingType) => service.clearReading(date, readingType));
  handle('setSeasonInfo', (date, seasonInfo) => service.setSeasonInfo(date, seasonInfo));
}
