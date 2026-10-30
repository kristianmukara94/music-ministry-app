// Multi-add from the Praise & Worship Library: the operator ticks songs or prayers, then adds the ticked items to the empty slots of their
// type. Items fill the empty slots in the order they were ticked, in lineup order. The Library calls these same functions from its
// checkboxes and its "Add selected" button, so the tests drive the screen's logic.

import { fillEmptyPrayerSlots, fillEmptySongSlots } from './pw-slots.js';

/** The ticked keys with this one added at the end (in the order it was ticked), or removed when it is already ticked. */
export function toggleTick(ticked, key) {
  return ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key];
}

/**
 * Shift + click: the ticked keys with every key from `anchor` to `index` (inclusive, in either direction) added after them. `keys` are
 * the visible rows' keys in view order. Keys already ticked keep their place, so the order they were ticked in is not disturbed.
 */
export function tickRange(ticked, keys, anchor, index) {
  const start = Math.min(anchor, index);
  const end = Math.max(anchor, index);
  return [...new Set([...ticked, ...keys.slice(start, end + 1)])];
}

/**
 * What a click on the row at `index` does to the selection. `keys` are the visible rows' keys in view order, `anchor` is the row a range
 * starts from (null before any click), and `mods` says which modifier was held: `shift`, or `toggle` for Ctrl or Cmd.
 *   plain click    selects this row alone and drops every other selection
 *   Ctrl/Cmd click toggles this row and keeps the rest
 *   Shift click    adds every row from the anchor to this one; with no anchor yet it selects this row alone
 * Returns the new `{ ticked, anchor }`. A Shift range keeps its anchor, so the next Shift click measures from the same row.
 */
export function clickTick(ticked, keys, anchor, index, mods) {
  const key = keys[index];
  if (mods.shift) {
    if (anchor !== null) return { ticked: tickRange(ticked, keys, anchor, index), anchor };
    return { ticked: [key], anchor: index };
  }
  if (mods.toggle) return { ticked: toggleTick(ticked, key), anchor: index };
  return { ticked: [key], anchor: index };
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
