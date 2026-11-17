import { useCallback, useEffect, useRef, useState } from 'react';
import { goLiveNowCutsRun } from '../../shared/lyrics-live.js';
import { useLive } from '../live/store';

/** How long a first LIVE press stays armed when it would cut into a Holy Mass or Praise & Worship slide on air. */
export const LIVE_ARM_MS = 1500;

/**
 * The LIVE buttons of a planner library: one press shows the row at once, unless a Holy Mass queue or a Praise & Worship session is on the
 * projector. Then the first press only arms the button for a moment and a second press goes, so a stray click during a service never takes
 * the screen (the rule GO LIVE NOW uses, goLiveNowCutsRun). Shift + click, or `immediate`, goes at once.
 *
 * `run` does the show for a row key; while it runs that key is `pending`.
 */
export function useArmedLive(run: (key: string) => Promise<void>) {
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const press = useCallback(
    (key: string, immediate = false) => {
      if (pending !== null) return;
      window.clearTimeout(timer.current);
      if (!immediate && armed !== key && goLiveNowCutsRun(useLive.getState().state.projector)) {
        setArmed(key);
        timer.current = window.setTimeout(() => setArmed(null), LIVE_ARM_MS);
        return;
      }
      setArmed(null);
      setPending(key);
      void run(key).finally(() => setPending(null));
    },
    [armed, pending, run],
  );

  return { armed, pending, press };
}
