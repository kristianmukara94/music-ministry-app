import { createContext, useContext } from 'react';
import type { LiveState } from '../../shared/live.js';
import { applyLook } from '../../shared/live.js';
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

/** Reads from the frozen copy when one is provided, and from the live state otherwise. An audience picture reads the on-air look. */
export function useOutput<T>(select: (state: LiveState) => T): T {
  const frozen = useContext(FrozenOutput);
  const audience = useContext(OnAirLook);
  const live = useLive((s) => s.state);
  const state = frozen ?? live;
  return select(audience ? onAir(state) : state);
}
