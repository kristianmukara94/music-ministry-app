// Lectionary citations as the Mass books print them, read into passages the offline Bible can answer.
//
//   "Lk 4:1-13"                 one passage
//   "Ps 23:1-3a, 3b-4, 5, 6"    four passages: the psalm's stanzas. Verse parts (3a, 3bc) are read as the whole verse.
//   "Gn 2:7-9; 3:1-7"           a new chapter after a semicolon
//   "Mt 26:14—27:66"            a range across chapters
//   "Jn 11:1-45 or 11:3-7"      the first form only (the longer form, as printed first)
//   "Cf. Mt 4:4b", "Ps 23 (1)"  the "Cf." and the response number in brackets are dropped
//   "Ps 23"                     the whole chapter (to: null)
//
// Pure, so it runs in the renderer and under node:test. Run with: node --test shared/lectionary-citation.test.js
import { resolveBookCode } from './bible-ref.js';

/** One verse or a range, ending at `to` in `toChapter`. `to` is null for "to the end of the chapter". */
const PIECE = /^(?:(\d+):)?(\d+)[a-z]*(?:-(?:(\d+):)?(\d+)[a-z]*)?$/;
/** The book is everything before the first chapter number; a leading 1–3 belongs to it ("1 Cor"). */
const BOOK = /^((?:[1-3]\s*)?\p{L}[\p{L}.\s]*?)\s*(\d.*)$/u;

const tidy = (text) =>
  String(text ?? '')
    .replace(/[–—‒−]/g, '-')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+or\s+.*$/i, '')
    .replace(/^\s*(?:cf|see)\.?\s+/i, '')
    .replace(/\s*([:,;-])\s*/g, '$1')
    .trim();

/**
 * Reads a lectionary citation. Returns null when it is not one (empty, no chapter, or a book the Bible data does not know).
 * `passages` are in the order printed; each is { chapter, from, toChapter, to }.
 */
export function parseLectionaryCitation(text) {
  const match = BOOK.exec(tidy(text));
  if (!match) return null;
  const book = match[1].trim();
  const code = resolveBookCode(book);
  if (!code) return null;

  const passages = [];
  let chapter = null;
  for (const group of match[2].split(';').filter(Boolean)) {
    // A group without any colon is chapters only: "Ps 23" or "Ps 23,24".
    const chaptersOnly = !group.includes(':');
    for (const piece of group.split(',').filter(Boolean)) {
      if (chaptersOnly) {
        if (!/^\d+$/.test(piece)) return null;
        chapter = Number(piece);
        passages.push({ chapter, from: 1, toChapter: chapter, to: null });
        continue;
      }
      const m = PIECE.exec(piece);
      if (!m) return null;
      if (m[1] !== undefined) chapter = Number(m[1]);
      if (chapter === null) return null;
      const from = Number(m[2]);
      const toChapter = m[3] !== undefined ? Number(m[3]) : chapter;
      const to = m[4] !== undefined ? Number(m[4]) : from;
      if (chapter < 1 || from < 1 || toChapter < chapter || (toChapter === chapter && to < from)) return null;
      passages.push({ chapter, from, toChapter, to });
      chapter = toChapter;
    }
  }
  return passages.length > 0 ? { book, code, passages } : null;
}

/** Whether verse `chapter:verse` falls inside `passage`. */
export function inPassage(passage, chapter, verse) {
  if (chapter < passage.chapter || chapter > passage.toChapter) return false;
  if (chapter === passage.chapter && verse < passage.from) return false;
  if (chapter === passage.toChapter && passage.to !== null && verse > passage.to) return false;
  return true;
}

/** Psalms whose title the Lectionary counts as verse 1 (or 1 and 2), so its verse numbers run one (or two) ahead of an English Bible's. */
const PSALM_TITLE = new Map([
  ...[3, 4, 5, 6, 7, 8, 9, 12, 13, 18, 19, 20, 21, 22, 30, 31, 34, 36, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 53, 55, 56, 57, 58, 59, 61, 62,
    63, 64, 65, 67, 68, 69, 70, 75, 76, 77, 80, 81, 83, 84, 85, 88, 89, 92, 102, 108, 140, 142].map((psalm) => [psalm, 1]),
  [51, 2], [52, 2], [54, 2], [60, 2],
]);

