import { pwT, type PwKey } from '../../shared/pw-i18n.js';
import { useUi } from '../state/ui';

export type PwT = (key: PwKey, vars?: Record<string, string | number>) => string;

/** Localized labels for Praise & Worship, following the sidebar language switch. */
export function usePwT(): PwT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => pwT(lang, key, vars);
}
