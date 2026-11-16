// Operator-managed song categories, each for the Holy Mass, Praise & Worship or All. Pure: no Electron imports, so the tests can run it under node.
//
// The hymns table keeps its own category column and CHECK constraint, untouched. A hymn's song category is a separate
// text column, checked here in the app against this list, never by the database. Renaming a category updates the hymns
// that use it. Deleting one leaves those hymns with their text. A category's target mode only steers which dropdowns
// offer it; changing it never touches the songs that already carry it.
import { SONG_CATEGORY_NAMES } from '../shared/mass-flow.js';
import { CATEGORY_TARGET_MODES, DEFAULT_TARGET_MODE, DEFAULT_TARGET_MODES, THEME_NAMES, isCategoryTargetMode } from '../shared/song-taxonomy.js';

export const SONG_CATEGORY_MAX = 40;

/** Adds the song_category column to hymns. Nothing is copied or rebuilt: existing rows get the empty value. */
const ADD_COLUMN = "ALTER TABLE hymns ADD COLUMN song_category TEXT NOT NULL DEFAULT '';";

/** Creates the category list and seeds it with the Mass song steps. It has no foreign key to hymns. */
const CREATE_LIST = `
  CREATE TABLE song_categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position  INTEGER NOT NULL
  );
`;

const seed = SONG_CATEGORY_NAMES.map(
  (name, i) => `INSERT INTO song_categories (name, position) VALUES ('${name.replace(/'/g, "''")}', ${i + 1});`,
).join('\n');

export const SONG_CATEGORY_MIGRATIONS = [ADD_COLUMN, CREATE_LIST + seed];

const sql = (text) => text.replace(/'/g, "''");

/**
 * Gives every song a primary scope (General, Mass or Praise & Worship) and adds the themes (Joyful Song, Marian Song …) to the category list.
 * A song already filed under a Mass part, or with a Mass slot as its category, is Mass; every other song is General, which shows under every
 * scope, so nothing disappears from a library until the operator sorts it. A theme the operator already has is not added twice.
 * Appended to the end of the migration list only.
 */
export const SONG_SCOPE_MIGRATIONS = [
  `ALTER TABLE hymns ADD COLUMN primary_category TEXT NOT NULL DEFAULT 'GENERAL' CHECK (primary_category IN ('GENERAL', 'MASS', 'PRAISE_AND_WORSHIP'));
   UPDATE hymns SET primary_category = 'MASS'
     WHERE category <> 'General' OR song_category COLLATE NOCASE IN (${SONG_CATEGORY_NAMES.map((n) => `'${sql(n)}'`).join(', ')});
   ${THEME_NAMES.map(
     (name) => `INSERT INTO song_categories (name, position)
       SELECT '${sql(name)}', (SELECT COALESCE(MAX(position), 0) + 1 FROM song_categories)
       WHERE NOT EXISTS (SELECT 1 FROM song_categories WHERE name = '${sql(name)}' COLLATE NOCASE);`,
   ).join(' ')}`,
];

/**
 * Gives every category a target mode: where it is offered (HOLY_MASS, PRAISE_AND_WORSHIP or ALL). A category the operator added is ALL, as it
 * behaved before; the shipped ones get the mode their built-in scopes already gave them (Gloria → Holy Mass, Joyful Song → Praise & Worship,
 * Repentance Song → All), so no dropdown changes when the column appears. Appended to the end of the migration list only.
 */
export const SONG_CATEGORY_MODE_MIGRATIONS = [
  `ALTER TABLE song_categories ADD COLUMN target_mode TEXT NOT NULL DEFAULT '${DEFAULT_TARGET_MODE}'
     CHECK (target_mode IN (${CATEGORY_TARGET_MODES.map((m) => `'${m}'`).join(', ')}));
   ${DEFAULT_TARGET_MODES.filter((c) => c.targetMode !== DEFAULT_TARGET_MODE)
     .map((c) => `UPDATE song_categories SET target_mode = '${c.targetMode}' WHERE name = '${sql(c.name)}' COLLATE NOCASE;`)
     .join(' ')}`,
];

/** A target mode from the page. Missing means `fallback`; anything else unknown is refused with a readable message. */
export function checkedTargetMode(raw, fallback = DEFAULT_TARGET_MODE) {
  if (raw == null || raw === '') return fallback;
  if (!isCategoryTargetMode(raw)) throw new Error('A song category must be for Holy Mass, Praise & Worship or All.');
  return raw;
}

/** A category name, trimmed and checked for length. Throws a readable message when it is not usable. */
export function checkedSongCategoryName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > SONG_CATEGORY_MAX) throw new Error(`A song category name must be 1 to ${SONG_CATEGORY_MAX} characters.`);
  return name;
}

