import { rosaryT, type RosaryKey } from '../../shared/rosary-i18n.js';
import { useUi } from '../state/ui';

export type RosaryT = (key: RosaryKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Rosary Guide, following the sidebar language switch. */
export function useRosaryT(): RosaryT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => rosaryT(lang, key, vars);
}
