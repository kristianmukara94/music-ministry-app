import fs from 'node:fs';
import path from 'node:path';

/**
 * Bible text is reference data: it is written once, on first launch, and never edited in the app.
 * That is why the FTS index is rebuilt after the seed instead of being kept current by triggers.
 */
export const BIBLE_MIGRATIONS = [
  `
  CREATE TABLE bible_translations (
    id           TEXT PRIMARY KEY CHECK (id IN ('WEB', 'TGL', 'CEB')),
    name         TEXT NOT NULL,
    language     TEXT NOT NULL CHECK (language IN ('en', 'tl', 'ceb')),
    license      TEXT NOT NULL,
    attribution  TEXT NOT NULL
  );

  CREATE TABLE bible_books (
    translation_id  TEXT NOT NULL REFERENCES bible_translations (id),
    book_number     INTEGER NOT NULL CHECK (book_number BETWEEN 1 AND 73),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    testament       TEXT NOT NULL CHECK (testament IN ('OT', 'NT')),
    PRIMARY KEY (translation_id, book_number)
  );

  CREATE TABLE bible_verses (
    id              INTEGER PRIMARY KEY,
    translation_id  TEXT NOT NULL REFERENCES bible_translations (id),
    book_number     INTEGER NOT NULL,
    chapter         INTEGER NOT NULL CHECK (chapter > 0),
    verse           INTEGER NOT NULL CHECK (verse > 0),
    text            TEXT NOT NULL,
    UNIQUE (translation_id, book_number, chapter, verse),
    FOREIGN KEY (translation_id, book_number) REFERENCES bible_books (translation_id, book_number)
  );

  -- External-content index: the text lives in bible_verses, the index stores only tokens.
  CREATE VIRTUAL TABLE bible_verses_fts USING fts5 (
    text,
    content = 'bible_verses',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];

/** Translations the app ships. Each has a JSON file in the bible data folder. */
export const BIBLE_FILES = [
  { id: 'WEB', file: 'web.json' },
  { id: 'TGL', file: 'tgl.json' },
  { id: 'CEB', file: 'ceb.json' },
];

const TESTAMENTS = ['OT', 'NT'];

/** Reads one translation file and checks its shape before anything is written. */
function readTranslation(dataDir, file) {
  const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  const { translation, books, verses } = data;
  if (!translation?.id || !Array.isArray(books) || !Array.isArray(verses)) {
    throw new Error(`${file} is not a Bible translation file.`);
  }
  for (const b of books) {
    if (!Number.isInteger(b.number) || (!TESTAMENTS.includes(b.testament) && b.testament !== 'DC')) {
      throw new Error(`${file} has an invalid book: ${JSON.stringify(b)}`);
    }
  }
  return data;
}

/**
 * Writes every translation that is not yet in the database. Runs in one transaction:
 * either all three translations and the search index land, or none do.
 * A translation already present is skipped, so this is safe to call on every launch.
 */
export function seedBible(db, dataDir) {
  const hasTranslation = db.prepare('SELECT 1 FROM bible_translations WHERE id = ?');
  const insertTranslation = db.prepare(
    'INSERT INTO bible_translations (id, name, language, license, attribution) VALUES (@id, @name, @language, @license, @attribution)',
  );
  const insertBook = db.prepare(
    'INSERT INTO bible_books (translation_id, book_number, code, name, testament) VALUES (@translationId, @number, @code, @name, @testament)',
  );
  const insertVerse = db.prepare(
    'INSERT INTO bible_verses (translation_id, book_number, chapter, verse, text) VALUES (?, ?, ?, ?, ?)',
  );

  const pending = BIBLE_FILES.filter(({ id }) => !hasTranslation.get(id));
  if (pending.length === 0) return { seeded: [] };

  // Parse before opening the transaction so a bad file fails without touching the database.
  const parsed = pending.map(({ id, file }) => {
    const data = readTranslation(dataDir, file);
    if (data.translation.id !== id) throw new Error(`${file} is for ${data.translation.id}, expected ${id}.`);
    return { id, data };
  });

  db.transaction(() => {
    for (const { id, data } of parsed) {
      const t = data.translation;
      insertTranslation.run({ id, name: t.name, language: t.language, license: t.license, attribution: t.attribution });
      for (const b of data.books) {
        // The deuterocanonical books sit among the Old Testament in Catholic order.
        insertBook.run({ translationId: id, number: b.number, code: b.code, name: b.name, testament: b.testament === 'NT' ? 'NT' : 'OT' });
      }
      for (const [book, chapter, verse, text] of data.verses) {
        insertVerse.run(id, book, chapter, verse, text);
      }
    }
    db.exec("INSERT INTO bible_verses_fts (bible_verses_fts) VALUES ('rebuild')");
  })();

  return { seeded: parsed.map((p) => p.id) };
}
