import type { PwSegment } from './pw.js';

export function toggleTick(ticked: string[], key: string): string[];
export function addTicked(
  segments: PwSegment[],
  ticked: string[],
  tab: 'song' | 'prayer' | 'scripture',
): { segments: PwSegment[]; added: number; skipped: number; left: number };