/**
 * The name a hymn is saved with. Empty means no category. A name must be on the list (any letter case), and it is saved
 * as the list spells it. A hymn keeps its current value even after that category is deleted, so editing its other
 * details does not fail.
 */
export function resolveSongCategory(db, raw, current = '') {
  const name = String(raw ?? '').trim();
  if (!name) return '';
  if (name === current) return name;
  const listed = db.prepare('SELECT name FROM song_categories WHERE name = ? COLLATE NOCASE').get(name);
  if (!listed) throw new Error(`"${name}" is not in the song categories. Add it under Song categories first.`);
  return listed.name;
}

/**
 * The names a hymn is filed under, each as resolveSongCategory gives it: on the list (saved as the list spells it), or one the hymn already
 * carries in `current`. Repeats are dropped and the order is kept, so the first stays the primary category.
 */
export function resolveSongCategories(db, names, current = []) {
  const kept = new Map(current.map((c) => [String(c).toLowerCase(), c]));
  const out = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const resolved = kept.get(name.toLowerCase()) ?? resolveSongCategory(db, name);
    if (!out.some((n) => n.toLowerCase() === resolved.toLowerCase())) out.push(resolved);
  }
  return out;
}

/** The longest a category change waits for another program to release the database file. */
export const CATEGORY_LOCK_WAIT_MS = 750;

export const CATEGORY_BUSY_MESSAGE = 'The song library is busy (another copy of the app or a backup may be using it). Try again in a moment.';

/** Whether an error is SQLite's "the file is locked by someone else", from better-sqlite3 (code) or node:sqlite (errcode). */
const isBusy = (err) => err?.code === 'SQLITE_BUSY' || err?.code === 'SQLITE_LOCKED' || err?.errcode === 5 || err?.errcode === 6 || /database is (locked|busy)/i.test(String(err?.message));

/** Whether the hymns table has the categories list (HYMN_FILING_MIGRATIONS in lyrics.js). A database built before it has not. */
const hasCategoryList = (db) => Boolean(db.prepare("SELECT 1 FROM pragma_table_info('hymns') WHERE name = 'categories_json'").get());

