// Multi-add from the Praise & Worship Library: the operator ticks songs or prayers, then adds the ticked items to the empty slots of their
// type. Items fill the empty slots in the order they were ticked, in lineup order. The Library calls these same functions from its
// checkboxes and its "Add selected" button, so the tests drive the screen's logic.

import { fillEmptyPrayerSlots, fillEmptySongSlots } from './pw-slots.js';

/** The ticked keys with this one added at the end (in the order it was ticked), or removed when it is already ticked. */
export function toggleTick(ticked, key) {
  return ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key];
}

/**
 * Adds the ticked items of one tab (`song` or `prayer`) to the empty slots of that type. An item already in the lineup is skipped,
 * not added twice. Returns the new segments, how many were added, how many were skipped as already in the lineup, and how many had no
 * empty slot left.
 */
export function addTicked(segments, ticked, tab) {
  const prefix = `${tab}-`;
  const ids = ticked.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length)));
  const placed = new Set(
    segments.flatMap((s) => {
      if (tab === 'song') return s.content.kind === 'song' ? s.content.hymnIds : [];
      return s.content.kind === 'prayer' && s.content.noteId != null ? [s.content.noteId] : [];
    }),
  );
  const fresh = ids.filter((id) => !placed.has(id));
  const filled = tab === 'song' ? fillEmptySongSlots(segments, fresh) : fillEmptyPrayerSlots(segments, fresh);
  return {
    segments: filled.segments,
    added: fresh.length - filled.left.length,
    skipped: ids.length - fresh.length,
    left: filled.left.length,
  };
}
