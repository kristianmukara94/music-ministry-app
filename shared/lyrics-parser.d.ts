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

/** The section a line starts: its kind and number, or null for a lyric line. A bracket tag with an unknown kind has kind null. */
export function sectionHeader(line: string): { kind: string | null; number: string; tag: string | null } | null;
