import { createContext, useContext } from 'react';
import type { LiveState } from '../../shared/live.js';
import { applyLook } from '../../shared/live.js';
import { withPlanAppearance, type PlanAppearance } from '../../shared/plan-appearance.js';
import { useLive } from '../live/store';

/**
 * A frozen copy of the live state. The preview's lock sets it, so the picture stops following the projector.
 * Null means the live state is used.
 */
export const FrozenOutput = createContext<LiveState | null>(null);

/**
 * True for a picture the audience sees (the Projector window): it draws the look that was on air at the pause, and it does not follow the
 * working settings until the projector resumes. The operator's mirror and thumbnails leave this false, so they show the working look.
 */
export const OnAirLook = createContext(false);

// The on-air version of a state, computed once per state object, so a selector that returns a settings object keeps its identity.
const onAirStates = new WeakMap<LiveState, LiveState>();

function onAir(state: LiveState): LiveState {
  let out = onAirStates.get(state);
  if (!out) {
    out = applyLook(state);
    onAirStates.set(state, out);
  }
  return out;
}

/**
 * The Plan Appearance of the slide being drawn (shared/plan-appearance.js), set by FrameView for its frame: every setting read below it is the
 * plan's where the plan sets one. Null draws the Global Appearance.
 */
export const PlanLook = createContext<PlanAppearance | null>(null);

/**
 * The Planner's Plan Appearance preview: a look to draw in place of the loaded plan's, so the operator sees the plan's draft before it is on
 * air. Undefined (the default) draws the look of the plan loaded for Go Live.
 */
export const PlanLookOverride = createContext<PlanAppearance | null | undefined>(undefined);

/**
 * Reads from the frozen copy when one is provided, and from the live state otherwise. An audience picture reads the on-air look. Inside a
 * plan's slide (PlanLook), the settings are the plan's typography over the Global Appearance.
 */
export function useOutput<T>(select: (state: LiveState) => T): T {
  const frozen = useContext(FrozenOutput);
  const audience = useContext(OnAirLook);
  const plan = useContext(PlanLook);
  const live = useLive((s) => s.state);
  const state = frozen ?? live;
  return select(withPlanAppearance(audience ? onAir(state) : state, plan));
}
