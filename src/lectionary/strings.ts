import { lectT, type LectKey } from '../../shared/lectionary-i18n.js';
import type { ReadingType } from './types';
import { useUi } from '../state/ui';

export type LectT = (key: LectKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Lectionary, following the sidebar language switch. */
export function useLectT(): LectT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => lectT(lang, key, vars);
}

/** The string key of each reading's name. */
export const SLOT_KEY: Record<ReadingType, LectKey> = {
  'First Reading': 'slot_first',
  'Responsorial Psalm': 'slot_psalm',
  'Second Reading': 'slot_second',
  'Gospel Acclamation': 'slot_acclamation',
  Gospel: 'slot_gospel',
  'Prayer of the Faithful': 'slot_prayers',
};
