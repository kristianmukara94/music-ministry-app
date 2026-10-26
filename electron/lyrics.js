import { ipcMain } from 'electron';
import { CATEGORIES, LANGUAGES, parseLyrics } from '../shared/lyrics-parser.js';
import { parseTextStyle, sanitizeTextStyle } from '../shared/text-style.js';
import { createSongCategoryService, resolveSongCategory } from './song-categories.js';

const MAX_TITLE = 120;
const MAX_COMPOSER = 80;
const MAX_KEY = 12;
const MAX_SETLIST_NAME = 120;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Schema for the Song Lyrics module. Appended after the Announcements migrations. */
export const LYRICS_MIGRATIONS = [
  `
  CREATE TABLE hymns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    composer    TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL CHECK (category IN ('Entrance', 'Offertory', 'Communion', 'Recessional', 'General')),
    language    TEXT NOT NULL CHECK (language IN ('EN', 'TL', 'CEB')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_hymns_title ON hymns (title COLLATE NOCASE);

  CREATE TABLE hymn_stanzas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    hymn_id         INTEGER NOT NULL REFERENCES hymns(id) ON DELETE CASCADE,
    stanza_type     TEXT NOT NULL,
    lyrics_text     TEXT NOT NULL,
    display_order   INTEGER NOT NULL
  );
  CREATE INDEX idx_hymn_stanzas_hymn ON hymn_stanzas (hymn_id, display_order);

  CREATE TABLE setlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE setlist_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    setlist_id  INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    hymn_id     INTEGER NOT NULL REFERENCES hymns(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL
  );
  CREATE INDEX idx_setlist_items_order ON setlist_items (setlist_id, position);
  `,
];

const requireOneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
};

// The musical key and the projector style of a song. Both are optional, so existing songs need no change.
export const LYRICS_STYLE_MIGRATIONS = [
  `ALTER TABLE hymns ADD COLUMN musical_key TEXT NOT NULL DEFAULT '';
   ALTER TABLE hymns ADD COLUMN style TEXT;`,
];

/** Validates hymn metadata and parses the lyrics. Shared by create and edit so the rules cannot drift. */
function checkedHymnInput(input) {
  const title = String(input.title ?? '').trim();
  if (!title || title.length > MAX_TITLE) throw new Error(`Title must be 1 to ${MAX_TITLE} characters.`);
  const composer = String(input.composer ?? '').trim().slice(0, MAX_COMPOSER);
  const category = requireOneOf(input.category, CATEGORIES, 'Category');
  const language = requireOneOf(input.language, LANGUAGES, 'Language');
  // The musical key, as written: C, Bb, F#m, and so on.
  const musicalKey = String(input.musicalKey ?? '').trim().slice(0, MAX_KEY);

  const parsed = parseLyrics(input.raw);
  if (parsed.errors.length) throw new Error(parsed.errors[0]);
  return { title, composer, category, language, musicalKey, stanzas: parsed.stanzas, warnings: parsed.warnings };
}

