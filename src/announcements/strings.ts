import { annT, type AnnKey } from '../../shared/announcements-i18n.js';
import { useUi } from '../state/ui';

export type AnnT = (key: AnnKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Announcements module, following the language switch in the sidebar. */
export function useAnnT(): AnnT {
  const lang = useUi((s) => s.lang);
  return (key, vars) =>
    Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), annT(lang, key));
}
