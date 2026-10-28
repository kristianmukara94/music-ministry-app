import type { TextStyle } from './text-style';

/** A prayer's split: none (one slide), the fit check's (auto), or the operator's breaks after the given lines (manual). */
export type PrayerSplit = { mode: 'auto'; of?: string } | { mode: 'manual'; at: number[]; of?: string };

export interface ScreenPage {
  text: string;
  /** The body size the page is drawn at, in pixels on the 1920 slide. */
  fontPx: number;
  /** Where the headline and body start, as a share of the height: the shared top, or the centred top of a short page. */
  top: number;
  centred: boolean;
}

export const SCREEN: { width: number; height: number };
export const DEFAULT_BODY_PX: number;
export const FLOOR_PX: number;

export function chosenPx(style: TextStyle | null | undefined): number;
export function screenFit(bodyPx: number, title: string): { widthPx: number; bodyPx: number; lineHeightPx: number; gapPx: number; maxHeightPx: number };
export function fitsScreen(text: string, title: string, bodyPx: number): boolean;
export function fittedPx(text: string, title: string, chosen: number): number;
export function normalizeSplit(split: unknown, body: string): PrayerSplit | null;
export function manualParts(body: string, at: number[]): string[];
/** The split after a break after line `k` is placed or removed. Removing the last break gives no split (the automatic split). */
export function placeBreak(body: string, split: unknown, k: number): { split: PrayerSplit | null };
/** How the panel describes a prayer's split: the breaks placed by hand, and the slides the automatic rule adds beyond them. */
export function splitSummaryOf(note: { body: string; split: PrayerSplit | null }): {
  mode: 'auto' | 'manual' | 'stale' | 'none';
  slides: number;
  manualBreaks: number;
  automaticSlides: number;
};
export function screenPagesOf(note: { title: string; body: string; style: TextStyle | null; split: PrayerSplit | null }): ScreenPage[];
export function screenTextHeight(text: string, title: string, bodyPx: number): number;
