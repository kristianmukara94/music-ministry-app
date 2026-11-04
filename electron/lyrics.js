import { ipcMain } from 'electron';
import { CATEGORIES, LANGUAGES, parseLyrics, toTaggedLyrics } from '../shared/lyrics-parser.js';
import { arrangementWithSplit } from '../shared/pw-hot-edit.js';
import { parseTextStyle, sanitizeTextStyle } from '../shared/text-style.js';
import { SONG_CATEGORY_REQUIRED_EN, isSongCategoryMissing } from '../shared/hymn-category.js';
import { createSongCategoryService, resolveSongCategory } from './song-categories.js';
import { matchStanzaIds } from '../shared/stanza-ids.js';
import { isPrimaryCategory, legacyCategoryFor, normalizePrimary, scopesShownBy, DEFAULT_PRIMARY } from '../shared/song-taxonomy.js';

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

// Deleted hymns are kept for this many days, so a delete can be undone. After that the laptop removes them for good (local only).
export const RECYCLE_DAYS = 30;

/** The earliest deletion time still kept, as the database stores times: ISO text, so text comparison orders them. */
export const cutoffIso = (now) => new Date(now.getTime() - RECYCLE_DAYS * 24 * 60 * 60 * 1000).toISOString();

/**
 * Permanently deletes the hymns deleted more than RECYCLE_DAYS ago. Local only: it takes only the database, so it cannot reach the
 * cloud. The server keeps its own removed row; a later push simply does not list the song.
 */
