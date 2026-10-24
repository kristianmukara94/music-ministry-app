import type { PlannerKey } from '../../shared/planner-i18n.js';
import type { LiturgicalBlock, PlanItem } from './types';

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
 * The run-sheet skeleton for a Mass, as operator notes. Liturgical names stay in English in every
 * language, the way parish worship aids print them. Notes are never shown on the projector.
 */
const SKELETON: [LiturgicalBlock, string][] = [
  ['introductory', 'Opening Hymn'],
  ['introductory', 'Penitential Act'],
  ['word', 'First Reading'],
  ['word', 'Responsorial Psalm'],
  ['word', 'Gospel Acclamation'],
  ['word', 'Gospel'],
  ['word', 'Homily'],
  ['word', 'Creed'],
  ['eucharist', 'Offertory'],
  ['eucharist', 'Sanctus'],
  ['eucharist', 'Communion'],
  ['concluding', 'Announcements'],
  ['concluding', 'Recessional'],
];

/** Blank plans start empty; the other seasons start from the skeleton, with a season note first. */
export function seasonItems(season: Season, note: (key: PlannerKey) => string): PlanItem[] {
  if (season === 'blank') return [];
  const items: PlanItem[] = [];
  if (season === 'advent' || season === 'lent') {
    items.push({ block: 'introductory', module: 'custom', sourceId: note('seasonGloriaOmitted'), label: note('seasonGloriaOmitted') });
  }
  for (const [block, label] of SKELETON) {
    items.push({ block, module: 'custom', sourceId: label, label });
  }
  return items;
}
