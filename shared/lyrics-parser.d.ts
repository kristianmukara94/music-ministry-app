export type HymnCategory = 'Entrance' | 'Offertory' | 'Communion' | 'Recessional' | 'General';
export type HymnLanguage = 'EN' | 'TL' | 'CEB';

export const CATEGORIES: readonly HymnCategory[];
export const LANGUAGES: readonly HymnLanguage[];
export const MAX_STANZAS: number;

export interface ParsedStanza {
  stanzaType: string;
  lyricsText: string;
}

export interface ParseResult {
  stanzas: ParsedStanza[];
  warnings: string[];
  errors: string[];
}

export function parseLyrics(raw: string): ParseResult;
export function toTaggedLyrics(stanzas: ParsedStanza[]): string;
