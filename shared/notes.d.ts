import type { TextStyle } from './text-style';
import type { PrayerSplit } from './prayer-screen';

export type NoteSection = 'prayers' | 'massFlow' | 'announcements';
export type NoteType = 'prayer' | 'massFlow' | 'announcement' | 'operator';

export const NOTE_DISPLAYS: readonly ['operator', 'full', 'lower'];
export function noteCategoryLabel(category: string): string;
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
  slot?: unknown;
}): { title: string; category: string; body: string; display: 'operator' | 'full' | 'lower'; style: TextStyle | null; split: PrayerSplit | null; slot?: string | null };

export const PRAYER_CATEGORIES: readonly string[];
export const MASS_FLOW_CATEGORIES: readonly string[];
export const ANNOUNCEMENT_CATEGORIES: readonly string[];
export const OPERATOR_CATEGORIES: readonly string[];
export const NOTE_SECTIONS: readonly NoteSection[];
export const NOTE_TYPES: readonly NoteType[];
export function sectionOfCategory(category: string): NoteSection;
export function categoriesForType(type: NoteType): readonly string[];
export function typeOfNote(note: { display: string; category: string }): NoteType;
export function typeOfSection(section: NoteSection): NoteType;
export function dividedNote(text: string): { body: string; split: { mode: 'manual'; at: number[] } | null };
export function slidesNote(pages: readonly string[]): { body: string; split: { mode: 'manual'; at: number[]; of?: string } | null };
export function dividedText(body: string, split: PrayerSplit | null | undefined): string;
export function noteSourceId(id: number, slides?: readonly number[] | null): string;
export function noteSource(sourceId: string | number | null | undefined): { id: number; slides: number[] | null } | null;
export function pickSlides<T>(pages: readonly T[], slides: readonly number[] | null | undefined): T[];
