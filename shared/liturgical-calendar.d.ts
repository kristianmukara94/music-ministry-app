import type { Season } from './liturgical-season.js';

export type LiturgicalColor = 'green' | 'violet' | 'white' | 'red' | 'rose';
export type LiturgicalRank = 'solemnity' | 'feast' | 'sunday' | 'weekday';
export type PlanStatus = 'ready' | 'draft';

export interface CalendarDay {
  iso: string;
  /** The Ordo code (see shared/liturgical-day.js). */
  code: string;
  color: LiturgicalColor;
  rank: LiturgicalRank;
  season: Season;
}

export function isoOfDate(date: Date): string;
export function monthGrid(year: number, month: number): string[][];
export function liturgicalColorOf(code: string): LiturgicalColor;
export function liturgicalRankOf(code: string, date: Date | string): LiturgicalRank;
export function calendarDayOf(iso: string): CalendarDay;
export function shortDayName(name: string): string;
export function monthDedicationKey(month: number): string;
export function requiredSlotsFor(iso: string): string[];
export function planStatusOf(iso: string, filledSlots: readonly string[] | null | undefined): PlanStatus;
export function seasonsOfMonth(year: number, month: number): Season[];
