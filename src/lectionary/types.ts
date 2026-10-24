import type { TextStyle } from '../../shared/text-style';

export type ReadingType = 'First Reading' | 'Responsorial Psalm' | 'Second Reading' | 'Gospel';

export const READING_TYPES: readonly ReadingType[] = ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel'];

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

export interface LectionaryApi {
  getDay(date: string): Promise<LectionaryDay>;
  saveReading(input: SaveReadingInput): Promise<boolean>;
  clearReading(date: string, readingType: ReadingType): Promise<boolean>;
  setSeasonInfo(date: string, seasonInfo: string): Promise<number>;
}
