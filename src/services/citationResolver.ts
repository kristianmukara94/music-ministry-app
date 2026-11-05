// A Lectionary citation turned into reading text from the offline Bible, ready for the editor and its slides.
//
// The text is the shipped Bible translation's (WEB, TGL or CEB), not the lectionary translation read at Mass in the Philippines, and psalm
// verse numbers can differ by one or two where a psalm has a title. It is a starting point the operator checks and saves; the Lectionary
// says where it came from until then.
import { lectT } from '../../shared/lectionary-i18n.js';
import { GOSPEL, hasResponse } from '../../shared/daily-readings.js';
import { readingSlides } from '../lectionary/pages';
import type { ReadingType } from '../lectionary/types';
import { getTranslations, getVersesByCitation, type CitationLookup } from './bibleService';

export interface ResolvedScripture {
  citation: string;
  translationId: string;
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
  /** For the editor: verse-numbered lines, a psalm's stanzas split by blank lines, and the reading's ending. */
  text: string;
  /** The slides it plays as, cut by the same Text Boundary Optimizer budget the projector uses, so no slide is cut off. */
  slides: string[];
}

export type ResolveResult = { status: 'ok'; scripture: ResolvedScripture } | Exclude<CitationLookup, { status: 'ok' }>;

/** The translation for the sidebar language: WEB for English, TGL for Tagalog, CEB for Cebuano. */
export const TRANSLATION_FOR_LANG: Record<string, string> = { en: 'WEB', tl: 'TGL', ceb: 'CEB' };

/** Parts whose text is scripture. The Prayer of the Faithful is the parish's own. */
export const fromScripture = (readingType: ReadingType) => readingType !== 'Prayer of the Faithful';

const endingKey = (readingType: ReadingType) =>
  readingType === GOSPEL ? 'endingGospel' : readingType === 'First Reading' || readingType === 'Second Reading' ? 'endingWord' : null;

export async function resolveCitationToText(citation: string, readingType: ReadingType, translationId = 'WEB'): Promise<ResolveResult> {
  const lookup = await getVersesByCitation(citation, translationId);
  if (lookup.status !== 'ok') return lookup;
  const { result } = lookup;
  const language = (await getTranslations().catch(() => [])).find((tr) => tr.id === translationId)?.language ?? 'en';

  // A psalm is sung by stanza, so its slides carry the words alone; a spoken reading keeps its verse numbers, one verse to a line.
  const stanzas = hasResponse(readingType);
  const blocks = result.passages.map((verses) => verses.map((v) => (stanzas ? v.text : `${v.verse} ${v.text}`)).join('\n'));
  const ending = endingKey(readingType);
  const text = blocks.join(stanzas ? '\n\n' : '\n') + (ending ? `\n\n${lectT(language, ending)}` : '');

  const first = result.passages[0][0];
  const last = result.passages.at(-1)!.at(-1)!;
  return {
    status: 'ok',
    scripture: {
      citation,
      translationId,
      book: result.bookName,
      chapter: first.chapter,
      startVerse: first.verse,
      endVerse: last.verse,
      text,
      slides: readingSlides(readingType, text),
    },
  };
}
