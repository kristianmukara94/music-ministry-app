import type { TextStyle } from '../../shared/text-style';
export type HymnCategory = 'Entrance' | 'Offertory' | 'Communion' | 'Recessional' | 'General';
export type HymnLanguage = 'EN' | 'TL' | 'CEB';

export interface HymnSummary {
  id: number;
  title: string;
  composer: string;
  /** The musical key as written, such as C, Bb or F#m. Empty when not set. */
  musicalKey: string;
  category: HymnCategory;
  language: HymnLanguage;
  stanzaCount: number;
}

export interface Stanza {
  id: number;
  stanzaType: string;
  lyricsText: string;
  order: number;
}

export interface Hymn {
  id: number;
  title: string;
  composer: string;
  category: HymnCategory;
  language: HymnLanguage;
  musicalKey: string;
  /** How the song is set on the projector. Null keeps the default look. */
  style: TextStyle | null;
  stanzas: Stanza[];
}

export interface HymnFilter {
  search?: string;
  category?: HymnCategory | '';
  language?: HymnLanguage | '';
}

export interface NewHymn {
  title: string;
  composer: string;
  category: HymnCategory;
  language: HymnLanguage;
  musicalKey: string;
  raw: string;
}

export interface Setlist {
  id: number;
  date: string;
  name: string;
}

export interface SetlistEntry {
  position: number;
  hymnId: number;
  title: string;
  composer: string;
  category: HymnCategory;
  language: HymnLanguage;
}

export interface LyricsApi {
  listHymns(filter: HymnFilter): Promise<HymnSummary[]>;
  getHymn(id: number): Promise<Hymn | null>;
  createHymn(input: NewHymn): Promise<{ id: number; warnings: string[] }>;
  /** Updates the details and replaces the stanzas with a fresh parse of `input.raw`. */
  editHymn(id: number, input: NewHymn): Promise<{ id: number; warnings: string[] }>;
  deleteHymn(id: number): Promise<boolean>;
  listSetlists(): Promise<Setlist[]>;
  createSetlist(input: { name: string; date: string }): Promise<Setlist>;
  deleteSetlist(id: number): Promise<boolean>;
  getSetlist(id: number): Promise<SetlistEntry[]>;
  /** Replaces the setlist's order with these hymn ids, in sequence. */
  saveSetlist(id: number, hymnIds: number[]): Promise<number>;
  /** Saves how this song is set on the projector. Null returns it to the default look. */
  setStyle(id: number, style: TextStyle | null): Promise<TextStyle | null>;
}
