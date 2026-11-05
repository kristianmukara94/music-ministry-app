// Putting slides into a service flow that may already be on air: a PowerPoint deck from the Whiteboard, or text slides typed in Go Live, into a
// Holy Mass slot or straight after the item on screen. Pure rules, so the Whiteboard, Go Live and the tests agree.
//
// The Mass Queue plays the plan's rows in order and remembers the row on air by its position (queueCursor). A row put in ahead of that
// position moves the row on air down, so the position must move with it, in the same change, or CURRENT (and Next) would jump to another
// row while the projector still shows the old one. Every insert here returns the cursor that keeps pointing at the same row.

import { indexOfSlot, isSlotId, MASS_BLOCKS, MASS_SLOTS, slotById } from './mass-slots.js';
import { SPLIT_LIMITS, splitSlide } from './projector-autofit.js';

const BLOCK_ORDER = MASS_BLOCKS;
const blockRank = (block) => BLOCK_ORDER.indexOf(block);

/** A slot's place in the Mass, or -1 for an id that is not a slot. */
const rankOf = (slotId) => (isSlotId(slotId) ? slotById(slotId).position : -1);

/**
 * The Whiteboard's PowerPoint pictures as decks: one per Whiteboard folder, in Whiteboard order. A deck is what one queue row plays, since a
 * picture on the projector steps through the pictures of its folder. `slides` are { slideId, folderId, title } (slides without a picture,
 * slideId null, are left out). `folderName(id)` names a folder; null is Unfiled.
 * Returns [{ key, folderId, title, slideIds }], where `title` is the folder's name, or the slide's own title for a deck of one.
 */
export function decksOf(slides, folderName = () => null) {
  const decks = new Map();
  for (const slide of slides) {
    if (slide.slideId == null) continue;
    const key = slide.folderId == null ? 'unfiled' : `folder:${slide.folderId}`;
    if (!decks.has(key)) decks.set(key, { key, folderId: slide.folderId ?? null, title: '', slideIds: [], first: slide.title });
    decks.get(key).slideIds.push(slide.slideId);
  }
  return [...decks.values()].map(({ first, ...deck }) => ({
    ...deck,
    title: deck.slideIds.length === 1 ? first || 'PowerPoint slide' : folderName(deck.folderId) || 'Unfiled slides',
  }));
}

/**
 * A slide card's "Add to Holy Mass Queue": its folder's deck from that picture to the end, so the row starts on the slide that was picked and
 * Next walks on through the rest of the deck, then on to the next Holy Mass item. `slide` is { slideId, folderId, title }; `slides` are all the
 * Whiteboard's slides (as for decksOf). Picked on its deck's first picture, it is the whole deck, the same row as the folder's.
 */
export function deckSlice(slide, slides, folderName = () => null) {
  const deck = decksOf(slides.filter((s) => (s.folderId ?? null) === (slide.folderId ?? null)), folderName)[0];
  const at = deck ? deck.slideIds.indexOf(slide.slideId) : -1;
  if (at < 0) return { key: `slice:${slide.slideId}`, folderId: slide.folderId ?? null, title: slide.title || 'PowerPoint slide', slideIds: [slide.slideId] };
  if (at === 0) return deck;
  return { ...deck, key: `slice:${slide.slideId}`, slideIds: deck.slideIds.slice(at), from: { at, of: deck.slideIds.length } };
}

/** The source ids of rows that play part of a deck. They differ from the folder deck's, so a slice and its whole deck can both go in. */
const ALONE = ':only';
const FROM = ':from';

/**
 * What an Announcements row plays: { slideId, alone, from }. `alone` marks a single picture with no deck around it (rows from older builds);
 * `from` marks a deck slice, which plays its folder from this picture to the end (see deckSlice). Null for a source id that names no slide.
 */
export function announcementSource(sourceId) {
  const match = /^(\d+)(:only|:from)?$/.exec(String(sourceId ?? ''));
  return match ? { slideId: Number(match[1]), alone: match[2] === ALONE, from: match[2] === FROM } : null;
}

/** The Mass plan row that plays a deck: its first picture, which carries the rest of its folder, or the rest of it from a slice's first picture. */
export function deckRow(deck) {
  const n = deck.slideIds.length;
  if (deck.from) {
    return { module: 'announcements', sourceId: `${deck.slideIds[0]}${FROM}`, label: `${deck.title} (Slide ${deck.from.at + 1} of ${deck.from.of} • ${n} ${n === 1 ? 'slide' : 'slides'})` };
  }
  return { module: 'announcements', sourceId: String(deck.slideIds[0]), label: n > 1 ? `${deck.title} (${n} slides)` : deck.title };
}

/**
 * What is sent to a service flow, as the rows it becomes: a deck ({ slideIds }) is always one row however many pictures it has (see
 * deckRow), so a 218-slide PowerPoint never becomes 218 queue rows. Rows ({ module, sourceId, label }) pass through as they are.
 */
