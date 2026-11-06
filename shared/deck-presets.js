// Presentation presets for the Announcements & Whiteboard deck, the speaker notes' text sizes, and which slides a card drag carries.
// Pure helpers, so the deck's rules can be tested without a window.

/**
 * The two ways the deck is run. An announcement loop plays itself before and after Mass; a sermon or manual deck is stepped by hand
 * with the notes open beside it.
 */
export const DECK_PRESETS = {
  loop: { autoplay: true, playback: { interval: 10, loop: true, showCount: false }, notesOpen: null },
  sermon: { autoplay: false, playback: { loop: false, showCount: true }, notesOpen: true },
};

/**
 * The playback a preset gives, from the current one. Settings the preset leaves alone (the sermon deck's interval) are kept.
 * @param {'loop' | 'sermon'} id
 * @param {{ interval: number; loop: boolean; showCount: boolean }} current
 */
export function applyPreset(id, current) {
  const preset = DECK_PRESETS[id];
  return preset ? { ...current, ...preset.playback } : current;
}

/**
 * The preset the deck is in, or null when the operator has set it some other way. Lit in the bar, so the operator sees which mode is on.
 * @param {{ interval: number; loop: boolean; showCount: boolean }} playback
 * @param {boolean} playing
 * @returns {'loop' | 'sermon' | null}
 */
export function activePreset(playback, playing) {
  if (playing && playback.loop && !playback.showCount && playback.interval === DECK_PRESETS.loop.playback.interval) return 'loop';
  if (!playing && !playback.loop && playback.showCount) return 'sermon';
  return null;
}

/** The speaker notes' text sizes, smallest first, as Tailwind classes (spelled out so Tailwind finds them). */
export const NOTES_SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'];
/** The size the notes open at: large enough to read from the lectern. */
export const DEFAULT_NOTES_SIZE = 3;

/**
 * A stored notes size, kept within the sizes there are.
 * @param {string | number | null | undefined} raw
 */
export function parseNotesSize(raw) {
  if (raw == null || raw === '') return DEFAULT_NOTES_SIZE;
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(NOTES_SIZES.length - 1, Math.max(0, n)) : DEFAULT_NOTES_SIZE;
}

/**
 * The item keys a card drag carries. A picked card brings every picked card with it, in the deck's order (both libraries; each folder
 * takes the ones of its own library). A card that is not picked is dragged alone.
 * @param {string} key the card the drag starts on
 * @param {Set<string>} checked the picked keys
 * @param {string[]} order every key, in the deck's order
 * @returns {string[]}
 */
export function dragItemKeys(key, checked, order) {
  if (!checked.has(key)) return [key];
  const picked = order.filter((k) => checked.has(k));
  return picked.includes(key) ? picked : [key, ...picked];
}

/** The drag type of announcement slides being filed into an announcement folder. It carries their ids as JSON. */
export const ANN_SLIDE_DRAG_TYPE = 'application/x-apcc-announcement-slides';
