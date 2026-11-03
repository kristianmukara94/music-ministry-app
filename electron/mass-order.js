import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain } from 'electron';
import { CUSTOM_PREFIX, MASS_ORDER_ID, MASS_ORDER_LANGS, MAX_MASS_ORDER_ID, checkMassOrderText, cleanTitle, isCustomId } from '../shared/mass-order-text.js';

/**
 * The parish's own words and titles for the Holy Mass Order parts (Kyrie, Gloria, Credo…), one row per part and language, and the parish's own
 * items (`mass_order_custom_<uuid>`). A built-in part with no row shows the standard text, which ships with the app (src/liturgy/massOrder.ts);
 * deleting its row is how it is reset. Everything lives in the app's database, so a database backup carries it and a restore brings it back.
 * New migrations go at the end of ALL_MIGRATIONS only.
 */
export const MASS_ORDER_TEXT_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS mass_order_texts (
     part_id    TEXT NOT NULL,
     lang       TEXT NOT NULL CHECK (lang IN ('en', 'tl')),
     text       TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (part_id, lang)
   );`,
];

// Cebuano gets its own words, a part's title can be changed (custom_title), and a row may hold a title alone (the words staying standard). The
// parish's own items are listed in mass_order_custom_items, in the order they were made; their words and titles are rows of mass_order_texts.
export const MASS_ORDER_CUSTOM_MIGRATIONS = [
  `CREATE TABLE mass_order_texts_v2 (
     part_id      TEXT NOT NULL,
     lang         TEXT NOT NULL CHECK (lang IN ('en', 'tl', 'ceb')),
     text         TEXT,
     custom_title TEXT,
     updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (part_id, lang),
     CHECK (text IS NOT NULL OR custom_title IS NOT NULL)
   );
   INSERT INTO mass_order_texts_v2 (part_id, lang, text, updated_at) SELECT part_id, lang, text, updated_at FROM mass_order_texts;
   DROP TABLE mass_order_texts;
   ALTER TABLE mass_order_texts_v2 RENAME TO mass_order_texts;
   CREATE TABLE mass_order_custom_items (
     id         TEXT PRIMARY KEY,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
];

function partOf(partId) {
  const id = String(partId ?? '');
  if (!MASS_ORDER_ID.test(id) || id.length > MAX_MASS_ORDER_ID) throw new Error('That is not a Holy Mass Order part.');
  return id;
}

function langOf(lang) {
  if (!MASS_ORDER_LANGS.includes(lang)) throw new Error('The Holy Mass Order texts are kept in English, Tagalog or Cebuano.');
  return lang;
}

/** One language's words and title, checked and cleaned. `text` and `title` are each a string, or null to keep the standard one. */
function cleanEntry(entry) {
  let text = null;
  if (entry?.text != null && String(entry.text).trim()) {
    const checked = checkMassOrderText(entry.text);
    if (!checked.ok) throw new Error(checked.error);
    text = String(entry.text).replace(/\r\n?/g, '\n').trim();
  }
  return { text, title: cleanTitle(entry?.title) };
}

/** The languages given in `entries` ({ en?, tl?, ceb? }), each cleaned. Unknown languages are refused. */
function cleanEntries(entries) {
  if (!entries || typeof entries !== 'object') throw new Error('Nothing to save.');
  return Object.entries(entries).map(([lang, entry]) => [langOf(lang), cleanEntry(entry)]);
}

