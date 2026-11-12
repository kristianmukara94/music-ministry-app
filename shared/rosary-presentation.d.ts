import type { SequenceOptions } from './rosary-logic';

export interface RosaryPresentation extends SequenceOptions {
  beadTracker: boolean;
  backgroundId: number | null;
}

export const PRESENTATION_DEFAULTS: Readonly<RosaryPresentation>;
export function sanitizePresentation(raw: unknown): RosaryPresentation;

export const FIT_CHARS_PER_LINE: number;
export const FIT_MAX_LINES: number;

export interface SlideFit {
  chars: number;
  capacity: number;
  lines: number;
  maxLines: number;
  fits: boolean;
}

export function wrappedLineCount(text: string, charsPerLine?: number): number;
export function slideFit(text: string, options?: { charsPerLine?: number; maxLines?: number }): SlideFit;
