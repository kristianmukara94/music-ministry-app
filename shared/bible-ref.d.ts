export const BIBLE_TRANSLATION_IDS: readonly string[];

export interface PassageRef {
  translationId: string;
  bookName: string;
  chapter: number;
  from: number;
  to: number;
}

export interface TypedPassage {
  bookName: string;
  chapter: number;
  from: number;
  to: number;
}

export interface VerseRun {
  from: number;
  to: number;
}

export function formatSourceId(translationId: string, bookName: string, chapter: number, verses: string): string;
export function parseSourceId(sourceId: string): PassageRef | null;
export function parsePassageInput(text: string): TypedPassage | null;
export function runsOf(numbers: number[]): VerseRun[];
export function formatRuns(runs: VerseRun[]): string;
export function stripHits(snippet: string): string;

/** The USFM book code (e.g. "JHN") for a typed name or abbreviation, or null when unknown. */
export function resolveBookCode(text: string): string | null;

/** A citation as typed. Verses are absent for a chapter-only reference such as "Ps 23". */
export function parseCitation(text: string): { book: string; chapter: number; from?: number; to?: number } | null;