export function createMassOrderTexts(db, { newId = () => `${CUSTOM_PREFIX}${randomUUID()}` } = {}) {
  const all = db.prepare('SELECT part_id AS partId, lang, text, custom_title AS title, updated_at AS updatedAt FROM mass_order_texts ORDER BY part_id, lang');
  const items = db.prepare('SELECT id, created_at AS createdAt FROM mass_order_custom_items ORDER BY created_at, rowid');
  const item = db.prepare('SELECT 1 AS found FROM mass_order_custom_items WHERE id = ?');
  const rowsOf = db.prepare('SELECT lang, text, custom_title AS title FROM mass_order_texts WHERE part_id = ?');
  const upsert = db.prepare(
    `INSERT INTO mass_order_texts (part_id, lang, text, custom_title) VALUES (?, ?, ?, ?)
     ON CONFLICT (part_id, lang) DO UPDATE SET text = excluded.text, custom_title = excluded.custom_title, updated_at = datetime('now')`,
  );
  const remove = db.prepare('DELETE FROM mass_order_texts WHERE part_id = ? AND lang = ?');
  const removeAll = db.prepare('DELETE FROM mass_order_texts WHERE part_id = ?');
  const insertItem = db.prepare('INSERT INTO mass_order_custom_items (id) VALUES (?)');
  const removeItem = db.prepare('DELETE FROM mass_order_custom_items WHERE id = ?');
  // node:sqlite (the tests) has no db.transaction(); better-sqlite3 (the app) does.
  const transaction = (fn) => (db.transaction ? db.transaction(fn)() : (db.exec('BEGIN'), (() => { try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; } })()));

  /** Writes the cleaned languages of one part: a language with neither words nor title goes back to standard. */
  const write = (id, cleaned) => {
    for (const [lang, { text, title }] of cleaned) {
      if (text === null && title === null) remove.run(id, lang);
      else upsert.run(id, lang, text, title);
    }
  };

  /** A parish item must keep a title and some words in at least one language, or it could not be listed or shown. */
  const requireComplete = (id) => {
    const rows = rowsOf.all(id);
    if (!rows.some((r) => r.title)) throw new Error('Give the new item a title in at least one language.');
    if (!rows.some((r) => r.text)) throw new Error('Type the words of the new item in at least one language.');
  };

  return {
    /** Every part the parish has changed, and the parish's own items in the order they were made. */
    list() {
      return { texts: all.all(), custom: items.all() };
    },

    /**
     * Saves the words and titles of one part, for the languages given: `entries` is { en?, tl?, ceb? }, each { text, title }, either null to
     * keep the standard one. All languages are saved together, or none is.
     */
    saveAll(partId, entries) {
      const id = partOf(partId);
      const cleaned = cleanEntries(entries);
      transaction(() => {
        if (isCustomId(id) && !item.get(id)) throw new Error('That item was deleted.');
        write(id, cleaned);
        if (isCustomId(id)) requireComplete(id);
      });
      return true;
    },

    /** Makes a parish item from its title and words in one or more languages. Resolves to its new id, `mass_order_custom_<uuid>`. */
    create(entries) {
      const cleaned = cleanEntries(entries);
      const id = partOf(newId());
      if (!isCustomId(id)) throw new Error('A new item needs a mass_order_custom_ id.');
      transaction(() => {
        insertItem.run(id);
        write(id, cleaned);
        requireComplete(id);
      });
      return id;
    },

    /** Goes back to the standard text and title of a built-in part in one language. Resolves true when there was something to remove. */
    reset(partId, lang) {
      const id = partOf(partId);
      if (isCustomId(id)) throw new Error('A parish item has no standard text. Edit its words, or delete it.');
      return remove.run(id, langOf(lang)).changes > 0;
    },

    /** Deletes a parish item and its words in every language. A plan that used it shows it as missing. */
    remove(partId) {
      const id = partOf(partId);
      if (!isCustomId(id)) throw new Error('Only the parish\'s own items can be deleted. A standard part can be reset instead.');
      return transaction(() => {
        removeAll.run(id);
        return removeItem.run(id).changes > 0;
      });
    },
  };
}

/** Tells every window the Holy Mass Order words changed (after an edit here, or a library import), so each reloads them. */
export function announceMassOrderChange() {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('massOrder:changed');
}

/** Registers the `massOrder:*` IPC channels. Every window is told after a change, so a planner or Go Live open elsewhere uses the new words at once. */
export function setupMassOrderTexts(db) {
  const service = createMassOrderTexts(db);
  const changed = announceMassOrderChange;
  const handle = (channel, fn) =>
    ipcMain.handle(`massOrder:${channel}`, (_event, ...args) => {
      const result = fn(...args);
      changed();
      return result;
    });
  ipcMain.handle('massOrder:list', () => service.list());
  handle('saveAll', (partId, entries) => service.saveAll(partId, entries));
  handle('create', (entries) => service.create(entries));
  handle('reset', (partId, lang) => service.reset(partId, lang));
  handle('delete', (partId) => service.remove(partId));
  return service;
}
