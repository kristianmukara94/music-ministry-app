import type { SlideLine } from './live.js';

export const FIT_STEPS: readonly number[];
export const FIT_LEADING: readonly (number | null)[];
export function pickFitStep(
  fits: (scale: number, leading: number | null) => boolean,
  steps?: readonly number[],
  leading?: readonly (number | null)[],
): { index: number; scale: number; leading: number | null; overflow: boolean };
export const SAFE_AREA: Readonly<{ top: number; bottom: number; side: number }>;
export const SPLIT_LIMITS: Readonly<{ maxChars: number; maxLines: number; charsPerLine: number }>;
export function wrappedRows(text: string, width?: number): number;
export function splitLongLine(line: SlideLine, maxChars: number): SlideLine[];
export function splitSlide(lines: SlideLine[], limits?: { maxChars: number; maxLines: number; charsPerLine?: number }): SlideLine[][];
export function splitDeck(title: string, slides: SlideLine[][], limits?: { maxChars: number; maxLines: number; charsPerLine?: number }): { slides: SlideLine[][]; labels: string[] | null };
