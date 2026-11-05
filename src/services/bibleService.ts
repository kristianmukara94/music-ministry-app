// The offline Bible as the Lectionary reads it: a citation in, the verses it names out. Everything comes from the Bible tables the app ships
// (see electron/bible-seed.js) through bridge.bible, so nothing is downloaded. Books and chapters are cached per translation, because a day's
// readings ask for the same few chapters again on every date change.
import { bridge } from '../live/bridge';
import type { BibleBook, Translation, Verse } from '../bible/types';
import { bibleChaptersOf, chaptersOf, inPassage, lectionaryRefOf, parseLectionaryCitation, type LectionaryCitation } from '../../shared/lectionary-citation.js';

/** A verse with its chapter and number as the Lectionary prints them, which can differ from the translation's own (see lectionaryRefOf). */
export interface CitationVerse extends Verse {
  chapter: number;
}

export interface CitationVerses {
  parsed: LectionaryCitation;
  /** The translation's own name for the book ("Luke", "Lucas"). */
  bookName: string;
  /** One list per printed passage (a psalm's stanzas), each verse once across the whole citation. */
  passages: CitationVerse[][];
}

export type CitationLookup =
  | { status: 'ok'; result: CitationVerses }
  /** The text is not a citation, or names a book the Bible data does not know. */
  | { status: 'unreadable' }
  /** The citation reads, but the translation has none of its verses. */
  | { status: 'notFound' };

const books = new Map<string, Promise<BibleBook[]>>();
const chapters = new Map<string, Promise<Verse[]>>();
let translations: Promise<Translation[]> | null = null;

/** A cached call. A failed one is forgotten, so the next ask tries again. */
const cached = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
};

export function getTranslations(): Promise<Translation[]> {
  if (!translations) {
    translations = bridge.bible.getTranslations();
    translations.catch(() => (translations = null));
  }
  return translations;
}

/** The verses a lectionary citation names ("Lk 4:1-13", "Ps 23:1-3a, 3b-4, 5, 6"), read from `translationId`. */
export async function getVersesByCitation(citation: string, translationId: string): Promise<CitationLookup> {
  const parsed = parseLectionaryCitation(citation);
  if (!parsed) return { status: 'unreadable' };
  const book = (await cached(books, translationId, () => bridge.bible.getBooks(translationId))).find((b) => b.code === parsed.code);
  if (!book) return { status: 'notFound' };

  // Every verse of the chapters the citation reads from, numbered as the Lectionary numbers them (see lectionaryRefOf). A chapter the
  // translation does not have is read as empty.
  const wanted = [...new Set(chaptersOf(parsed).flatMap((chapter) => bibleChaptersOf(parsed.code, chapter)))];
  const numbered = (
    await Promise.all(
      wanted.map(async (chapter) => {
        const verses = await cached(chapters, `${translationId}:${book.number}:${chapter}`, () => bridge.bible.getVerses(translationId, book.number, chapter)).catch(() => []);
        return verses.map((v): CitationVerse => ({ ...v, ...lectionaryRefOf(parsed.code, chapter, v.verse, verses.length) }));
      }),
    )
  )
    .flat()
    .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);

  // A verse split across stanzas ("3a, 3b") is read whole, in the first stanza that names it.
  const seen = new Set<string>();
  const passages = parsed.passages.map((passage) => {
    const out: CitationVerse[] = [];
    for (const v of numbered) {
      const key = `${v.chapter}:${v.verse}`;
      if (!inPassage(passage, v.chapter, v.verse) || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  });
  if (passages.every((p) => p.length === 0)) return { status: 'notFound' };
  return { status: 'ok', result: { parsed, bookName: book.name, passages: passages.filter((p) => p.length > 0) } };
}
