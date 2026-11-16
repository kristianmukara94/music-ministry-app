// The Holy Mass planner's Library: which slot a song card's Add puts the song in. Plain JS, so it can be tested without React.

import { MASS_SLOTS, indexOfSlot } from './mass-slots.js';
import { hasCategory } from './song-filing.js';

/**
 * The empty Holy Mass song slot a library song goes into when the operator presses Add on its card (or in its lyrics drawer): the first empty
 * song slot, in Mass order, filed under one of the song's own categories; failing that, the first empty song slot. Null when every song slot is
 * filled: the operator then drags the song onto the slot to replace. The card names the slot, so the operator sees where the song will go.
 */
export function songSlotFor(items, categories, slots = MASS_SLOTS) {
  const empty = slots.filter((slot) => slot.kind === 'song' && indexOfSlot(items, slot.id) < 0);
  return empty.find((slot) => slot.songCategory && hasCategory(categories, slot.songCategory)) ?? empty[0] ?? null;
}
