import { MASS_ORDER, massPartName } from '../liturgy/massOrder';
import type { MassSlot } from '../../shared/mass-slots.js';
import type { PickedItem } from './MassItemSelect';

/**
 * The ready-made fills of a slot that are not songs: the Mass Order text that matches it (Lord, Have Mercy has the Kyrie), then the opening
 * words of its own text (Prayer of the Faithful has "Lord, hear our prayer"). The cards offer them as chips and the picker lists them, so
 * both fill a slot with the same item.
 */
export function responseChoices(slot: MassSlot, lang: 'en' | 'tl' | 'ceb'): PickedItem[] {
  const choices: PickedItem[] = [];
  const part = slot.massOrderId ? MASS_ORDER.find((p) => p.id === slot.massOrderId) : undefined;
  if (part) choices.push({ module: 'mass_order', sourceId: part.id, label: massPartName(part, lang) });
  for (const text of slot.presets ?? []) choices.push({ module: 'custom', sourceId: text, label: text });
  return choices;
}
