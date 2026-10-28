import type { PwSegment } from './pw.js';

export interface SlotItem {
  content: PwSegment['content'];
  arrangement: PwSegment['arrangement'];
  minutes: number;
}

export function capacityOf(segment: PwSegment): number;
export function itemOf(segment: PwSegment): SlotItem | null;
export function exchangeSlots(
  segments: PwSegment[],
  from: number,
  to: number,
): { segments: PwSegment[] } | { refused: 'type' | 'empty' | 'limit' | 'segment4' };
export function fillEmptySongSlots(segments: PwSegment[], hymnIds: number[]): { segments: PwSegment[]; left: number[] };
export function fillEmptyPrayerSlots(segments: PwSegment[], noteIds: number[]): { segments: PwSegment[]; left: number[] };
