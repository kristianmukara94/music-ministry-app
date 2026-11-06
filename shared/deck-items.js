// The unified Announcements & Whiteboard deck: one list over two libraries.
// Announcement slides (pictures, text slides) and Whiteboard slides (designed slides, PowerPoint pictures) keep their own folders and their
// own storage; this module only decides what the combined panel shows, in what order, where a new slide goes, and how playback steps.
// Pure functions only, so the tests can run them without a window. Run with: node --test shared/
import { clickSelection } from './slide-selection.js';

/**
 * The Announcements folder that holds the pictures behind Whiteboard PowerPoint cards (the main process files them there). The deck lists
 * those pictures as Whiteboard cards, so the folder itself is not offered for editing.
 */
export const WHITEBOARD_POWERPOINT_FOLDER = 'Whiteboard PowerPoint';

/** Whether an announcement folder is that system folder. */
export const isSystemFolder = (name) => String(name ?? '').trim().toLowerCase() === WHITEBOARD_POWERPOINT_FOLDER.toLowerCase();

/** An item's key: the library it lives in and its id there, so the two id ranges never collide. */
export const itemKey = (source, id) => `${source === 'ann' ? 'a' : 'w'}:${id}`;

/**
 * The key's library and id, or null for anything else.
 * @param {string} key
 */
export function parseItemKey(key) {
  const m = /^([aw]):(\d+)$/.exec(String(key));
  return m ? { source: m[1] === 'a' ? 'ann' : 'wb', id: Number(m[2]) } : null;
}

/**
 * Which part of the deck the panel shows, as a string so it can be compared and stored:
 * 'all' (both libraries), 'ann' (every announcement), 'ann:<id>' (one announcement folder),
 * 'wb' (every Whiteboard slide), 'wb:unfiled' (Whiteboard slides in no folder), 'wb:<id>' (one Whiteboard folder).
 * @param {string} view
 */
export function parseDeckView(view) {
  if (view === 'ann') return { store: 'ann', folder: undefined };
  if (view === 'wb') return { store: 'wb', folder: undefined };
  if (view === 'wb:unfiled') return { store: 'wb', folder: null };
  const m = /^(ann|wb):(\d+)$/.exec(String(view));
  if (m) return { store: m[1], folder: Number(m[2]) };
  return { store: 'all', folder: undefined };
}

/**
 * The combined list: announcements first, in their folders' order, then the Whiteboard in its own order.
 * A Whiteboard PowerPoint card is backed by an announcement picture (its `slideId`); that picture is the same slide, so it is listed once,
 * as the Whiteboard card, and never twice.
 * @param {{ id: number, folderId: number, name: string, text?: string | null, headline?: string | null, notes?: string | null }[]} ann
 * @param {{ id: number, folderId: number | null, title: string, content?: string, slideId?: number | null, notes?: string | null }[]} wb
 */
export function buildDeckItems(ann, wb) {
  const backing = new Set(wb.map((s) => s.slideId).filter((id) => id != null));
  const join = (...parts) => parts.filter(Boolean).join('\n').toLowerCase();
  return [
    ...ann
      .filter((s) => !backing.has(s.id))
      .map((s) => ({
        key: itemKey('ann', s.id),
        source: 'ann',
        id: s.id,
        folderId: s.folderId,
        title: s.name,
        search: join(s.name, s.headline, s.text, s.notes),
      })),
    ...wb.map((s) => ({
      key: itemKey('wb', s.id),
      source: 'wb',
      id: s.id,
      folderId: s.folderId,
      title: s.title,
      search: join(s.title, s.content, s.notes),
    })),
  ];
}

/** The items the view holds, in deck order. */
export function itemsInView(items, view) {
  const { store, folder } = parseDeckView(view);
  if (store === 'all') return items;
  return items.filter((item) => item.source === store && (folder === undefined || item.folderId === folder));
}

/** The items whose title, text or notes contain every word of the query (case does not matter). An empty query keeps them all. */
export function searchItems(items, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => words.every((w) => item.search.includes(w)));
}

/**
 * Where a new slide or an import goes from this view: the open folder, or, when the view spans folders, the destination the operator chose
 * (`fallback`). A fallback that no longer exists is replaced by the first announcement folder, then by Whiteboard Unfiled.
 * @param {string} view
 * @param {{ store: 'ann' | 'wb', folderId: number | null } | null} fallback
 * @param {number[]} annFolderIds
 * @param {number[]} wbFolderIds
 * @returns {{ store: 'ann', folderId: number } | { store: 'wb', folderId: number | null }}
 */
export function destinationFor(view, fallback, annFolderIds, wbFolderIds) {
  const { store, folder } = parseDeckView(view);
  if (store === 'ann' && typeof folder === 'number') return { store: 'ann', folderId: folder };
  if (store === 'wb' && folder !== undefined) return { store: 'wb', folderId: folder };
  const valid = (d) =>
    d && (d.store === 'ann' ? annFolderIds.includes(d.folderId) : d.store === 'wb' && (d.folderId === null || wbFolderIds.includes(d.folderId)));
  // Inside one library, a chosen place in the other library does not apply.
  if (fallback && valid(fallback) && (store === 'all' || fallback.store === store)) return fallback;
  if (store !== 'wb' && annFolderIds.length > 0) return { store: 'ann', folderId: annFolderIds[0] };
  return { store: 'wb', folderId: null };
}

/** The view to show when `view` names a folder that is gone (deleted here or elsewhere): the library it was in. */
export function existingView(view, annFolderIds, wbFolderIds) {
  const { store, folder } = parseDeckView(view);
  if (typeof folder !== 'number') return view === 'ann' || view === 'wb' || view === 'wb:unfiled' ? view : 'all';
  const ids = store === 'ann' ? annFolderIds : wbFolderIds;
  return ids.includes(folder) ? view : store;
}

/**
 * Whether dragging a card to a new place in the grid can reorder it here. Announcement order is kept per folder, so only inside one folder;
 * the Whiteboard keeps one order for every slide, so in any Whiteboard view. Never while a search narrows the list.
 */
export function canReorder(view, query) {
  if (String(query ?? '').trim()) return false;
  const { store, folder } = parseDeckView(view);
  return (store === 'ann' && typeof folder === 'number') || store === 'wb';
}

/**
 * The index playback moves to from `index` by `delta` (+1 or -1) in a deck of `length`. Past the end it wraps when `loop` is on;
 * otherwise -1 says playback has run out. From no slide (-1), forward starts at the first.
 */
export function stepIndex(index, length, delta, loop) {
  if (length <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : length - 1;
  const next = index + delta;
  if (next >= 0 && next < length) return next;
  if (!loop) return -1;
  return (next + length) % length;
}

/** The keys sorted into the two libraries' ids. Unknown keys are dropped. */
export function splitKeys(keys) {
  const ann = [];
  const wb = [];
  for (const key of keys) {
    const parsed = parseItemKey(key);
    if (parsed) (parsed.source === 'ann' ? ann : wb).push(parsed.id);
  }
  return { ann, wb };
}

/** A Shift-click range over item keys, with the same rules as the Whiteboard's own (see slide-selection.js). */
export function clickKeySelection(current, order, anchor, target, shift) {
  return clickSelection(current, order, anchor, target, shift);
}

/** A copy of `list` with the item `fromKey` moved to where `toKey` is. */
export function moveKey(list, fromKey, toKey) {
  const from = list.indexOf(fromKey);
  const to = list.indexOf(toKey);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