/** Books where the Lectionary's chapters begin a few verses away from an English Bible's, so a chapter is read with its neighbours. */
const SHIFTED_BOOKS = new Set(['GEN', 'EXO', '1SA', '2SA', 'ISA', 'HOS', 'JOL', 'JON', 'MIC', 'ZEC', 'MAL']);

/**
 * Where a verse of a Bible numbered as English Bibles are (WEB, TGL and CEB all are) sits in the Lectionary's numbering, which follows the
 * Hebrew: a psalm's title is verse 1 (Ps 51:3 is the English 51:1), Malachi 3:19-24 is the English 4:1-6, Joel 4 is the English 3, and so
 * on. `chapterSize` is how many verses the Bible has in that chapter, which tells which way it places Daniel's Greek additions (3:24-90),
 * Romans' closing doxology and the last verses of 2 Corinthians.
 */
export function lectionaryRefOf(code, chapter, verse, chapterSize) {
  const at = (c, v) => ({ chapter: c, verse: v });
  const same = at(chapter, verse);
  switch (code) {
    case 'PSA':
      return chapter === 13 && verse === 6 ? same : at(chapter, verse + (PSALM_TITLE.get(chapter) ?? 0));
    case 'DAN':
      return chapter === 3 && chapterSize <= 33 && verse > 23 ? at(3, verse + 67) : same;
    case 'GEN':
      return chapter === 31 && verse === 55 ? at(32, 1) : chapter === 32 ? at(32, verse + 1) : same;
    case 'EXO':
      return chapter === 22 ? (verse === 1 ? at(21, 37) : at(22, verse - 1)) : same;
    case '1SA':
      return chapter === 23 && verse === 29 ? at(24, 1) : chapter === 24 ? at(24, verse + 1) : same;
    case '2SA':
      return chapter === 18 && verse === 33 ? at(19, 1) : chapter === 19 ? at(19, verse + 1) : same;
    case 'ISA':
      if (chapter === 9) return verse === 1 ? at(8, 23) : at(9, verse - 1);
      return chapter === 64 ? (verse === 1 ? at(63, 19) : at(64, verse - 1)) : same;
    case 'HOS':
      if (chapter === 1 && verse >= 10) return at(2, verse - 9);
      if (chapter === 2) return at(2, verse + 2);
      return chapter === 13 && verse === 16 ? at(14, 1) : chapter === 14 ? at(14, verse + 1) : same;
    case 'JOL':
      return chapter === 3 ? at(4, verse) : chapter === 2 && verse >= 28 ? at(3, verse - 27) : same;
    case 'JON':
      return chapter === 1 && verse === 17 ? at(2, 1) : chapter === 2 ? at(2, verse + 1) : same;
    case 'MIC':
      return chapter === 5 ? (verse === 1 ? at(4, 14) : at(5, verse - 1)) : same;
    case 'ZEC':
      return chapter === 1 && verse >= 18 ? at(2, verse - 17) : chapter === 2 ? at(2, verse + 4) : same;
    case 'MAL':
      return chapter === 4 ? at(3, verse + 18) : same;
    case 'ROM':
      return chapter === 14 && chapterSize > 23 && verse > 23 ? at(16, verse + 1) : same;
    case '2CO':
      return chapter === 13 && chapterSize === 14 && verse >= 13 ? at(13, verse - 1) : same;
    default:
      return same;
  }
}

/** The chapters of an English-numbered Bible that hold verses of the Lectionary's `chapter`, in order. */
export function bibleChaptersOf(code, chapter) {
  if (SHIFTED_BOOKS.has(code)) return [chapter - 1, chapter, chapter + 1].filter((c) => c >= 1);
  if (code === 'ROM' && chapter === 16) return [14, 16];
  return [chapter];
}

/** The chapters a parsed citation reads from, in order, each once. */
export function chaptersOf(parsed) {
  const out = [];
  for (const p of parsed.passages) for (let c = p.chapter; c <= p.toChapter; c++) if (!out.includes(c)) out.push(c);
  return out;
}
