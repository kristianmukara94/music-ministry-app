export interface LyricSlide {
  stanzaType: string;
  lyricsText: string;
  /** True when the slide carries on the part before it, with no tag of its own. */
  continuation: boolean;
}

export interface SlideOptions {
  autoSplit?: boolean;
  maxLines?: number;
  wrapChars?: number;
}

export const SLIDE_LINES: number;
export const SLIDE_WRAP_CHARS: number;
export const CONTINUATION: '';
export const PART_CHOICES: readonly string[];

export function splitStanza(lines: string[], options?: Omit<SlideOptions, 'autoSplit'>): string[][];
export function lyricSlides(raw: string, options?: SlideOptions): { slides: LyricSlide[]; warnings: string[]; errors: string[] };
export function withContinuations(stanzas: { stanzaType: string; lyricsText: string }[]): LyricSlide[];
export function slidesToText(slides: LyricSlide[]): string;
export function slidesToSaved(slides: LyricSlide[]): string;
export function slidePart(slides: LyricSlide[], index: number): string;
export function setSlidePart(slides: LyricSlide[], index: number, part: string): LyricSlide[];
export function moveSlide(slides: LyricSlide[], from: number, to: number): LyricSlide[];
export function duplicateSlide(slides: LyricSlide[], index: number): LyricSlide[];
export function removeSlide(slides: LyricSlide[], index: number): LyricSlide[];
