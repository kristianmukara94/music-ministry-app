/**
 * Validation, reading and writing for the lectionary backup file. No Electron imports here, so the rules can be tested under
 * plain Node. The IPC layer in lectionary.js passes its database handle in.
 *
 * The readings are the parish's own: they are typed or pasted in, and not shipped with the app. A backup keeps them safe and
 * moves them to another laptop.
 */
import { parseTextStyle, sanitizeTextStyle } from '../shared/text-style.js';

export const BACKUP_FORMAT = 'apccmma-lectionary';
export const BACKUP_VERSION = 1;
export const READING_TYPES = ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel Acclamation', 'Gospel'];
const PSALM = 'Responsorial Psalm';

/** The limits the editor enforces, so a file cannot hold what the editor would refuse. */
export const MAX_TEXT = 20000;
export const MAX_LABEL = 160;
/** More readings than a parish could write in a century of five-slot Sundays. A file beyond it is a mistake. */
const MAX_ROWS = 20000;

const fail = (where, message) => {
  throw new Error(`${where}: ${message}`);
};

/** A real calendar date written YYYY-MM-DD, so 2026-02-30 is refused rather than stored. */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function text(where, row, field, { required = false, max }) {
  const value = row[field];
  if (value === undefined || value === null) {
    if (required) fail(where, `"${field}" is missing.`);
    return '';
  }
  if (typeof value !== 'string') fail(where, `"${field}" must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(where, `"${field}" is longer than ${max} characters.`);
  if (required && !trimmed) fail(where, `"${field}" cannot be empty.`);
  return trimmed;
}

/** Checks one reading and returns its clean form. The congregation response only means something for the psalm, so other slots drop it. */
export function normalizeReading(row, where = 'Reading') {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail(where, 'is not an object.');
  if (!isCalendarDate(row.liturgical_date)) fail(where, '"liturgical_date" must be a real date written YYYY-MM-DD.');
  if (!READING_TYPES.includes(row.reading_type)) fail(where, `"reading_type" must be one of ${READING_TYPES.join(', ')}.`);
  const isPsalm = row.reading_type === PSALM;
  return {
    liturgical_date: row.liturgical_date,
    reading_type: row.reading_type,
    liturgical_season_info: text(where, row, 'liturgical_season_info', { max: MAX_LABEL }),
    citation: text(where, row, 'citation', { max: MAX_LABEL }),
    congregation_response: isPsalm ? text(where, row, 'congregation_response', { max: MAX_LABEL }) : '',
    raw_text: text(where, row, 'raw_text', { required: true, max: MAX_TEXT }),
    // The style is checked as the editor checks it: unknown or invalid parts fall away, and none at all means the default look.
    style: row.style && typeof row.style === 'object' ? sanitizeTextStyle(row.style) : null,
  };
}

/** Checks a whole backup object. Every row is checked before anything is written, so one bad row rejects the file. */
export function parseBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== BACKUP_FORMAT) throw new Error('This file is not a lectionary backup.');
  if (data.version !== BACKUP_VERSION) throw new Error(`This backup is version ${data.version}. This app reads version ${BACKUP_VERSION}.`);
  if (!Array.isArray(data.lectionary_readings)) throw new Error('The backup is missing its list of readings.');
  if (data.lectionary_readings.length > MAX_ROWS) throw new Error(`The backup has more than ${MAX_ROWS} readings.`);

  const seen = new Set();
  const readings = data.lectionary_readings.map((row, i) => {
    const clean = normalizeReading(row, `Reading ${i + 1}`);
    const id = `${clean.liturgical_date}:${clean.reading_type}`;
    if (seen.has(id)) throw new Error(`Reading ${i + 1}: ${clean.reading_type} on ${clean.liturgical_date} appears twice.`);
    seen.add(id);
    return clean;
  });
  return { readings };
}

/** Reads every saved reading in the backup's form: the style as an object, and the dates in order. */
export function readAllLectionary(db) {
  const rows = db
    .prepare(
      `SELECT liturgical_date, liturgical_season_info, reading_type, citation, congregation_response, raw_text, style
       FROM lectionary_readings
       ORDER BY liturgical_date, CASE reading_type WHEN 'First Reading' THEN 0 WHEN 'Responsorial Psalm' THEN 1 WHEN 'Second Reading' THEN 2 WHEN 'Gospel Acclamation' THEN 3 ELSE 4 END`,
    )
    .all();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    lectionary_readings: rows.map(({ style, ...rest }) => ({ ...rest, style: parseTextStyle(style) })),
  };
}

/**
 * Writes readings by date and slot. A reading that is already saved is replaced by the backup's, and one that is not is added.
 * Readings the backup does not mention are left alone. All of it is one transaction.
 */
export function createLectionaryWriter(db) {
  const upsert = db.prepare(`
    INSERT INTO lectionary_readings
      (liturgical_date, liturgical_season_info, reading_type, citation, congregation_response, raw_text, style, updated_at)
    VALUES (@liturgical_date, @liturgical_season_info, @reading_type, @citation, @congregation_response, @raw_text, @style, datetime('now'))
    ON CONFLICT (liturgical_date, reading_type) DO UPDATE SET
      liturgical_season_info = excluded.liturgical_season_info,
      citation = excluded.citation,
      congregation_response = excluded.congregation_response,
      raw_text = excluded.raw_text,
      style = excluded.style,
      updated_at = excluded.updated_at`);

  const write = db.transaction(({ readings }) => {
    for (const row of readings) upsert.run({ ...row, style: row.style ? JSON.stringify(row.style) : null });
  });

  return { write: (rows) => write(rows) };
}