export function purgeDeletedHymns(db, now = new Date()) {
  return db.prepare('DELETE FROM hymns WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoffIso(now)).changes;
}

// A hymn deleted by the planner keeps its row, its lyrics and its id, with the time it was deleted. Nothing else changes.
export const HYMN_DELETE_MIGRATIONS = [
  `ALTER TABLE hymns ADD COLUMN deleted_at TEXT;
   CREATE INDEX idx_hymns_deleted ON hymns (deleted_at);`,
];

/** Validates hymn metadata and parses the lyrics. Shared by create and edit so the rules cannot drift. */
function checkedHymnInput(input) {
  const title = String(input.title ?? '').trim();
  if (!title || title.length > MAX_TITLE) throw new Error(`Title must be 1 to ${MAX_TITLE} characters.`);
  const composer = String(input.composer ?? '').trim().slice(0, MAX_COMPOSER);
  // The legacy Mass slot follows from the scope and song category (see legacyCategoryFor). A caller that names one still gets it.
  const category = input.category == null || input.category === '' ? null : requireOneOf(input.category, CATEGORIES, 'Category');
  // A caller that sends no scope (an older form, a file import) saves a General song, which shows under every scope.
  const primaryCategory = input.primaryCategory == null || input.primaryCategory === '' ? DEFAULT_PRIMARY : input.primaryCategory;
  if (!isPrimaryCategory(primaryCategory)) throw new Error('Primary category must be General, Holy Mass or Praise & Worship.');
  const language = requireOneOf(input.language, LANGUAGES, 'Language');
  // The musical key, as written: C, Bb, F#m, and so on.
  const musicalKey = String(input.musicalKey ?? '').trim().slice(0, MAX_KEY);

  const parsed = parseLyrics(input.raw);
  if (parsed.errors.length) throw new Error(parsed.errors[0]);
  return { title, composer, category, primaryCategory, language, musicalKey, stanzas: parsed.stanzas, warnings: parsed.warnings };
}

/** Data access and lyric parsing for Song Lyrics. Pure: takes a database handle. */
/**
 * `onHymnChanged` is called after a hymn is created or edited, so the song list can be sent soon. It is called only after the save
 * is committed, and a failure in it never fails the save.
 *
 * `onLyricsChanged(id)` is called after any change an open window may be showing: a create, edit, delete, undo, or a projector style
 * change. Windows use it to reload the song, so the planners do not keep the lyrics they loaded at startup.
 */
export function createLyricsService(db, { onHymnChanged = () => {}, onLyricsChanged = () => {} } = {}) {
  const notifyLyrics = (id) => {
    try {
      onLyricsChanged(id);
    } catch {
      // The save is already done. A window that misses this reloads the song the next time it opens it.
    }
  };
  const changed = (id) => {
    try {
      onHymnChanged();
    } catch {
      // The save is already done. Sending the list is a later step, so a failure here is left for the timer to retry.
    }
    notifyLyrics(id);
  };
  const songCategories = createSongCategoryService(db);
  const q = {
    list: db.prepare(`
      SELECT h.id, h.title, h.composer, h.category, h.language, h.musical_key AS musicalKey, h.song_category AS songCategory, h.primary_category AS primaryCategory,
             (SELECT COUNT(*) FROM hymn_stanzas s WHERE s.hymn_id = h.id) AS stanzaCount
      FROM hymns h
      WHERE h.deleted_at IS NULL
        AND (@category IS NULL OR h.category = @category)
        AND (@language IS NULL OR h.language = @language)
        AND (@songCategory IS NULL OR h.song_category = @songCategory COLLATE NOCASE)
        AND (@scopeA IS NULL OR h.primary_category IN (@scopeA, @scopeB))
        AND (@term IS NULL
             OR h.title LIKE @term ESCAPE '\\'
             OR h.composer LIKE @term ESCAPE '\\'
             OR h.musical_key LIKE @term ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM hymn_stanzas s WHERE s.hymn_id = h.id AND s.lyrics_text LIKE @term ESCAPE '\\'))
      ORDER BY h.title COLLATE NOCASE`),
    hymn: db.prepare('SELECT id, title, composer, category, language, musical_key AS musicalKey, song_category AS songCategory, primary_category AS primaryCategory, style AS styleJson, deleted_at AS deletedAt FROM hymns WHERE id = ?'),
    // A hymn in the library: not deleted. Used by the plans, so a deleted hymn is shown as deleted rather than as present.
    liveHymn: db.prepare('SELECT 1 FROM hymns WHERE id = ? AND deleted_at IS NULL'),
    deletedHymn: db.prepare('SELECT 1 FROM hymns WHERE id = ? AND deleted_at IS NOT NULL'),
    deletedList: db.prepare(`
      SELECT id, title, deleted_at AS deletedAt FROM hymns
      WHERE deleted_at IS NOT NULL AND deleted_at >= ?
      ORDER BY deleted_at DESC, id DESC`),
    softDelete: db.prepare('UPDATE hymns SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'),
    undoDelete: db.prepare('UPDATE hymns SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL'),
    purgeOld: db.prepare('DELETE FROM hymns WHERE deleted_at IS NOT NULL AND deleted_at < ?'),
    setStyle: db.prepare('UPDATE hymns SET style = ? WHERE id = ?'),
    stanzas: db.prepare(`
      SELECT id, stanza_type AS stanzaType, lyrics_text AS lyricsText, display_order AS "order"
      FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order, id`),
    insertHymn: db.prepare('INSERT INTO hymns (title, composer, category, language, musical_key, song_category, primary_category) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertStanza: db.prepare('INSERT INTO hymn_stanzas (hymn_id, stanza_type, lyrics_text, display_order) VALUES (?, ?, ?, ?)'),
    // An edit keeps each stanza's id, so an id is passed in; null gives the stanza a new one.
    insertStanzaWithId: db.prepare('INSERT INTO hymn_stanzas (id, hymn_id, stanza_type, lyrics_text, display_order) VALUES (?, ?, ?, ?, ?)'),
    stanzaIds: db.prepare(`
      SELECT id, stanza_type AS stanzaType, lyrics_text AS lyricsText, display_order AS position
      FROM hymn_stanzas WHERE hymn_id = ? ORDER BY display_order, id`),
    updateHymn: db.prepare('UPDATE hymns SET title = ?, composer = ?, category = ?, language = ?, musical_key = ?, song_category = ?, primary_category = ? WHERE id = ?'),
    clearStanzas: db.prepare('DELETE FROM hymn_stanzas WHERE hymn_id = ?'),
    setlists: db.prepare('SELECT id, date, name FROM setlists ORDER BY date DESC, id DESC'),
    setlist: db.prepare('SELECT id, date, name FROM setlists WHERE id = ?'),
    insertSetlist: db.prepare('INSERT INTO setlists (name, date) VALUES (?, ?)'),
    deleteSetlist: db.prepare('DELETE FROM setlists WHERE id = ?'),
    entries: db.prepare(`
      SELECT si.position, h.id AS hymnId, h.title, h.composer, h.category, h.language, h.deleted_at IS NOT NULL AS deleted
      FROM setlist_items si
      JOIN hymns h ON h.id = si.hymn_id
      WHERE si.setlist_id = ?
      ORDER BY si.position`),
    clearItems: db.prepare('DELETE FROM setlist_items WHERE setlist_id = ?'),
    insertItem: db.prepare('INSERT INTO setlist_items (setlist_id, hymn_id, position) VALUES (?, ?, ?)'),
  };

  const insertHymnWithStanzas = db.transaction((title, composer, category, language, musicalKey, songCategory, primaryCategory, stanzas) => {
    const { lastInsertRowid } = q.insertHymn.run(title, composer, category, language, musicalKey, songCategory, primaryCategory);
    stanzas.forEach((s, i) => q.insertStanza.run(lastInsertRowid, s.stanzaType, s.lyricsText, i + 1));
    return Number(lastInsertRowid);
  });

  /**
   * Takes the id out of every saved lineup arrangement that names it, so a lineup never points at a stanza that no longer exists. Other
   * stanzas keep their place in the arrangement. Returns how many lineup segments changed. A database without the lineup tables has none.
   */
  /**
   * After a stanza is split, the second half follows the first in every saved lineup arrangement that names the first, so a lineup that sings
   * the song in its own order keeps all of the words. Returns how many lineup segments changed. A database without the lineup tables has none.
   */
  const insertSplitIntoLineups = (hymnId, firstId, secondId) => {
    let rows;
    try {
      rows = db.prepare('SELECT id, arrangement FROM pw_segments WHERE arrangement LIKE ?').all(`%"${hymnId}":%`);
    } catch {
      return 0;
    }
    let changed = 0;
    for (const row of rows) {
      const arrangement = JSON.parse(row.arrangement || '{}');
      const next = arrangementWithSplit(arrangement, hymnId, firstId, secondId);
      if (next === arrangement) continue;
      db.prepare('UPDATE pw_segments SET arrangement = ? WHERE id = ?').run(JSON.stringify(next), row.id);
      changed += 1;
    }
    return changed;
  };

  const dropStanzaIdsFromLineups = (hymnId, droppedIds) => {
    const gone = new Set(droppedIds.map(String));
    let rows;
    try {
      rows = db.prepare('SELECT id, arrangement FROM pw_segments WHERE arrangement LIKE ?').all(`%"${hymnId}":%`);
    } catch {
      return 0;
    }
    let changed = 0;
    for (const row of rows) {
      const arrangement = JSON.parse(row.arrangement || '{}');
      const key = String(hymnId);
      if (!Array.isArray(arrangement[key])) continue;
      const kept = arrangement[key].filter((sid) => !gone.has(String(sid)));
      if (kept.length === arrangement[key].length) continue;
      if (kept.length) arrangement[key] = kept;
      else delete arrangement[key];
      db.prepare('UPDATE pw_segments SET arrangement = ? WHERE id = ?').run(JSON.stringify(arrangement), row.id);
      changed += 1;
    }
    return changed;
  };

  /** Replaces a hymn's details and stanzas. Each stanza keeps its id where it has a counterpart; only the removed ones lose theirs. */
  const replaceHymn = db.transaction((id, hymn) => {
    const before = q.stanzaIds.all(id);
    const ids = matchStanzaIds(before, hymn.stanzas);
    const dropped = before.filter((o) => !ids.includes(o.id));
    q.updateHymn.run(hymn.title, hymn.composer, hymn.category, hymn.language, hymn.musicalKey, hymn.songCategory, hymn.primaryCategory, id);
    q.clearStanzas.run(id);
    hymn.stanzas.forEach((s, i) => q.insertStanzaWithId.run(ids[i], id, s.stanzaType, s.lyricsText, i + 1));
    const lineupsChanged = dropped.length ? dropStanzaIdsFromLineups(id, dropped.map((d) => d.id)) : 0;
    return { dropped, lineupsChanged };
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
      // A filter scope limits the list to that scope's songs and the General ones. General, or no scope, limits nothing.
      const [scopeA = null, scopeB = null] = scopesShownBy(normalizePrimary(filter.primaryCategory)) ?? [];
      return q.list.all({
        scopeA,
        scopeB,
        category: CATEGORIES.includes(filter.category) ? filter.category : null,
        language: LANGUAGES.includes(filter.language) ? filter.language : null,
        // Exactly this song category (letter case aside): no prefix, no part of a name. Blank, or nothing, means every category.
        songCategory: String(filter.songCategory ?? '').trim() || null,
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
      // Refused before anything is parsed or written: a hymn needs a song category.
      if (isSongCategoryMissing(input.songCategory)) throw new Error(SONG_CATEGORY_REQUIRED_EN);
      const hymn = checkedHymnInput(input);
      const songCategory = resolveSongCategory(db, input.songCategory);
      hymn.category ??= legacyCategoryFor(hymn.primaryCategory, songCategory);
      const id = insertHymnWithStanzas(hymn.title, hymn.composer, hymn.category, hymn.language, hymn.musicalKey, songCategory, hymn.primaryCategory, hymn.stanzas);
      changed(id);
      return { id, warnings: hymn.warnings };
    },

    /**
     * Saves several songs, each as `createHymn` would. Each is saved on its own, so one that is refused does not stop the rest. Resolves to
     * one result per input, in order: `{ id, title }` when it was saved, or `{ error }` with the reason it was not.
     */
    createHymns(inputs = []) {
      if (!Array.isArray(inputs)) throw new Error('No songs were given.');
      return inputs.map((input) => {
        try {
          const { id } = this.createHymn(input);
          return { id, title: String(input?.title ?? '').trim() };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      });
    },

    /**
     * Updates the hymn's details and replaces its stanzas with a fresh parse of `raw`. `wordsOnly` is for editLyrics, which sends the song's own
     * details back unchanged; the IPC handler never passes it, so the song form always needs a song category.
     */
    editHymn(id, input = {}, { wordsOnly = false } = {}) {
      // Refused before anything is written: saving an existing hymn needs a song category too. Hymns already saved without one are
      // left as they are until they are next saved in the song form. A change to the words alone keeps the song's filing, whatever it is.
      if (!wordsOnly && isSongCategoryMissing(input.songCategory)) throw new Error(SONG_CATEGORY_REQUIRED_EN);
      const current = q.hymn.get(id);
      if (!current) throw new Error('That hymn no longer exists.');
      if (current.deletedAt) throw new Error('That hymn was deleted. Undo the delete to change it.');
      const hymn = checkedHymnInput(input);
      hymn.songCategory = resolveSongCategory(db, input.songCategory, current.songCategory);
      // Untouched scope and song category keep the slot the song has, so an edit to the lyrics never changes where the lineup finds it. A change
      // to either follows the new pair.
      const sameFiling = current.primaryCategory === hymn.primaryCategory && current.songCategory.toLowerCase() === hymn.songCategory.toLowerCase();
      hymn.category ??= sameFiling ? current.category : legacyCategoryFor(hymn.primaryCategory, hymn.songCategory);
      const { dropped, lineupsChanged } = replaceHymn(id, hymn);
      // Each removed stanza is reported, so the operator knows its place in a lineup arrangement was taken out.
      const removed = dropped.map((d) => `${d.stanzaType} (stanza ${d.position}) was removed by this edit, and taken out of ${lineupsChanged} saved lineup arrangement${lineupsChanged === 1 ? '' : 's'}.`);
      changed(id);
      return { id, warnings: [...hymn.warnings, ...removed] };
    },

    /**
     * Replaces only the song's words with a fresh parse of `raw`: the live editor's save (Edit slide on air, Add slide) and the stanza split.
     * The title, composer, key, scope and song category are written back as they are stored, so the song keeps its filing and its Mass slot.
     * A song saved before a song category was required keeps having none: the words can change on air without anyone choosing one.
     */
    editLyrics(id, raw) {
      const hymn = this.getHymn(id);
      if (!hymn) throw new Error('That hymn no longer exists.');
      if (hymn.deletedAt) throw new Error('That hymn was deleted. Undo the delete to change it.');
      return this.editHymn(
        id,
        {
          title: hymn.title,
          composer: hymn.composer,
          language: hymn.language,
          musicalKey: hymn.musicalKey,
          songCategory: hymn.songCategory,
          primaryCategory: hymn.primaryCategory,
          raw,
        },
        { wordsOnly: true },
      );
    },

    /**
     * Splits one stanza into two that follow each other, both under the stanza's own label, for a stanza too long for one slide. The song keeps
     * its details, filing and Mass slot. The first half keeps the stanza's id, so a lineup or a slide on screen that points at it stays put, and
     * every saved lineup that sings the song in its own order gets the second half straight after the first.
     */
    splitStanza(id, index, parts) {
      const hymn = this.getHymn(id);
      if (!hymn || hymn.deletedAt) throw new Error('That hymn no longer exists.');
      const at = Number(index);
      const stanza = Number.isInteger(at) ? hymn.stanzas[at] : undefined;
      if (!stanza) throw new Error('That stanza is not in the song any more.');
      const [first, second] = (Array.isArray(parts) ? parts : []).map((part) => String(part ?? '').trim());
      if (!first || !second) throw new Error('Both halves of a split stanza need words.');
      const stanzas = [
        ...hymn.stanzas.slice(0, at),
        { stanzaType: stanza.stanzaType, lyricsText: first },
        { stanzaType: stanza.stanzaType, lyricsText: second },
        ...hymn.stanzas.slice(at + 1),
      ];
      const result = this.editLyrics(id, toTaggedLyrics(stanzas));
      const saved = q.stanzas.all(id);
      const firstId = saved[at]?.id ?? null;
      const secondId = saved[at + 1]?.id ?? null;
      const lineupsChanged = firstId === stanza.id && secondId !== null ? insertSplitIntoLineups(id, firstId, secondId) : 0;
      return { ...result, firstId, secondId, lineupsChanged };
    },

    /** Saves how this song is set on the projector. Null returns it to the default look. */
    setStyle(id, style) {
      if (!q.hymn.get(id)) throw new Error('That hymn no longer exists.');
      const checked = sanitizeTextStyle(style);
      q.setStyle.run(checked ? JSON.stringify(checked) : null, id);
      notifyLyrics(id);
      return checked;
    },

    /**
     * Deletes a hymn in the library. Nothing is removed: the row, its lyrics and its id stay, marked with the time it was deleted, so
     * it can be undone for RECYCLE_DAYS. The song list is sent after the delete is committed.
     */
    deleteHymn(id, now = new Date()) {
      const deleted = q.softDelete.run(now.toISOString(), id).changes > 0;
      if (deleted) changed(id);
      return deleted;
    },

    /** Hymns deleted within the last RECYCLE_DAYS, newest first, with the time each was deleted. */
    listDeletedHymns(now = new Date()) {
      return q.deletedList.all(cutoffIso(now));
    },

    /** Puts a deleted hymn back. Same row and same id, so plans and setlists that point at it are whole again. */
    undoDeleteHymn(id) {
      const restored = q.undoDelete.run(id).changes > 0;
      if (restored) changed(id);
      return restored;
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
      // A hymn deleted since it was added is kept in the setlist and marked deleted, so the planner can undo the delete.
      return q.entries.all(id).map((e) => ({ ...e, deleted: Boolean(e.deleted) }));
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
export function setupLyrics(db, options = {}) {
  const service = createLyricsService(db, options);
  const handle = (channel, fn) => ipcMain.handle(`lyrics:${channel}`, (_event, ...args) => fn(...args));

  handle('listHymns', (filter) => service.listHymns(filter));
  handle('getHymn', (id) => service.getHymn(Number(id)));
  handle('createHymn', (input) => service.createHymn(input));
  handle('createHymns', (inputs) => service.createHymns(inputs));
  handle('deleteHymn', (id) => service.deleteHymn(Number(id)));
  handle('listDeletedHymns', () => service.listDeletedHymns());
  handle('undoDeleteHymn', (id) => service.undoDeleteHymn(Number(id)));
  handle('editHymn', (id, input) => service.editHymn(Number(id), input));
  handle('editLyrics', (id, raw) => service.editLyrics(Number(id), String(raw ?? '')));
  handle('splitStanza', (id, index, parts) => service.splitStanza(Number(id), Number(index), parts));
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
