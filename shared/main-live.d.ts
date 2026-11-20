import type { LiveAction, LiveState, LowerThird } from './live.js';

export type MainRun = 'mass' | 'pw';

export interface MainLiveStatus {
  onAir: MainRun | null;
  parked: MainRun | null;
  override: boolean;
}

export function mainLiveStatus(state: LiveState): MainLiveStatus;
export function welcomeCover(state: LiveState): MainRun | null;
export function mainLiveTab(state: LiveState): MainRun | null;
export function restoreMassActions(state: LiveState, band?: LowerThird | null): LiveAction[] | null;
export function bandFixAction(state: LiveState, band: LowerThird | null | undefined): LiveAction | null;