/** Data access and lyric parsing for Song Lyrics. Pure: takes a database handle. */
export function createLyricsService(db) {
  const songCategories = createSongCategoryService(db);
  const q = {
    list: db.prepare(`
      SELECT h.id, h.title, h.composer, h.category, h.language, h.musical_key AS musicalKey, h.song_category AS songCategory,
             (SELECT COUNT(*) FROM hymn_stanzas s WHERE s.hymn_id = h.id) AS stanzaCount
      FROM hymns h
      WHERE (@category IS NULL OR h.category = @category)
        AND (@language IS NULL OR h.language = @language)
        AND (@songCategory IS NULL OR h.song_category = @songCategory COLLATE NOCASE)
        AND (@term IS NULL
             OR h.title LIKE @term ESCAPE '\\'
             OR h.composer LIKE @term ESCAPE '\\'
             OR h.musical_key LIKE @term ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM hymn_stanzas s WHERE s.hymn_id = h.id AND s.lyrics_text LIKE @term ESCAPE '\\'))
      ORDER BY h.title COLLATE NOCASE`),
    hymn: db.prepare('SELECT id, title, composer, category, language, musical_key AS musicalKey, song_category AS songCategory, style AS styleJson FROM hymns WHERE id = ?'),
    setStyle: db.prepare('UPDATE hymns SET style = ? WHERE id = ?'),
    stanzas: db.prepare(`
      SELECT id, stanza_type AS stanzaType, lyrics_text AS lyricsText, display_order AS "order"
      FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order, id`),
    insertHymn: db.prepare('INSERT INTO hymns (title, composer, category, language, musical_key, song_category) VALUES (?, ?, ?, ?, ?, ?)'),
    insertStanza: db.prepare('INSERT INTO hymn_stanzas (hymn_id, stanza_type, lyrics_text, display_order) VALUES (?, ?, ?, ?)'),
    deleteHymn: db.prepare('DELETE FROM hymns WHERE id = ?'),
    updateHymn: db.prepare('UPDATE hymns SET title = ?, composer = ?, category = ?, language = ?, musical_key = ?, song_category = ? WHERE id = ?'),
    clearStanzas: db.prepare('DELETE FROM hymn_stanzas WHERE hymn_id = ?'),
    setlists: db.prepare('SELECT id, date, name FROM setlists ORDER BY date DESC, id DESC'),
    setlist: db.prepare('SELECT id, date, name FROM setlists WHERE id = ?'),
    insertSetlist: db.prepare('INSERT INTO setlists (name, date) VALUES (?, ?)'),
    deleteSetlist: db.prepare('DELETE FROM setlists WHERE id = ?'),
    entries: db.prepare(`
      SELECT si.position, h.id AS hymnId, h.title, h.composer, h.category, h.language
      FROM setlist_items si
      JOIN hymns h ON h.id = si.hymn_id
      WHERE si.setlist_id = ?
      ORDER BY si.position`),
    clearItems: db.prepare('DELETE FROM setlist_items WHERE setlist_id = ?'),
    insertItem: db.prepare('INSERT INTO setlist_items (setlist_id, hymn_id, position) VALUES (?, ?, ?)'),
  };

  const insertHymnWithStanzas = db.transaction((title, composer, category, language, musicalKey, songCategory, stanzas) => {
    const { lastInsertRowid } = q.insertHymn.run(title, composer, category, language, musicalKey, songCategory);
    stanzas.forEach((s, i) => q.insertStanza.run(lastInsertRowid, s.stanzaType, s.lyricsText, i + 1));
    return Number(lastInsertRowid);
  });

  const replaceHymn = db.transaction((id, hymn) => {
    q.updateHymn.run(hymn.title, hymn.composer, hymn.category, hymn.language, hymn.musicalKey, hymn.songCategory, id);
    q.clearStanzas.run(id);
    hymn.stanzas.forEach((s, i) => q.insertStanza.run(id, s.stanzaType, s.lyricsText, i + 1));
  });

  const replaceSetlist = db.transaction((setlistId, hymnIds) => {
    q.clearItems.run(setlistId);
    hymnIds.forEach((hymnId, i) => q.insertItem.run(setlistId, hymnId, i + 1));
    return hymnIds.length;
  });

  const requireSetlist = (id) => {
    const setlist = q.setlist.get(id);
    if (!setlist) throw new Error('That setlist no longer exists.');
    return setlist;
  };

  return {
    listHymns(filter = {}) {
      // Matches the title, the composer, and any line of any stanza. The term is escaped so that a typed % or _ is literal.
      const term = String(filter.search ?? '').trim();
      const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      return q.list.all({
        category: CATEGORIES.includes(filter.category) ? filter.category : null,
        language: LANGUAGES.includes(filter.language) ? filter.language : null,
        songCategory: filter.songCategory ? String(filter.songCategory) : null,
        term: term ? `%${escaped}%` : null,
      });
    },

    getHymn(id) {
      const hymn = q.hymn.get(id);
      if (!hymn) return null;
      // The style is stored as JSON. It is checked on the way out, as it is on the way in.
      const { styleJson, ...details } = hymn;
      return { ...details, style: parseTextStyle(styleJson), stanzas: q.stanzas.all(id) };
    },

    /** Parses the pasted lyrics and stores the hymn with its stanzas in one transaction. */
    createHymn(input = {}) {
      const hymn = checkedHymnInput(input);
      const songCategory = resolveSongCategory(db, input.songCategory);
      const id = insertHymnWithStanzas(hymn.title, hymn.composer, hymn.category, hymn.language, hymn.musicalKey, songCategory, hymn.stanzas);
      return { id, warnings: hymn.warnings };
    },

    /** Updates the hymn's details and replaces its stanzas with a fresh parse of `raw`. */
    editHymn(id, input = {}) {
      const current = q.hymn.get(id);
      if (!current) throw new Error('That hymn no longer exists.');
      const hymn = checkedHymnInput(input);
      hymn.songCategory = resolveSongCategory(db, input.songCategory, current.songCategory);
      replaceHymn(id, hymn);
      return { id, warnings: hymn.warnings };
    },

    /** Saves how this song is set on the projector. Null returns it to the default look. */
    setStyle(id, style) {
      if (!q.hymn.get(id)) throw new Error('That hymn no longer exists.');
      const checked = sanitizeTextStyle(style);
      q.setStyle.run(checked ? JSON.stringify(checked) : null, id);
      return checked;
    },

    deleteHymn(id) {
      return q.deleteHymn.run(id).changes > 0;
    },

    listSetlists() {
      return q.setlists.all();
    },

    createSetlist(input = {}) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > MAX_SETLIST_NAME) throw new Error(`Setlist name must be 1 to ${MAX_SETLIST_NAME} characters.`);
      const date = String(input.date ?? '');
      if (!DATE.test(date)) throw new Error('Date must be in the form YYYY-MM-DD.');
      const { lastInsertRowid } = q.insertSetlist.run(name, date);
      return { id: Number(lastInsertRowid), name, date };
    },

    deleteSetlist(id) {
      return q.deleteSetlist.run(id).changes > 0;
    },

    listSongCategories() {
      return songCategories.listSongCategories();
    },

    createSongCategory(input = {}) {
      return songCategories.createSongCategory(input);
    },

    renameSongCategory(id, input = {}) {
      return songCategories.renameSongCategory(id, input);
    },

    deleteSongCategory(id) {
      return songCategories.deleteSongCategory(id);
    },

    getSetlist(id) {
      requireSetlist(id);
      return q.entries.all(id);
    },

    /** Replaces the setlist's order. Hymns may appear more than once (e.g. a repeated Gloria). */
    saveSetlist(id, hymnIds) {
      requireSetlist(id);
      const ids = (Array.isArray(hymnIds) ? hymnIds : []).map(Number);
      return replaceSetlist(id, ids);
    },
  };
}

