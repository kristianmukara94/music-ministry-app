import type { PrayerSplit } from './prayer-screen.js';

/** Where every slide of a prayer starts, as a share of the height. */
export const PRAYER_TOP: number;
/** The share of the height kept free at the bottom for the lower third's smallest band. */
export const PRAYER_BAND_RESERVE: number;
/** The share of the stage the prayer text is drawn across: the narrowest surface's column. */
export const PRAYER_WIDTH_SHARE: number;
export const PRAYER_MAX_PX: number;
export const PRAYER_FLOOR_PX: number;

/** The height a prayer's text takes on the stage at a size, in pixels: its lines at the lineup's line height. */
export function prayerBlockHeightPx(text: string, px: number): number;
/** The top of each slide of one prayer, as `{ top, centred }`: normal slides share one top, a short slide is centred in the text area. */
export function pageTops(texts: string[], px?: number): { top: number; centred: boolean }[];

export function prayerBoxPx(): { top: number; bottom: number; height: number };
export function unitsOf(text: string): { text: string; joiner: string }[];

export interface PrayerPage {
  text: string;
  fontPx: number;
  /** Where this slide's text block starts, as a share of the height: the shared top, or the centred top of a short slide. */
  top: number;
  /** True when this slide is short, so it is centred in the text area on its own. */
  centred: boolean;
}

export interface PrayerSlides {
  /** 'manual': the operator's split. 'auto': the sentence split. 'stale': a manual split for text that has changed, so the automatic one is used. 'none': empty. */
  mode: 'manual' | 'auto' | 'stale' | 'none';
  fontPx: number;
  pages: PrayerPage[];
  /** True when even the smallest size does not fit a slide. */
  tooLong: boolean;
  /** The breaks placed by hand (0 for the automatic split). */
  manualBreaks: number;
  /** The slides the automatic rule makes beyond the sections the breaks mark out (all the slides, for the automatic split). */
  automaticSlides: number;
}

/** `scale` is the operator's text size (0.7 to 1.5). The pages are fitted at that size; each page's fontPx stays the normal size. */
export function prayerSlidesFor(text: string, split: PrayerSplit | { mode: string; at?: number[]; of?: string } | null | undefined, scale?: number): PrayerSlides;
