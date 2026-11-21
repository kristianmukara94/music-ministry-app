import type { SlideLook } from './slide-look.js';

/** One slide of a song's default arrangement: exactly one projector slide. */
export interface SongSlide {
  /** The part the slide belongs to, as the slide shows it ("Verse 1", "Chorus"). */
  label: string;
  /** The part's short tag ("V1", "C"). */
  sectionTag: string;
  /** The slide's lines, exactly as shown. */
  lines: string[];
  /** The operator's booth notes for the slide. */
  notes?: string;
  /** The slide's own formatting. */
  style?: SlideLook;
}

/** A song's default arrangement, stamped with a hash of the words it was made from. */
export interface SongSlides {
  version: number;
  lyricsHash: string;
  slides: SongSlide[];
}

/** A stanza as the resolver reads and writes it. */
export interface SongSlideStanza {
  id: number;
  stanzaType: string;
  lyricsText: string;
  order?: number;
  pages?: string[];
  look?: SlideLook;
  notes?: string;
}

export const SONG_SLIDES_VERSION: number;
export const MAX_SONG_SLIDES: number;
export function lyricsHash(stanzas: readonly { stanzaType: string; lyricsText: string }[] | null | undefined): string;
export function sanitizeSongSlides(value: unknown): SongSlides | null;
export function songSlidesFor(stanzas: readonly { stanzaType: string; lyricsText: string }[], slides: readonly Partial<SongSlide>[]): SongSlides | null;
export function hasCurrentSongSlides(hymn: { stanzas: readonly { stanzaType: string; lyricsText: string }[]; defaultSlides?: unknown } | null | undefined): boolean;
export function songSlideIds(arrangement: SongSlides | null | undefined): number[];
export function resolveSongSlides<H extends { stanzas: readonly SongSlideStanza[]; defaultSlides?: unknown }>(hymn: H): H & { slideLayout: 'default' | 'auto' };
export function resolveSongSlides<H>(hymn: H): H;
export function songSlidesOf(
  hymn: { stanzas: readonly SongSlideStanza[] } | null | undefined,
  options?: { order?: readonly (string | number)[]; pagesOf?: (stanza: SongSlideStanza) => string[] | null | undefined },
): SongSlide[];
export function withSlideDetails(slides: readonly SongSlide[], index: number, details?: { look?: SlideLook | null; notes?: string }): SongSlide[];