export function flowRowsOf(payload) {
  return (Array.isArray(payload) ? payload : []).map((entry) =>
    Array.isArray(entry?.slideIds) ? deckRow(entry) : { module: entry.module, sourceId: String(entry.sourceId), label: entry.label },
  );
}

/**
 * The rows that are not in the plan yet, by what they play (module and source), each once. A deck already in the Mass is not put in a second
 * time, so a double click or a repeated request never fills the queue with copies. Returns { rows, duplicates }.
 */
export function newFlowRows(items, rows) {
  const key = (it) => `${it.module}:${String(it.sourceId)}`;
  const seen = new Set(items.map(key));
  const fresh = [];
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(key(row))) duplicates.push(row);
    else {
      seen.add(key(row));
      fresh.push(row);
    }
  }
  return { rows: fresh, duplicates };
}

/** The card thumbnail of a deck's queue row: its first picture, which is the row's sourceId. Null for a row that is not a picture. */
export function deckThumb(row) {
  const source = row?.module === 'announcements' ? announcementSource(row.sourceId) : null;
  return source ? `apcc-media://slide/${source.slideId}` : null;
}

/**
 * Text typed for new slides, as the pages they become: a blank line starts a new slide, and a page longer than the projector shows at a
 * readable size is split under the same limits as a Holy Mass Order part (see shared/projector-autofit.js), so every screen has the same pages.
 */
export function textSlidePages(text, limits = SPLIT_LIMITS) {
  const blocks = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
  return blocks.flatMap((lines) => splitSlide(lines.map((line) => ({ text: line })), limits).map((part) => part.map((l) => l.text).join('\n')));
}

/**
 * Where rows go for `target`, in a plan whose rows are grouped by block in Mass order (as the database returns them). Returns { at, block },
 * or null when the target is not in the plan.
 *
 * - { kind: 'slot', slot }: after the slot's item, and after the rows already put in after it, so a second deck plays after the first. An
 *   empty slot takes them where its item would be: ahead of the next filled slot of its block, after everything before it. This is where the
 *   Go Live lineup shows the empty slot (see massLineup), so the rows land on the slot that was picked.
 * - { kind: 'after', index }: straight after the row at `index` (the row on air), in its block.
 */
export function massInsertAt(items, target) {
  if (target?.kind === 'after') {
    const row = items[target.index];
    return row && Number.isInteger(target.index) ? { at: target.index + 1, block: row.block } : null;
  }
  if (target?.kind !== 'slot') return null;
  const slot = slotById(target.slot);
  if (!slot) return null;
  const members = items.flatMap((it, i) => (it.block === slot.block ? [i] : []));
  if (members.length === 0) {
    // A block with nothing in it goes before the first later block, or at the end.
    const later = items.findIndex((it) => blockRank(it.block) > blockRank(slot.block));
    return { at: later < 0 ? items.length : later, block: slot.block };
  }
  const anchor = indexOfSlot(items, slot.id);
  if (anchor < 0) {
    const later = members.find((i) => rankOf(items[i].slot) > slot.position);
    return { at: later ?? members[members.length - 1] + 1, block: slot.block };
  }
  let at = anchor + 1;
  // Rows already put in after the slot (no slot of their own) stay ahead of these.
  while (at < items.length && items[at].block === slot.block && !isSlotId(items[at].slot)) at += 1;
  return { at, block: slot.block };
}

/**
 * The queue position of the row that was at `cursor`, after `count` rows were put in at `at`. Rows put in at or before it move it down;
 * rows put in after it leave it where it is. -1 (nothing on air) stays -1.
 */
export function cursorAfterInsert(cursor, at, count) {
  return Number.isInteger(cursor) && cursor >= 0 && cursor >= at ? cursor + count : cursor;
}

/**
 * The plan with `rows` ({ module, sourceId, label }) put in for `target` (see massInsertAt), and the cursor that keeps the row on air.
 * The rows take the target's block. Put into a filled slot they are additional items, so the slot keeps its own song or text. Put into an
 * empty slot, the first of them fills it, so it stays tied to that slot and the rest follow it. No row is ever taken out.
 * Returns { items, cursor, at }, or null when the target is not in the plan or there is nothing to add.
 */
export function insertIntoMassFlow(items, rows, target, cursor = -1) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const place = massInsertAt(items, target);
  if (!place) return null;
  const fills = target.kind === 'slot' && indexOfSlot(items, target.slot) < 0 ? target.slot : null;
  const placed = rows.map(({ module, sourceId, label }, i) => ({ block: place.block, module, sourceId: String(sourceId), label, slot: i === 0 ? fills : null }));
  return {
    items: [...items.slice(0, place.at), ...placed, ...items.slice(place.at)],
    cursor: cursorAfterInsert(cursor, place.at, placed.length),
    at: place.at,
  };
}

/**
 * The plan with the item that fills `slot` swapped for `rows`: the first row takes the slot, the rest follow it, and the old item goes. The
 * rows put in after the slot stay where they are. An empty slot is filled as insertIntoMassFlow fills it, so Replace on an empty slot is an
 * insert. `cursor` follows its row; when the row replaced was the one at `cursor`, it stays on the slot, which now plays the new first row.
 * Returns { items, cursor, at, replaced, replacedCurrent }, where `replaced` is the item taken out (null for an empty slot), or null when the
 * slot is not a slot or there is nothing to put in.
 */
