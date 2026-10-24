export const MYSTERY_BY_WEEKDAY: readonly string[];
export const STEPS_PER_DECADE: number;
export const DECADES: number;
export const INTRO_BEADS: number;
export const DECADE_BEADS: number;
export const TOTAL_POSITIONS: number;

export type StepKind = 'announce' | 'creed' | 'our_father' | 'hail_mary' | 'glory_be' | 'fatima' | 'hail_holy_queen' | 'litany_loreto';

export interface RosaryStep {
  section: 'intro' | 'decade' | 'closing';
  decade: number | null;
  kind: StepKind;
  bead: number | null;
}

export function mysteryTypeFor(date: Date): string;
export function stepAt(position: number): RosaryStep;
export function positionOfIntro(): number;
export function positionOfDecade(decade: number): number;
export function positionOfClosing(kind: 'hail_holy_queen' | 'litany_loreto'): number;
export function beadPosition(step: RosaryStep, n: number): number;
