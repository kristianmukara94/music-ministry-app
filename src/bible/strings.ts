import { bibleT, type BibleKey } from '../../shared/bible-i18n.js';
import { useUi } from '../state/ui';

export type BibleT = (key: BibleKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Bible module, following the sidebar language switch. */
export function useBibleT(): BibleT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => bibleT(lang, key, vars);
}
