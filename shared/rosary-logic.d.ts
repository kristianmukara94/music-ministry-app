export const MYSTERY_BY_WEEKDAY: readonly string[];
export const STEPS_PER_DECADE: number;
export const DECADES: number;
export const INTRO_BEADS: number;
export const DECADE_BEADS: number;
export const TOTAL_POSITIONS: number;

export type StepKind = 'announce' | 'creed' | 'our_father' | 'hail_mary' | 'glory_be' | 'fatima' | 'hail_holy_queen' | 'litany_loreto' | 'st_michael';

export interface RosaryStep {
  section: 'intro' | 'decade' | 'closing';
  decade: number | null;
  kind: StepKind;
  bead: number | null;
}

/** The optional prayers in the deck. Any left out take their default. */
export interface SequenceOptions {
  fatima: boolean;
  litany: boolean;
  stMichael: boolean;
}

export const SEQUENCE_DEFAULTS: Readonly<SequenceOptions>;

export function mysteryTypeFor(date: Date): string;
export function stepsPerDecade(options?: Partial<SequenceOptions>): number;
export function closingPrayers(options?: Partial<SequenceOptions>): ('hail_holy_queen' | 'litany_loreto' | 'st_michael')[];
export function totalPositions(options?: Partial<SequenceOptions>): number;
export function stepAt(position: number, options?: Partial<SequenceOptions>): RosaryStep;
export function rosarySequence(options?: Partial<SequenceOptions>): RosaryStep[];
export function positionOfIntro(): number;
export function positionOfDecade(decade: number, options?: Partial<SequenceOptions>): number;
export function positionOfClosing(kind: 'hail_holy_queen' | 'litany_loreto' | 'st_michael', options?: Partial<SequenceOptions>): number;
export function beadPosition(step: RosaryStep, n: number, options?: Partial<SequenceOptions>): number;
