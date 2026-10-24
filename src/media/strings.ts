import { mediaT, type MediaKey } from '../../shared/media-i18n.js';
import { useUi } from '../state/ui';

export type MediaT = (key: MediaKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Media Library, following the sidebar language switch. */
export function useMediaT(): MediaT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => mediaT(lang, key, vars);
}
