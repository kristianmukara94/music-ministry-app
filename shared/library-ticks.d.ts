import type { PwSegment } from './pw.js';

export function toggleTick(ticked: string[], key: string): string[];
/** Shift + click: adds every visible key from the anchor row to the clicked row, either direction, after the ticked ones. */
export function tickRange(ticked: string[], keys: string[], anchor: number, index: number): string[];
/** What a click does to the selection: plain selects only that row, Ctrl/Cmd toggles it, Shift adds a range from the anchor. */
export function clickTick(
  ticked: string[],
  keys: string[],
  anchor: number | null,
  index: number,
  mods: { shift: boolean; toggle: boolean },
): { ticked: string[]; anchor: number | null };
export function addTicked(
  segments: PwSegment[],
  ticked: string[],
  tab: 'song' | 'prayer' | 'scripture',
): { segments: PwSegment[]; added: number; skipped: number; left: number };
