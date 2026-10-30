export interface Shortcut {
  id: string;
  /** The combo, like "F9" or "Ctrl+B". Empty while the shortcut waits to be assigned. */
  key: string;
  label: string;
  actionId: string;
  description?: string;
}

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export const ACTION_IDS: readonly [
  'announcements', 'welcome', 'blackout', 'clear',
  'lowerThird', 'stop', 'pauseProjector', 'pauseLowerThird',
  'nextSlide', 'prevSlide',
  'goLive', 'openLectionary', 'openHymns', 'openMedia',
];
export const RESERVED_COMBOS: string[];
export const DEFAULT_SHORTCUTS: Shortcut[];
export function normalizeKey(key: string): string;
export function comboOf(e: KeyEventLike): string | null;
export function isReserved(combo: string): boolean;
export function displayCombo(combo: string): string;
export function shortcutsFromKeymap(keymap: unknown, labels?: Record<string, string>): Shortcut[];
export function sanitizeShortcuts(list: unknown, validActionIds: string[]): Shortcut[];
export function findConflict(shortcuts: Shortcut[], combo: string, exceptId?: string): Shortcut | undefined;
