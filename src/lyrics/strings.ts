import { lyT, type LyKey } from '../../shared/lyrics-i18n.js';
import { useUi } from '../state/ui';

export type LyT = (key: LyKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Song Lyrics module, following the sidebar language switch. */
export function useLyT(): LyT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => lyT(lang, key, vars);
}
