import { goLiveT, type GoLiveKey } from '../../shared/golive-i18n.js';
import { useUi } from '../state/ui';

export type GoLiveT = (key: GoLiveKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Go Live hub, following the sidebar language switch. */
export function useGoLiveT(): GoLiveT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => goLiveT(lang, key, vars);
}
