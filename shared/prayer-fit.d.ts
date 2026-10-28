/** The lineup's slide stage, in pixels. */
export const PRAYER_STAGE: { width: number; height: number };

/** A slide's fit: how many characters a line holds, how tall a line is, the gap between paragraphs, and the tallest text allowed. */
export interface PrayerFit {
  charsPerLine: number;
  lineHeightPx: number;
  gapPx: number;
  maxHeightPx: number;
}

export function prayerFit(options: {
  widthPx: number;
  fontPx: number;
  charWidthEm?: number;
  lineHeight: number;
  gapPx?: number;
  maxHeightPx: number;
}): PrayerFit;

/** The line height every lineup slide is drawn at, and the fit assumes. */
export const LINEUP_LINE_HEIGHT: number;
export const LINEUP_PRAYER_FIT: PrayerFit;
export const PRAYER_FIT_CHARS: number;
export const PRAYER_FIT_LINES: number;

export function visualLinesOf(line: string, charsPerLine?: number): number;
export function prayerTextHeight(text: string, fit?: PrayerFit): number;
export function fitsPrayerSlide(text: string, fit?: PrayerFit): boolean;
export function prayerPages(text: string, fit?: PrayerFit): string[];
