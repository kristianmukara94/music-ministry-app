import { lectT, type LectKey } from '../../shared/lectionary-i18n.js';
import { useUi } from '../state/ui';

export type LectT = (key: LectKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Lectionary, following the sidebar language switch. */
export function useLectT(): LectT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => lectT(lang, key, vars);
}
