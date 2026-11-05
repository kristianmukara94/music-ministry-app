export interface CitationPassage {
  chapter: number;
  from: number;
  toChapter: number;
  /** Null for "to the end of the chapter", as in a chapter-only citation ("Ps 23"). */
  to: number | null;
}

export interface LectionaryCitation {
  /** The book as typed ("Lk", "1 Cor"). */
  book: string;
  /** Its USFM code ("LUK", "1CO"), the same in every translation. */
  code: string;
  /** In the order printed. A psalm's passages are its stanzas. */
  passages: CitationPassage[];
}

export function parseLectionaryCitation(text: string): LectionaryCitation | null;
export function inPassage(passage: CitationPassage, chapter: number, verse: number): boolean;
export function chaptersOf(parsed: LectionaryCitation): number[];
/** Where a verse of an English-numbered Bible sits in the Lectionary's (Hebrew) numbering: Ps 51:1 there is the Lectionary's 51:3. */
export function lectionaryRefOf(code: string, chapter: number, verse: number, chapterSize: number): { chapter: number; verse: number };
/** The chapters of an English-numbered Bible that hold verses of the Lectionary's `chapter`. */
export function bibleChaptersOf(code: string, chapter: number): number[];
