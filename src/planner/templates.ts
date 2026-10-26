import type { PlannerKey } from '../../shared/planner-i18n.js';
import { MASS_FLOW, stepSourceId } from '../../shared/mass-flow.js';
import type { PlanItem } from './types';

export type Season = 'blank' | 'advent' | 'lent' | 'ordinary';

export const SEASONS: Season[] = ['blank', 'advent', 'lent', 'ordinary'];

/** The season's key in planner-i18n.js, used for the picker label. */
export const SEASON_KEY: Record<Season, PlannerKey> = {
  blank: 'season_blank',
  advent: 'season_advent',
  lent: 'season_lent',
  ordinary: 'season_ordinary',
};

/**
 * A new Mass plan starts with the 31 steps of the Ordinary, as placeholders. Each placeholder is filled in by the operator
 * (a hymn, a Bible passage, a Mass Order text, or typed text). Liturgical names stay in English in every language.
 * Blank plans start empty. Advent and Lent leave out the Gloria step and note that it is omitted.
 */
export function seasonItems(season: Season, note: (key: PlannerKey) => string): PlanItem[] {
  if (season === 'blank') return [];
  const items: PlanItem[] = [];
  const omitsGloria = season === 'advent' || season === 'lent';
  if (omitsGloria) {
    items.push({ block: 'introductory', module: 'custom', sourceId: note('seasonGloriaOmitted'), label: note('seasonGloriaOmitted') });
  }
  for (const step of MASS_FLOW) {
    if (omitsGloria && step.id === 'gloria') continue;
    items.push({ block: step.block, module: 'custom', sourceId: stepSourceId(step), label: step.name });
  }
  return items;
}
