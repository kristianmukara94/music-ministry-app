export interface ScheduleLike {
  id?: number;
  liturgicalDate?: string;
  massTime?: string | null;
  massLanguage?: string | null;
}

export type ScheduleLanguage = 'English' | 'Cebuano' | 'Tagalog';

export const SCHEDULE_LANGUAGES: readonly ScheduleLanguage[];
export const TIME_PRESETS: readonly string[];
export const MAX_MASS_TIME: number;
export const MAX_MASS_LANGUAGE: number;

export function normalizeMassTime(value: unknown): string;
export function normalizeMassLanguage(value: unknown): string;
export function isScheduleLanguage(value: unknown): value is ScheduleLanguage;
export function parseMassTime(value: unknown): number | null;
export function compareMassSchedules(a: ScheduleLike, b: ScheduleLike): number;
export function sortMassSchedules<T extends ScheduleLike & { liturgicalDate: string }>(plans: readonly T[], dateOrder?: 'asc' | 'desc'): T[];
export function schedulesOn<T extends ScheduleLike & { liturgicalDate: string }>(plans: readonly T[] | null | undefined, iso: string): T[];
export function scheduleLanguageCode(value: unknown): string;
export function planLanguageForSchedule(value: unknown): 'EN' | 'CEB' | 'TL' | null;
export function scheduleLanguageForPlan(code: unknown): ScheduleLanguage | '';
export function hasSchedule(plan: ScheduleLike | null | undefined): boolean;
export function scheduleLabel(plan: ScheduleLike | null | undefined, options?: { short?: boolean; languageLabel?: (name: ScheduleLanguage) => string }): string;
export function sameSchedule(a: ScheduleLike, b: ScheduleLike): boolean;
export function massDayAction(plansOnDay: readonly unknown[] | null | undefined): 'create' | 'pick';
export function cellScheduleBadges<T>(plansOnDay: readonly T[] | null | undefined, max?: number): { shown: T[]; more: number };
