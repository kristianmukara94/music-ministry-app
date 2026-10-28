import type { TextStyle } from './text-style';
import type { PrayerSplit } from './prayer-screen';

export const NOTE_DISPLAYS: readonly ['operator', 'full', 'lower'];
export const NOTE_CATEGORIES: readonly string[];
export const MAX_NOTE_TITLE: number;
export const MAX_NOTE_BODY: number;

export function cleanNote(input: {
  title?: unknown;
  category?: unknown;
  body?: unknown;
  display?: unknown;
  style?: unknown;
  split?: unknown;
}): { title: string; category: string; body: string; display: 'operator' | 'full' | 'lower'; style: TextStyle | null; split: PrayerSplit | null };
