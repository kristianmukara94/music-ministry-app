import { MASS_ORDER, massPartName } from '../liturgy/massOrder';
import { READING_SLOTS, readingItem } from '../../shared/daily-readings.js';
import { slotDefaultTitle } from '../../shared/mass-language.js';
import type { MassSlot } from '../../shared/mass-slots.js';
import type { PickedItem } from './MassItemSelect';

/**
 * The ready-made fills of a slot that are not songs: the day's reading from the Lectionary (for a reading slot, when the plan's `date` is
 * known), the Mass Order text that matches it (Lord, Have Mercy has the Kyrie), its default title in the Mass language (Go in Peace), then the
 * opening words of its own text (Prayer of the Faithful has "Lord, hear our prayer"). The cards offer them as chips and the picker lists them,
 * so both fill a slot with the same item.
 */
export function responseChoices(slot: MassSlot, lang: 'en' | 'tl' | 'ceb', date?: string): PickedItem[] {
  const choices: PickedItem[] = [];
  const reading = date ? READING_SLOTS.find((r) => r.slot === slot.id) : undefined;
  if (reading && date) choices.push(readingItem(date, reading.readingType));
  const part = slot.massOrderId ? MASS_ORDER.find((p) => p.id === slot.massOrderId) : undefined;
  if (part) choices.push({ module: 'mass_order', sourceId: part.id, label: massPartName(part, lang) });
  // A slot with its Mass Order text needs no title of the same words.
  const title = part ? null : slotDefaultTitle(slot, lang);
  if (title) choices.push({ module: 'custom', sourceId: title, label: title });
  for (const text of slot.presets ?? []) {
    if (text.toLowerCase() !== title?.toLowerCase()) choices.push({ module: 'custom', sourceId: text, label: text });
  }
  return choices;
}
