import { ipcMain } from 'electron';

export const BIBLE_SCOPES = ['all', 'ot', 'nt'];
const TRANSLATION_IDS = ['WEB', 'TGL', 'CEB'];
const MAX_RESULTS = 200;
const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 40;
// Snippet markers. Scripture never contains these, so the renderer can split on them safely.
const HIT_OPEN = '«';
const HIT_CLOSE = '»';

const requireTranslation = (id) => {
  if (!TRANSLATION_IDS.includes(id)) throw new Error(`Translation must be one of: ${TRANSLATION_IDS.join(', ')}.`);
  return id;
};

const requireInt = (value, label) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive whole number.`);
  return n;
};

/**
 * Turns free text into a safe FTS5 query. Each word becomes a quoted prefix term, so
 * punctuation and FTS operators (AND, NOT, *, :) cannot break the query. Words are joined
 * with implicit AND: every word must appear in the verse.
 */
export function ftsQuery(input) {
  const terms = String(input ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .map((term) => term.slice(0, MAX_TERM_LENGTH))
    .map((term) => `"${term.replace(/"/g, '""')}"*`);
  return terms.join(' ');
}

/** Read-only access to the Bible tables. Pure: takes a database handle. */
export function createBibleService(db) {
  const q = {
    translations: db.prepare('SELECT id, name, language, license, attribution FROM bible_translations ORDER BY rowid'),
    books: db.prepare(`
      SELECT b.book_number AS number, b.code, b.name, b.testament,
             (SELECT MAX(v.chapter) FROM bible_verses v
               WHERE v.translation_id = b.translation_id AND v.book_number = b.book_number) AS chapters
      FROM bible_books b
      WHERE b.translation_id = ?
      ORDER BY b.book_number`),
    chapters: db.prepare(`
      SELECT chapter, COUNT(*) AS verses FROM bible_verses
      WHERE translation_id = ? AND book_number = ?
      GROUP BY chapter ORDER BY chapter`),
    verses: db.prepare(`
      SELECT verse, text FROM bible_verses
      WHERE translation_id = ? AND book_number = ? AND chapter = ?
      ORDER BY verse`),
    search: db.prepare(`
      SELECT v.book_number AS bookNumber, b.name AS bookName, v.chapter, v.verse,
             snippet(bible_verses_fts, 0, @open, @close, '…', 16) AS snippet
      FROM bible_verses_fts
      JOIN bible_verses v ON v.id = bible_verses_fts.rowid
      JOIN bible_books b ON b.translation_id = v.translation_id AND b.book_number = v.book_number
      WHERE bible_verses_fts MATCH @query
        AND v.translation_id = @translationId
        AND (@scope = 'all'
             OR (@scope = 'ot' AND b.testament = 'OT')
             OR (@scope = 'nt' AND b.testament = 'NT')
             OR (@scope = 'book' AND v.book_number = @bookNumber))
      ORDER BY bible_verses_fts.rank, v.book_number, v.chapter, v.verse
      LIMIT @limit`),
  };

  return {
    getTranslations: () => q.translations.all(),

    getBooks(translationId) {
      return q.books.all(requireTranslation(translationId));
    },

    getChapters(translationId, bookNumber) {
      return q.chapters.all(requireTranslation(translationId), requireInt(bookNumber, 'Book'));
    },

    getVerses(translationId, bookNumber, chapter) {
      return q.verses.all(requireTranslation(translationId), requireInt(bookNumber, 'Book'), requireInt(chapter, 'Chapter'));
    },

    /**
     * Full-text search within one translation. `scope` is 'all', 'ot', 'nt', or a book
     * number as a string (e.g. '43') to search one book.
     */
    search({ query, translationId, scope = 'all' } = {}) {
      const match = ftsQuery(query);
      if (!match) return [];
      const requestedBook = /^\d+$/.test(String(scope)) ? requireInt(scope, 'Book') : null;
      if (!requestedBook && !BIBLE_SCOPES.includes(scope)) throw new Error('Scope must be all, ot, nt, or a book number.');
      return q.search.all({
        open: HIT_OPEN,
        close: HIT_CLOSE,
        query: match,
        translationId: requireTranslation(translationId),
        scope: requestedBook ? 'book' : scope,
        bookNumber: requestedBook ?? 0,
        limit: MAX_RESULTS,
      });
    },
  };
}

/** Registers the bible:* IPC channels. The renderer reads through these; it never touches SQLite. */
export function setupBible(db) {
  const service = createBibleService(db);
  const handle = (channel, fn) => ipcMain.handle(`bible:${channel}`, (_event, ...args) => fn(...args));

  handle('getTranslations', () => service.getTranslations());
  handle('getBooks', (translationId) => service.getBooks(translationId));
  handle('getChapters', (translationId, bookNumber) => service.getChapters(translationId, bookNumber));
  handle('getVerses', (translationId, bookNumber, chapter) => service.getVerses(translationId, bookNumber, chapter));
  handle('search', (input) => service.search(input));
  return service;
}
