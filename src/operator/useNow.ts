import { useMemo, useSyncExternalStore } from 'react';
import { createSecondClock } from '../../shared/second-clock.js';

/** One timer for the whole window, however many readouts are on it. */
const clock = createSecondClock();

/** Current time, re-rendering on each second boundary. */
export function useNow() {
  const ms = useSyncExternalStore(clock.subscribe, clock.read);
  return useMemo(() => new Date(ms), [ms]);
}
