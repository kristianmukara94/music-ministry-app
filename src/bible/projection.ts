import type { SlideLine } from '../../shared/live.js';
import { formatRuns, runsOf } from '../../shared/bible-ref.js';
import { paginateSection, withFitter } from '../announcements/paginate';
import { bridge } from '../live/bridge';
import type { Verse } from './types';

const CITATION_PLACEHOLDER = '(99/99)';
/** Verse lines start with their number, so a page's verses can be read back from its text. */
const VERSE_START = /^(\d+) /;

export interface PassageName {
  bookName: string;
  chapter: number;
}

/**
 * Splits verses into projector slides with the same measurement the text pages use. Each verse is
 * one line starting with its number. Every slide ends with its own citation, for example
 * "1 Corinthians 13:1-3 (Page 1/3)", which names only the verses on that slide.
 *
 * `breaks` lists verse numbers that start a new slide, set by the operator. Each stretch between
 * breaks is paginated on its own, so a manual break is never crossed by an automatic one.
 * The room for the citation is reserved while measuring, so it never pushes text off the slide.
 */
export function scriptureSlides(verses: Verse[], passage: PassageName, pageLabel: string, breaks: number[] = []): SlideLine[][] {
  const groups: Verse[][] = [];
  for (const v of verses) {
    if (groups.length === 0 || breaks.includes(v.verse)) groups.push([v]);
    else groups[groups.length - 1].push(v);
  }

  return withFitter((fits) => {
    const pages: string[] = [];
    for (const group of groups) {
      const text = group.map((v) => `${v.verse} ${v.text}`).join('\n');
      pages.push(...paginateSection(text, (candidate) => fits(`${candidate}\n${CITATION_PLACEHOLDER}`)));
    }
    return pages.map((page, i) => {
      const numbers = page
        .split('\n')
        .map((line) => VERSE_START.exec(line))
        .flatMap((m) => (m ? [Number(m[1])] : []));
      const reference = referenceOf(passage.bookName, passage.chapter, runsOf(numbers));
      const cite = pages.length > 1 ? `${reference} (${pageLabel} ${i + 1}/${pages.length})` : reference;
      return [
        ...page.split('\n').map((line): SlideLine => ({ role: 'reader', text: line })),
        { role: 'cite', text: cite },
      ];
    });
  }, 0.8, 'serif');
}

/** The reference text for verses in one book and chapter, e.g. "John 3:16-17,19". */
export function referenceOf(bookName: string, chapter: number, runs: { from: number; to: number }[]): string {
  return `${bookName} ${chapter}:${formatRuns(runs)}`;
}

/**
 * Loads a passage from the local Bible. Book names differ between translations, so the name is
 * matched within the chosen translation. Throws when the passage is not in that translation.
 */
export async function loadPassage(translationId: string, bookName: string, chapter: number, from: number, to: number) {
  const books = await bridge.bible.getBooks(translationId);
  const book = books.find((b) => b.name.toLowerCase() === bookName.toLowerCase());
  if (!book) throw new Error(`${bookName} is not in this translation.`);
  const verses = (await bridge.bible.getVerses(translationId, book.number, chapter)).filter((v) => v.verse >= from && v.verse <= to);
  if (verses.length === 0) throw new Error(`${bookName} ${chapter}:${from}-${to} is not in this translation.`);
  return { book, chapter, verses, reference: referenceOf(book.name, chapter, [{ from, to }]) };
}
