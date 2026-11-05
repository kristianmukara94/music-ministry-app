export type MassLanguage = 'EN' | 'TL' | 'CEB';

export const MASS_LANGUAGES: readonly MassLanguage[];
export const DEFAULT_MASS_LANGUAGE: 'EN';
export const LANGUAGE_BIBLE_MAP: Readonly<Record<MassLanguage, string>>;
export function isMassLanguage(value: unknown): value is MassLanguage;
export function massLanguageOf(value: unknown): MassLanguage;
export function uiLangOf(language: unknown): 'en' | 'tl' | 'ceb';
export function bibleOf(language: unknown): string;
export function otherBibles(language: unknown): string[];

export interface FlowSlot {
  id: string;
  type: string;
  label: string;
  defaultTitle?: string;
  isHymn?: boolean;
  isReading?: boolean;
  sundayOnly?: boolean;
  optional?: boolean;
}

export const PHILIPPINE_MASS_FLOW: Readonly<Record<MassLanguage, { sections: { id: string; title: string; slots: FlowSlot[] }[] }>>;
export function slotLabel(slot: { type: string; name: string } | null | undefined, language: unknown): string;
export function slotDefaultTitle(slot: { type: string } | null | undefined, language: unknown): string | null;
export function sectionTitle(section: { id: string; name: string } | null | undefined, language: unknown): string;
