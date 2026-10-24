/**
 * Validation and upsert for rosary content. No Electron imports here, so the rules can be tested
 * under plain Node. The IPC layer in rosary.js passes its database handle in.
 */

export const BACKUP_FORMAT = 'apccmma-rosary';
export const BACKUP_VERSION = 1;
export const MYSTERY_TYPES = ['joyful', 'sorrowful', 'glorious', 'luminous'];
export const PRAYER_KEYS = ['creed', 'our_father', 'hail_mary', 'glory_be', 'fatima', 'hail_holy_queen', 'litany_loreto'];
export const LANGS = ['en', 'tl', 'ceb'];

/** Longest text accepted in any one field. Prayers and meditations are far shorter. */
const MAX_TEXT = 5000;

const MYSTERY_TEXT_FIELDS = ['title_en', 'title_tl', 'title_ceb', 'meditation_en', 'meditation_tl', 'meditation_ceb', 'scripture_ref'];
const PRAYER_TEXT_FIELDS = ['text_en', 'text_tl', 'text_ceb'];
const APPROVAL_FIELDS = ['approved_en', 'approved_tl', 'approved_ceb'];

const fail = (where, message) => {
  throw new Error(`${where}: ${message}`);
};

function text(where, row, field, { required }) {
  const value = row[field];
  if (value === undefined || value === null) {
    if (required) fail(where, `"${field}" is missing.`);
    return '';
  }
  if (typeof value !== 'string') fail(where, `"${field}" must be text.`);
  if (value.length > MAX_TEXT) fail(where, `"${field}" is longer than ${MAX_TEXT} characters.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(where, `"${field}" cannot be empty.`);
  return trimmed;
}

function approval(where, row, field) {
  const value = row[field];
  if (value === undefined || value === null || value === false || value === 0) return 0;
  if (value === true || value === 1) return 1;
  fail(where, `"${field}" must be 0 or 1.`);
}

/** Checks one mystery row and returns the clean version. The English title and scripture are required. */
export function normalizeMystery(row, where = 'Mystery') {
  if (!row || typeof row !== 'object') fail(where, 'is not an object.');
  if (!MYSTERY_TYPES.includes(row.mystery_type)) fail(where, `"mystery_type" must be one of ${MYSTERY_TYPES.join(', ')}.`);
  const decade = Number(row.decade_number);
  if (!Number.isInteger(decade) || decade < 1 || decade > 5) fail(where, '"decade_number" must be a whole number from 1 to 5.');
  const out = { mystery_type: row.mystery_type, decade_number: decade };
  for (const field of MYSTERY_TEXT_FIELDS) {
    out[field] = text(where, row, field, { required: field === 'title_en' || field === 'scripture_ref' });
  }
  for (const field of APPROVAL_FIELDS) out[field] = approval(where, row, field);
  return out;
}

/** Checks one prayer row and returns the clean version. */
export function normalizePrayer(row, where = 'Prayer') {
  if (!row || typeof row !== 'object') fail(where, 'is not an object.');
  if (!PRAYER_KEYS.includes(row.key)) fail(where, `"key" must be one of ${PRAYER_KEYS.join(', ')}.`);
  const out = { key: row.key };
  const named = `${where} "${row.key}"`;
  for (const field of PRAYER_TEXT_FIELDS) out[field] = text(named, row, field, { required: field === 'text_en' });
  for (const field of APPROVAL_FIELDS) out[field] = approval(named, row, field);
  return out;
}

/**
 * Checks a whole backup object. Every row is checked before anything is written, so one bad row
 * rejects the file and leaves the database as it was.
 */
export function parseBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This file is not a rosary backup.');
  if (data.format !== BACKUP_FORMAT) throw new Error('This file is not a rosary backup.');
  if (data.version !== BACKUP_VERSION) throw new Error(`This backup is version ${data.version}. This app reads version ${BACKUP_VERSION}.`);
  if (!Array.isArray(data.rosary_mysteries) || !Array.isArray(data.rosary_prayers)) {
    throw new Error('The backup is missing its mystery or prayer list.');
  }

  const seenMysteries = new Set();
  const mysteries = data.rosary_mysteries.map((row, i) => {
    const clean = normalizeMystery(row, `Mystery ${i + 1}`);
    const id = `${clean.mystery_type}:${clean.decade_number}`;
    if (seenMysteries.has(id)) throw new Error(`Mystery ${i + 1}: ${id} appears twice.`);
    seenMysteries.add(id);
    return clean;
  });

  const seenPrayers = new Set();
  const prayers = data.rosary_prayers.map((row, i) => {
    const clean = normalizePrayer(row, `Prayer ${i + 1}`);
    if (seenPrayers.has(clean.key)) throw new Error(`Prayer ${i + 1}: "${clean.key}" appears twice.`);
    seenPrayers.add(clean.key);
    return clean;
  });

  return { mysteries, prayers };
}

/** Migration 2: approval flags. Added after the first schema, so the default is "not yet approved". */
export const ROSARY_APPROVAL_MIGRATION = `
  ALTER TABLE rosary_mysteries ADD COLUMN approved_en  INTEGER NOT NULL DEFAULT 0 CHECK (approved_en IN (0, 1));
  ALTER TABLE rosary_mysteries ADD COLUMN approved_tl  INTEGER NOT NULL DEFAULT 0 CHECK (approved_tl IN (0, 1));
  ALTER TABLE rosary_mysteries ADD COLUMN approved_ceb INTEGER NOT NULL DEFAULT 0 CHECK (approved_ceb IN (0, 1));
  ALTER TABLE rosary_prayers ADD COLUMN approved_en  INTEGER NOT NULL DEFAULT 0 CHECK (approved_en IN (0, 1));
  ALTER TABLE rosary_prayers ADD COLUMN approved_tl  INTEGER NOT NULL DEFAULT 0 CHECK (approved_tl IN (0, 1));
  ALTER TABLE rosary_prayers ADD COLUMN approved_ceb INTEGER NOT NULL DEFAULT 0 CHECK (approved_ceb IN (0, 1));
`;

/**
 * Writes mysteries and prayers by key. Existing rows are updated in place, and missing rows are
 * inserted, so a backup can restore content that was deleted or overwritten.
 */
export function createRosaryWriter(db) {
  const upsertMystery = db.prepare(`
    INSERT INTO rosary_mysteries
      (mystery_type, decade_number, title_en, title_tl, title_ceb, meditation_en, meditation_tl, meditation_ceb, scripture_ref,
       approved_en, approved_tl, approved_ceb)
    VALUES (@mystery_type, @decade_number, @title_en, @title_tl, @title_ceb, @meditation_en, @meditation_tl, @meditation_ceb, @scripture_ref,
            @approved_en, @approved_tl, @approved_ceb)
    ON CONFLICT (mystery_type, decade_number) DO UPDATE SET
      title_en = excluded.title_en, title_tl = excluded.title_tl, title_ceb = excluded.title_ceb,
      meditation_en = excluded.meditation_en, meditation_tl = excluded.meditation_tl, meditation_ceb = excluded.meditation_ceb,
      scripture_ref = excluded.scripture_ref,
      approved_en = excluded.approved_en, approved_tl = excluded.approved_tl, approved_ceb = excluded.approved_ceb`);
  const upsertPrayer = db.prepare(`
    INSERT INTO rosary_prayers (key, text_en, text_tl, text_ceb, approved_en, approved_tl, approved_ceb)
    VALUES (@key, @text_en, @text_tl, @text_ceb, @approved_en, @approved_tl, @approved_ceb)
    ON CONFLICT (key) DO UPDATE SET
      text_en = excluded.text_en, text_tl = excluded.text_tl, text_ceb = excluded.text_ceb,
      approved_en = excluded.approved_en, approved_tl = excluded.approved_tl, approved_ceb = excluded.approved_ceb`);

  const write = db.transaction(({ mysteries, prayers }) => {
    for (const m of mysteries) upsertMystery.run(m);
    for (const p of prayers) upsertPrayer.run(p);
  });

  return {
    /** Saves rows that already passed normalizeMystery / normalizePrayer, or a parsed backup. */
    write: (rows) => write(rows),
  };
}

/** Reads every rosary row in its stored form, for the backup file. */
export function readAllRosary(db) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    rosary_mysteries: db.prepare('SELECT * FROM rosary_mysteries ORDER BY mystery_type, decade_number').all(),
    rosary_prayers: db.prepare('SELECT * FROM rosary_prayers ORDER BY key').all(),
  };
}
