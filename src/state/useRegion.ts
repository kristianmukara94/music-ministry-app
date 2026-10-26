import { useMemo } from 'react';
import { useUi } from './ui';
import { resolveRegion, useSystemRegion, type ResolvedRegion } from './region';

/** The region the app displays with right now: the laptop's in Auto, the saved choice in Manual. */
export function useRegion(): ResolvedRegion {
  const settings = useUi((s) => s.region);
  const system = useSystemRegion((s) => s.system);
  return useMemo(() => resolveRegion(settings, system), [settings, system]);
}