/** Registers the `lyrics:*` IPC channels. Called once from the main process. */
export function setupLyrics(db) {
  const service = createLyricsService(db);
  const handle = (channel, fn) => ipcMain.handle(`lyrics:${channel}`, (_event, ...args) => fn(...args));

  handle('listHymns', (filter) => service.listHymns(filter));
  handle('getHymn', (id) => service.getHymn(Number(id)));
  handle('createHymn', (input) => service.createHymn(input));
  handle('deleteHymn', (id) => service.deleteHymn(Number(id)));
  handle('editHymn', (id, input) => service.editHymn(Number(id), input));
  handle('setStyle', (id, style) => service.setStyle(Number(id), style));
  handle('listSetlists', () => service.listSetlists());
  handle('createSetlist', (input) => service.createSetlist(input));
  handle('deleteSetlist', (id) => service.deleteSetlist(Number(id)));
  handle('getSetlist', (id) => service.getSetlist(Number(id)));
  handle('listSongCategories', () => service.listSongCategories());
  handle('createSongCategory', (input) => service.createSongCategory(input));
  handle('renameSongCategory', (id, input) => service.renameSongCategory(Number(id), input));
  handle('deleteSongCategory', (id) => service.deleteSongCategory(Number(id)));
  handle('saveSetlist', (id, hymnIds) => service.saveSetlist(Number(id), hymnIds));
}
