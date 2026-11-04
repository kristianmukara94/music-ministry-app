import type { SlotItem } from './mass-slots.js';

export const PSALM: 'Responsorial Psalm';
export const PRAYER_OF_THE_FAITHFUL: 'Prayer of the Faithful';
export const RESPONSE_READINGS: readonly string[];
export function hasResponse(readingType: string): boolean;

export const DAILY_READING_SLOTS: readonly { slot: string; readingType: string }[];

export function readingItem(date: string, readingType: string): { module: 'lectionary'; sourceId: string; label: string };

/** The part of a Lectionary day the rules read. */
export interface DailyReadingDay {
  readings: readonly { readingType: string; rawText: string }[];
}

export interface DailyReadingsOutcome<T> {
  items: T[];
  filled: string[];
  current: string[];
  kept: string[];
  missing: string[];
}

export function withDailyReadings<T extends SlotItem & { module: string; sourceId: string; stale?: boolean }>(
  items: T[],
  date: string,
  day: DailyReadingDay | null | undefined,
  opts?: { replace?: boolean },
): DailyReadingsOutcome<T>;

export function responsePagesOf(rawText: string | null | undefined): string[];
