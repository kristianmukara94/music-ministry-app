import { createContext, useContext } from 'react';
import type { LiveState } from '../../shared/live.js';
import { useLive } from '../live/store';

/**
 * A frozen copy of the live state. The preview's lock sets it, so the picture stops following the projector.
 * Null means the live state is used.
 */
export const FrozenOutput = createContext<LiveState | null>(null);

/** Reads from the frozen copy when one is provided, and from the live state otherwise. */
export function useOutput<T>(select: (state: LiveState) => T): T {
  const frozen = useContext(FrozenOutput);
  const live = useLive((s) => s.state);
  return select(frozen ?? live);
}
