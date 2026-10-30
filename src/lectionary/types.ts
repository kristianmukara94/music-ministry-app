import type { TextStyle } from '../../shared/text-style';

export type ReadingType = 'First Reading' | 'Responsorial Psalm' | 'Second Reading' | 'Gospel Acclamation' | 'Gospel';

export const READING_TYPES: readonly ReadingType[] = ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel Acclamation', 'Gospel'];

/** Entered in the Lectionary for Praise & Worship. The Mass planner leaves it out of its library. */
export const GOSPEL_ACCLAMATION: ReadingType = 'Gospel Acclamation';

export interface ReadingRow {
  readingType: ReadingType;
  citation: string;
  congregationResponse: string;
  rawText: string;
  /** How this reading is set on the projector. Null keeps the default look. */
  style: TextStyle | null;
}

export interface LectionaryDay {
  date: string;
  seasonInfo: string;
  readings: ReadingRow[];
}

export interface SaveReadingInput {
  date: string;
  readingType: ReadingType;
  seasonInfo: string;
  citation: string;
  congregationResponse: string;
  rawText: string;
  style?: TextStyle | null;
}

/** What is saved on one date: the day's label, and the slots that have a reading. */
export interface LectionaryOverviewDay {
  date: string;
  seasonInfo: string;
  slots: ReadingType[];
}

/** What is in the library, and the slots saved on each date of the range that was asked for. */
export interface LectionaryOverview {
  readings: number;
  days: number;
  earliest: string | null;
  latest: string | null;
  bySlot: Record<ReadingType, number>;
  range: LectionaryOverviewDay[];
}

export interface LectionaryBackupResult {
  path: string;
  readings: number;
}

export interface LectionaryApi {
  getDay(date: string): Promise<LectionaryDay>;
  saveReading(input: SaveReadingInput): Promise<boolean>;
  clearReading(date: string, readingType: ReadingType): Promise<boolean>;
  setSeasonInfo(date: string, seasonInfo: string): Promise<number>;
  /** Library totals, and the slots saved on each date from `from` to `to` (at most 400 days). Read only. */
  overview(from: string, to: string): Promise<LectionaryOverview>;
  /** Asks where to save, then writes every reading to a JSON file. Null when cancelled. */
  exportJSON(): Promise<LectionaryBackupResult | null>;
  /** Asks for a backup file and restores it. A file with any bad reading changes nothing. Null when cancelled. */
  importJSON(): Promise<LectionaryBackupResult | null>;
}
