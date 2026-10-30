// Keyboard shortcuts: how a key press is written down, and how saved shortcuts are cleaned up and migrated.
// Pure functions only, so the tests can run them without a window. The actions themselves live in src/operator/shortcuts.ts.

/** Every action a shortcut can run, in the order the picker lists them. The actions themselves are in src/operator/shortcuts.ts. */
export const ACTION_IDS = [
  'announcements', 'welcome', 'blackout', 'clear',
  'lowerThird', 'stop', 'pauseProjector', 'pauseLowerThird',
  'nextSlide', 'prevSlide',
  'goLive', 'openLectionary', 'openHymns', 'openMedia',
];

/** Combinations the app itself uses. They cannot be assigned to a shortcut. */
export const RESERVED_COMBOS = ['Ctrl+K', 'Ctrl+Shift+F', 'Ctrl+ArrowUp', 'Ctrl+ArrowDown'];

/** Keys that only modify another key. Pressing one alone does not complete a capture. */
const MODIFIER_ONLY = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'Dead', 'Unidentified', 'OS']);

/** Turns one key name into the form shortcuts are stored in: a single character is upper case, a space is "Space". */
export function normalizeKey(key) {
  if (key === ' ') return 'Space';
  if (typeof key === 'string' && key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * The combo for a key event, like "F9", "PageDown", "Ctrl+B" or "Ctrl+Alt+Shift+ArrowRight". Modifiers are always written in
 * the order Ctrl, Alt, Shift, Meta. Returns null while only a modifier is held, because that is not a shortcut yet.
 * @param {{ key: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean }} e
 * @returns {string | null}
 */
export function comboOf(e) {
  if (!e || typeof e.key !== 'string' || e.key === '' || MODIFIER_ONLY.has(e.key)) return null;
  const key = normalizeKey(e.key);
  const isLetter = key.length === 1 && key.toLowerCase() !== key.toUpperCase();
  // Shift is part of a printable symbol already ("!" is Shift+1), so only letters and named keys carry it.
  const shift = e.shiftKey && (isLetter || key.length > 1);
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (shift) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

/** True when the app already uses this combo for itself. */
export function isReserved(combo) {
  return RESERVED_COMBOS.includes(combo);
}

const DISPLAY = { PageUp: 'PgUp', PageDown: 'PgDn', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Delete: 'Del' };

/** A combo as it is printed on a keycap: "Ctrl+PageDown" becomes "Ctrl+PgDn". */
export function displayCombo(combo) {
  if (!combo) return '—';
  return combo.split('+').map((p) => DISPLAY[p] ?? p).join('+');
}

/** The default shortcuts. Each action appears once. */
export const DEFAULT_SHORTCUTS = [
  { id: 'sc-announcements', key: 'F9', label: 'Announcements', actionId: 'announcements' },
  { id: 'sc-welcome', key: 'F10', label: 'Welcome Screen', actionId: 'welcome' },
  { id: 'sc-blackout', key: 'F11', label: 'Black Screen', actionId: 'blackout' },
  { id: 'sc-clear', key: 'F12', label: 'Clear Projector', actionId: 'clear' },
];

/** What the old settings kept: one key per action. Empty keys were unbound and are dropped. */
export function shortcutsFromKeymap(keymap, labels = {}) {
  if (!keymap || typeof keymap !== 'object') return DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
  return Object.entries(keymap)
    .filter(([, key]) => typeof key === 'string' && key !== '')
    .map(([actionId, key]) => ({
      id: `sc-${actionId}`,
      key: normalizeKey(key),
      label: labels[actionId] ?? actionId,
      actionId,
    }));
}

/**
 * Cleans a saved list: drops anything malformed or for an action that no longer exists, and keeps only the first shortcut
 * for each action and for each key, so a damaged or hand-edited file cannot make two shortcuts fight over one key.
 * A shortcut with an empty key is kept: it is waiting to be assigned.
 */
export function sanitizeShortcuts(list, validActionIds) {
  if (!Array.isArray(list)) return [];
  const ids = new Set();
  const actions = new Set();
  const keys = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { id, key, label, actionId, description } = item;
    if (typeof id !== 'string' || typeof actionId !== 'string' || typeof key !== 'string') continue;
    if (!validActionIds.includes(actionId) || ids.has(id) || actions.has(actionId)) continue;
    const normalized = normalizeKey(key);
    if (normalized !== '' && keys.has(normalized)) continue;
    ids.add(id);
    actions.add(actionId);
    if (normalized !== '') keys.add(normalized);
    out.push({
      id,
      key: normalized,
      label: typeof label === 'string' && label ? label : actionId,
      actionId,
      ...(typeof description === 'string' && description ? { description } : {}),
    });
  }
  return out;
}

/** The other shortcut that already uses this key, if any. */
export function findConflict(shortcuts, combo, exceptId) {
  if (!combo) return undefined;
  return shortcuts.find((s) => s.id !== exceptId && s.key === combo);
}
