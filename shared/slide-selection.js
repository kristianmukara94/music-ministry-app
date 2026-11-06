// Picking Whiteboard slides for a bulk action: a single tick, a Shift-click range, and which keys the grid answers to.
// Pure functions only, so the tests can run them without a window.

/** A copy of the set with `ids` removed. */
export function without(set, ids) {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

/** A copy of the set with `id` added when absent, or removed when present. */
export function toggled(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The selection after a click on `target`'s tick. With Shift held and an anchor that is still shown, every slide between the anchor
 * and the target (both included, in the order shown) takes the state the target's tick is moving to, the way file managers do it.
 * Otherwise only the target flips.
 * @param {Set<number>} current
 * @param {number[]} order the slide ids in the order they are shown
 * @param {number | null} anchor the last tick clicked without Shift (or the start of the last range)
 * @param {number} target
 * @param {boolean} shift
 * @returns {Set<number>}
 */
export function clickSelection(current, order, anchor, target, shift) {
  const from = shift && anchor != null ? order.indexOf(anchor) : -1;
  const to = order.indexOf(target);
  if (from < 0 || to < 0) return toggled(current, target);
  const on = !current.has(target);
  const next = new Set(current);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  for (const id of order.slice(lo, hi + 1)) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * What a key press does to the slide grid's selection, or null when the grid leaves the key alone.
 * Ctrl+A (Cmd+A) picks every slide shown. Escape clears the selection, and Delete or Backspace asks to delete it; both only while
 * something is picked, so the keys keep their usual meaning otherwise.
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} e
 * @param {number} selected how many slides are picked
 * @returns {'selectAll' | 'clear' | 'delete' | null}
 */
export function selectionKey(e, selected) {
  const mod = Boolean(e.ctrlKey || e.metaKey);
  if (e.altKey) return null;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'a') return 'selectAll';
  if (mod || e.shiftKey || selected === 0) return null;
  if (e.key === 'Escape') return 'clear';
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  return null;
}

/** The drag-and-drop type a Whiteboard slide drag carries. Its data is a JSON array of slide ids. */
export const SLIDE_DRAG_TYPE = 'application/x-apcc-whiteboard-slides';

/**
 * Which slides a drag that starts on `id` carries. A picked slide brings every picked slide with it, in the deck's order;
 * a slide that is not picked is dragged alone, and the pick is left as it was.
 * @param {number} id
 * @param {Set<number>} checked
 * @param {number[]} order every slide id, in the deck's order
 * @returns {number[]}
 */
export function dragSlideIds(id, checked, order) {
  if (!checked.has(id)) return [id];
  return order.filter((slideId) => checked.has(slideId));
}

/**
 * The slide ids in a drag's data, or an empty list when the data is not a slide drag (a file, text from another app).
 * @param {string | null | undefined} raw
 * @returns {number[]}
 */
export function parseDragSlideIds(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id) => Number.isInteger(id) && id > 0))];
  } catch {
    return [];
  }
}

/** The Whiteboard grid's densities: how many slides fit across. */
export const GRID_COLUMNS = [3, 4, 6];
export const DEFAULT_GRID_COLUMNS = 4;

/**
 * A stored grid density, or the default when nothing (or something unknown) is stored.
 * @param {string | null | undefined} raw
 * @returns {3 | 4 | 6}
 */
export function parseGridColumns(raw) {
  const n = Number(raw);
  return GRID_COLUMNS.includes(n) ? n : DEFAULT_GRID_COLUMNS;
}
