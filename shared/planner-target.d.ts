import type { LiveState } from './live.js';

export type PlannerKind = 'mass' | 'pw';

export interface PlannerTarget {
  kind: PlannerKind;
  id: number | null;
  date: string | null;
}

export interface PlannerTargetConsole {
  tab: PlannerKind;
  pickedPw?: number | null;
  pickedMass?: number | null;
  sessions?: ReadonlyArray<{ id: number; liturgicalDate: string }> | null;
  plans?: ReadonlyArray<{ id: number; liturgicalDate: string }> | null;
}

export function resolveMatchingPlannerTarget(state: LiveState, console: PlannerTargetConsole): PlannerTarget;
export function plannerTabTipKey(target: Pick<PlannerTarget, 'kind'>): 'plannerTipMass' | 'plannerTipPw';