/** Data access for the category list. Pure: takes a database handle. */
export function createSongCategoryService(db) {
  const q = {
    list: db.prepare('SELECT id, name, position, target_mode AS targetMode FROM song_categories ORDER BY position, id'),
    byId: db.prepare('SELECT id, name, position, target_mode AS targetMode FROM song_categories WHERE id = ?'),
    byName: db.prepare('SELECT id, name, position FROM song_categories WHERE name = ? COLLATE NOCASE'),
    maxPosition: db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM song_categories'),
    insert: db.prepare('INSERT INTO song_categories (name, position, target_mode) VALUES (?, ?, ?)'),
    rename: db.prepare('UPDATE song_categories SET name = ?, target_mode = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM song_categories WHERE id = ?'),
    renameHymns: db.prepare('UPDATE hymns SET song_category = ? WHERE song_category = ? COLLATE NOCASE'),
  };

  /** Renames the category inside every hymn's list of categories too, so a song filed under several keeps all of them. */
  const renameInLists = (oldName, newName) => {
    if (!hasCategoryList(db)) return;
    const old = oldName.toLowerCase();
    const rows = db.prepare('SELECT id, categories_json AS json FROM hymns WHERE categories_json IS NOT NULL').all();
    const update = db.prepare('UPDATE hymns SET categories_json = ? WHERE id = ?');
    for (const row of rows) {
      let list;
      try {
        list = JSON.parse(row.json);
      } catch {
        continue;
      }
      if (!Array.isArray(list) || !list.some((n) => String(n).toLowerCase() === old)) continue;
      update.run(JSON.stringify(list.map((n) => (String(n).toLowerCase() === old ? newName : n))), row.id);
    }
  };

  const renameWork = (id, oldName, newName, targetMode) => {
    q.rename.run(newName, targetMode, id);
    if (newName !== oldName) {
      q.renameHymns.run(newName, oldName);
      renameInLists(oldName, newName);
    }
  };

  const duplicateMessage = (name) => `A song category named "${name}" already exists.`;

  /**
   * Runs one category change as a single write transaction that takes the write lock first (BEGIN IMMEDIATE), so a change that reads and then
   * writes waits for the lock once, not twice. The wait is capped at CATEGORY_LOCK_WAIT_MS instead of the connection's 5 seconds: these run on
   * Electron's main thread, which also carries the window's keyboard input on Windows, so a long wait froze typing in the whole window. While
   * another program holds the file (a second copy of the app on the same database, a backup tool) the change is refused with a readable
   * message, and the page puts the name back to try again.
   */
  const quickWrite = (work, ...args) => {
    const was = db.prepare('PRAGMA busy_timeout').get();
    const previous = Number(was?.timeout ?? Object.values(was ?? {})[0] ?? 5000);
    db.exec(`PRAGMA busy_timeout = ${CATEGORY_LOCK_WAIT_MS}`);
    try {
      const tx = db.transaction(work);
      return typeof tx.immediate === 'function' ? tx.immediate(...args) : tx(...args);
    } catch (err) {
      if (isBusy(err)) throw new Error(CATEGORY_BUSY_MESSAGE);
      throw err;
    } finally {
      db.exec(`PRAGMA busy_timeout = ${Number.isFinite(previous) ? previous : 5000}`);
    }
  };

  return {
    listSongCategories() {
      return q.list.all();
    },

    /** Adds a category at the end of the list. `targetMode` is HOLY_MASS, PRAISE_AND_WORSHIP or ALL; missing means ALL. */
    createSongCategory(input = {}) {
      const name = checkedSongCategoryName(input.name);
      const targetMode = checkedTargetMode(input.targetMode);
      return quickWrite(() => {
        if (q.byName.get(name)) throw new Error(duplicateMessage(name));
        const position = q.maxPosition.get().p + 1;
        const { lastInsertRowid } = q.insert.run(name, position, targetMode);
        return { id: Number(lastInsertRowid), name, position, targetMode };
      });
    },

    /** Renames a category and the hymns that use it, and sets its target mode. A missing `targetMode` keeps the one it has. */
    renameSongCategory(id, input = {}) {
      const current = q.byId.get(id);
      if (!current) throw new Error('That song category no longer exists.');
      const name = checkedSongCategoryName(input.name ?? current.name);
      const targetMode = checkedTargetMode(input.targetMode, current.targetMode);
      const clash = q.byName.get(name);
      if (clash && clash.id !== id) throw new Error(duplicateMessage(name));
      quickWrite(renameWork, id, current.name, name, targetMode);
      return { id, name, position: current.position, targetMode };
    },

    /** Removes the category from the list. Hymns that used it keep their text. */
    deleteSongCategory(id) {
      return quickWrite(() => q.remove.run(id).changes > 0);
    },
  };
}