export function replaceSlotInMassFlow(items, rows, slot, cursor = -1) {
  if (!Array.isArray(rows) || rows.length === 0 || !isSlotId(slot)) return null;
  const anchor = indexOfSlot(items, slot);
  if (anchor < 0) {
    const placed = insertIntoMassFlow(items, rows, { kind: 'slot', slot }, cursor);
    return placed && { ...placed, replaced: null, replacedCurrent: false };
  }
  const old = items[anchor];
  const placed = rows.map(({ module, sourceId, label }, i) => ({ block: old.block, module, sourceId: String(sourceId), label, slot: i === 0 ? slot : null }));
  const moved = Number.isInteger(cursor) && cursor > anchor ? cursor + placed.length - 1 : cursor;
  return {
    items: [...items.slice(0, anchor), ...placed, ...items.slice(anchor + 1)],
    cursor: moved,
    at: anchor,
    replaced: old,
    replacedCurrent: cursor === anchor,
  };
}

/**
 * The plan with the row at `index` taken out. A row that filled a slot leaves the slot empty, and Go Live shows it as an empty slot again (see
 * massLineup); any other row is simply gone. `cursor` follows its row. When the row taken out was the one at `cursor`, it moves to the nearest
 * row that can play: the one that came next, or, at the end of the Mass, the one before; -1 when no row is left to play.
 * Returns { items, cursor, removed, removedCurrent }, or null when there is no row at `index`.
 */
export function removeFromMassFlow(items, index, cursor = -1) {
  const removed = Number.isInteger(index) ? items[index] : undefined;
  if (!removed) return null;
  const next = [...items.slice(0, index), ...items.slice(index + 1)];
  const removedCurrent = cursor === index;
  let moved = cursor;
  if (Number.isInteger(cursor) && cursor > index) moved = cursor - 1;
  else if (removedCurrent) {
    const playable = (i) => !next[i].stale;
    let i = index;
    while (i < next.length && !playable(i)) i += 1;
    if (i >= next.length) {
      i = index - 1;
      while (i >= 0 && !playable(i)) i -= 1;
    }
    moved = i;
  }
  return { items: next, cursor: moved, removed, removedCurrent };
}

/**
 * The position in `next` of the row that was at `cursor` in `before`, for a change made somewhere else (the planner, an append). The row is
 * found by what it plays and which repeat of it it was, so rows added or removed around it do not move CURRENT. -1 when it is gone.
 */
export function followCursor(before, next, cursor) {
  const row = Number.isInteger(cursor) && cursor >= 0 ? before[cursor] : null;
  if (!row) return -1;
  const same = (it) => it.module === row.module && String(it.sourceId) === String(row.sourceId);
  const repeat = before.slice(0, cursor).filter(same).length;
  let seen = 0;
  for (let i = 0; i < next.length; i++) {
    if (!same(next[i])) continue;
    if (seen === repeat) return i;
    seen += 1;
  }
  return -1;
}

/**
 * The Holy Mass order as Go Live shows it: the queue's rows, with each slot that no row fills shown in its place, so the order of
 * Mass is always whole however many slides go in around it. An empty slot sits ahead of the next filled slot of its section, after the rows
 * put in after the slots before it. `rows` are the queue's (or the plan's) rows, { block, slot }, grouped by block in Mass order.
 * Returns [{ index }] for a row and [{ slot }] for an empty slot, in order. A plan with rows but no slots (from before slots, or a "Quick
 * passages" plan) is shown as it is.
 */
export function massLineup(rows) {
  const filled = new Set(rows.map((row) => row.slot).filter(isSlotId));
  if (rows.length > 0 && filled.size === 0) return rows.map((_, index) => ({ index }));
  const empty = MASS_SLOTS.filter((slot) => !filled.has(slot.id));
  const out = [];
  let e = 0;
  rows.forEach((row, index) => {
    const rank = rankOf(row.slot);
    // Empty slots of earlier sections come first, then those of this section that come before this row's slot.
    while (
      e < empty.length &&
      (blockRank(empty[e].block) < blockRank(row.block) || (empty[e].block === row.block && rank > 0 && empty[e].position < rank))
    ) {
      out.push({ slot: empty[e++] });
    }
    out.push({ index });
  });
  while (e < empty.length) out.push({ slot: empty[e++] });
  return out;
}

/**
 * The plan put back to its Holy Mass order: every item that fills a slot, and every additional item that is not a slide (a
 * reading, a passage, a note) stay; the slides and PowerPoints put in around the slots go. For a plan that a slip or an old build filled with
 * slide rows. Returns { items, removed }.
 */
export function massOrderReset(items) {
  const kept = items.filter((it) => isSlotId(it.slot) || it.module !== 'announcements');
  return { items: kept, removed: items.length - kept.length };
}
