// Operator-managed song categories for the Mass. Pure: no Electron imports, so the tests can run it under node.
//
// The hymns table keeps its own category column and CHECK constraint, untouched. A hymn's song category is a separate
// text column, checked here in the app against this list, never by the database. Renaming a category updates the hymns
// that use it. Deleting one leaves those hymns with their text.
import { SONG_CATEGORY_NAMES } from '../shared/mass-flow.js';

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

/** Data access for the category list. Pure: takes a database handle. */
export function createSongCategoryService(db) {
  const q = {
    list: db.prepare('SELECT id, name, position FROM song_categories ORDER BY position, id'),
    byId: db.prepare('SELECT id, name, position FROM song_categories WHERE id = ?'),
    byName: db.prepare('SELECT id, name, position FROM song_categories WHERE name = ? COLLATE NOCASE'),
    maxPosition: db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM song_categories'),
    insert: db.prepare('INSERT INTO song_categories (name, position) VALUES (?, ?)'),
    rename: db.prepare('UPDATE song_categories SET name = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM song_categories WHERE id = ?'),
    renameHymns: db.prepare('UPDATE hymns SET song_category = ? WHERE song_category = ? COLLATE NOCASE'),
  };

  const renameTransaction = db.transaction((id, oldName, newName) => {
    q.rename.run(newName, id);
    q.renameHymns.run(newName, oldName);
  });

  const duplicateMessage = (name) => `A song category named "${name}" already exists.`;

  return {
    listSongCategories() {
      return q.list.all();
    },

    createSongCategory(input = {}) {
      const name = checkedSongCategoryName(input.name);
      if (q.byName.get(name)) throw new Error(duplicateMessage(name));
      const position = q.maxPosition.get().p + 1;
      const { lastInsertRowid } = q.insert.run(name, position);
      return { id: Number(lastInsertRowid), name, position };
    },

    renameSongCategory(id, input = {}) {
      const current = q.byId.get(id);
      if (!current) throw new Error('That song category no longer exists.');
      const name = checkedSongCategoryName(input.name);
      const clash = q.byName.get(name);
      if (clash && clash.id !== id) throw new Error(duplicateMessage(name));
      renameTransaction(id, current.name, name);
      return { id, name, position: current.position };
    },

    /** Removes the category from the list. Hymns that used it keep their text. */
    deleteSongCategory(id) {
      return q.remove.run(id).changes > 0;
    },
  };
}
