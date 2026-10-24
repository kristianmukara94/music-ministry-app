export type Testament = 'OT' | 'NT';

export interface Translation {
  id: 'WEB' | 'TGL' | 'CEB';
  name: string;
  language: 'en' | 'tl' | 'ceb';
  license: string;
  attribution: string;
}

export interface BibleBook {
  number: number;
  code: string;
  name: string;
  testament: Testament;
  /** Null only when the translation has no verses for the book. */
  chapters: number | null;
}

export interface ChapterInfo {
  chapter: number;
  verses: number;
}

export interface Verse {
  verse: number;
  text: string;
}

export interface SearchHit {
  bookNumber: number;
  bookName: string;
  chapter: number;
  verse: number;
  /** Matched words are wrapped in « and » by the service. */
  snippet: string;
}

export type SearchScope = 'all' | 'ot' | 'nt' | string;

export interface BibleApi {
  getTranslations(): Promise<Translation[]>;
  getBooks(translationId: string): Promise<BibleBook[]>;
  getChapters(translationId: string, bookNumber: number): Promise<ChapterInfo[]>;
  getVerses(translationId: string, bookNumber: number, chapter: number): Promise<Verse[]>;
  search(input: { query: string; translationId: string; scope: SearchScope }): Promise<SearchHit[]>;
}
