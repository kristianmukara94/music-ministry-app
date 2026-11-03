import type { SlideLine } from './live.js';

export type MassOrderLang = 'en' | 'tl' | 'ceb';
/** One language of a part as the parish saved it: its words and its title, each null when the standard one is kept. */
export interface MassOrderEntry {
  text: string | null;
  title: string | null;
}
export type MassOrderOverrides = Record<string, Partial<Record<MassOrderLang, MassOrderEntry>>>;
/** A part as the app lists and stages it. A parish item has `custom` set and no standard names or slides. */
export interface MassOrderPart {
  id: string;
  name: Partial<Record<MassOrderLang, string>>;
  slides: Partial<Record<MassOrderLang, SlideLine[][]>>;
  custom?: boolean;
}

export const MASS_ORDER_LANGS: MassOrderLang[];
export const MAX_MASS_ORDER_TEXT: number;
export const MAX_MASS_ORDER_SLIDES: number;
export const MAX_MASS_ORDER_TITLE: number;
export const MASS_ORDER_ID: RegExp;
export const MAX_MASS_ORDER_ID: number;
export const CUSTOM_PREFIX: 'mass_order_custom_';
export const CEB_STANDARD: Record<string, { name: string; text: string }>;
/** Starting points for a new parish item (the Nicene Creed). */
export const MASS_ORDER_TEMPLATES: { id: string; label: string; entries: Partial<Record<MassOrderLang, { title: string; text: string }>> }[];

export function isCustomId(id: unknown): boolean;
export function slidesToText(slides: SlideLine[][] | null | undefined): string;
export function textToSlides(text: string | null | undefined): SlideLine[][];
export function checkMassOrderText(text: string | null | undefined): { ok: true; slides: SlideLine[][] } | { ok: false; error: string };
export function cleanTitle(title: unknown): string | null;
export function massOrderLang(lang: string): MassOrderLang;
export function effectiveSlides(part: MassOrderPart, lang: string, overrides: MassOrderOverrides | null | undefined): SlideLine[][];
export function effectiveTitle(part: MassOrderPart, lang: string, overrides: MassOrderOverrides | null | undefined): string;
export function isCustomized(partId: string, lang: string, overrides: MassOrderOverrides | null | undefined): boolean;
export function overridesFromRows(rows: { partId: string; lang: string; text: string | null; title?: string | null }[] | null | undefined): MassOrderOverrides;
export function customParts(items: { id: string }[] | null | undefined): MassOrderPart[];
export function entryForSave(draft: { text: string; title: string }, standard: { standardText: string; standardTitle: string }): MassOrderEntry;
export function withPartNames<T extends { module: string; sourceId: string; label: string; stale?: boolean }>(items: T[], nameOf: (id: string) => string | null): T[];
