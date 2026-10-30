// Attaching Library items to a lineup card, from the Add button, "Add selected" and a drop. One set of rules, so they always agree.
// Any card takes any item: songs join the card's songs, and prayers and readings chain after the card's first item, or fill it when
// the card is an empty prayer card. Nothing is refused for its card's type. The only refusals are a repeat, a card at the limit, and an
// item that is not a song, prayer or reading. A refused attach changes nothing.

import { chainAssignment, chainOf, holdsItem, MAX_SONGS, songsOf } from './pw.js';

// A dragged Library item is { type, id, title }: its tab, its id (a hymn id, a note id, or for scripture 'title' or a reading type)
// and its title. It travels as JSON in a drag, so everything is read as untrusted.

const noun = { song: 'song', prayer: 'prayer', scripture: 'reading' };

const asId = (value) => (Number.isInteger(Number(value)) && value !== '' && value !== null ? Number(value) : null);

/** The card's content with its songs and chain kept, and its first item replaced by `first`. */
const withFirst = (segment, first) => ({ content: { ...first, hymnIds: songsOf(segment), more: chainOf(segment) } });

function attachSong(segment, hymnId) {
  if (hymnId === null) return { refused: 'type' };
  const songs = songsOf(segment);
  if (songs.includes(hymnId)) return { refused: 'present' };
  if (songs.length >= MAX_SONGS) return { refused: 'full' };
  const hymnIds = [...songs, hymnId];
  const c = segment.content;
  // The card's own song limit rises to fit what it holds, so what is saved never exceeds it.
  const content = { ...c, hymnIds, ...(c.kind === 'song' ? { maxSongs: Math.max(c.maxSongs ?? 1, hymnIds.length) } : {}) };
  return { patch: { content }, mode: 'added' };
}

function attachPrayer(segment, noteId) {
  if (noteId === null) return { refused: 'type' };
  const c = segment.content;
  // An empty prayer card takes the prayer as its first item. Any other card chains it after its last item.
  if (c.kind === 'prayer' && c.noteId == null) return { patch: withFirst(segment, { kind: 'prayer', noteId }), mode: 'added' };
  const item = { kind: 'prayer', noteId, minutes: 0 };
  if (holdsItem(segment, item)) return { refused: 'present' };
  const patch = chainAssignment(segment, item);
  return patch ? { patch, mode: 'chained' } : { refused: 'full' };
}

function attachScripture(segment, id) {
  if (typeof id !== 'string' || !id || id.length > 40) return { refused: 'type' };
  const c = segment.content;
  if (id === 'title') {
    if (c.kind === 'title') return { refused: 'present' };
    // The title slide takes the first place. The card keeps its songs and its chain.
    return { patch: withFirst(segment, { kind: 'title' }), mode: 'added' };
  }
  // A reading fills a card that holds only a title slide, and otherwise chains after the card's last item.
  if (c.kind === 'title' && songsOf(segment).length === 0 && chainOf(segment).length === 0) {
    return { patch: withFirst(segment, { kind: 'lectionary', readingType: id }), mode: 'added' };
  }
  const item = { kind: 'lectionary', readingType: id, minutes: 0 };
  if (holdsItem(segment, item)) return { refused: 'present' };
  const patch = chainAssignment(segment, item);
  return patch ? { patch, mode: 'chained' } : { refused: 'full' };
}

/**
 * Attaches the item `drag` ({ type, id, title }) to `segment`. Returns `{ patch, mode }`, where `patch` is the segment fields to
 * apply and `mode` is 'added' (it took the card's first place, or joined its songs) or 'chained'. Or returns `{ refused }`:
 * 'type' (not a song, prayer or reading), 'present' (the card already has it) or 'full' (the card is at its limit).
 */
export function attachItem(segment, drag) {
  switch (drag?.type) {
    case 'song':
      return attachSong(segment, asId(drag.id));
    case 'prayer':
      return attachPrayer(segment, asId(drag.id));
    case 'scripture':
      return attachScripture(segment, drag.id);
    default:
      return { refused: 'type' };
  }
}

/**
 * Attaches several items to one card, in order. Returns the card as it ends up and how many were added, chained, already in the card,
 * or refused (`left`).
 */
export function attachMany(segment, drags) {
  let next = segment;
  const counts = { added: 0, chained: 0, present: 0, left: 0 };
  for (const drag of drags) {
    const result = attachItem(next, drag);
    if ('refused' in result) {
      if (result.refused === 'present') counts.present += 1;
      else counts.left += 1;
      continue;
    }
    next = { ...next, ...result.patch };
    counts[result.mode] += 1;
  }
  return { segment: next, ...counts };
}

const DRAG_TYPES = ['song', 'prayer', 'scripture'];

/** The most items one drag may carry. A drag payload is untrusted, so what it claims is bounded. */
const MAX_DRAG_ITEMS = 200;

/**
 * Reads a Library drag payload, as a string or as parsed JSON: `{ type, items: [{ id, title }] }`, or the single form
 * `{ type, id, title }`. Returns `{ type, items }`, or null when it is not a Library drag (junk, no items, an unknown type, or a nested
 * row's drag inside a card, which carries `sourceIndex`).
 */
export function parseDrag(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || 'sourceIndex' in data || !DRAG_TYPES.includes(data.type)) return null;
  const list = Array.isArray(data.items) ? data.items : data.id !== undefined ? [data] : [];
  const items = list
    .filter((item) => item && typeof item === 'object' && item.id !== undefined && item.id !== null)
    .slice(0, MAX_DRAG_ITEMS)
    .map((item) => ({ id: item.id, title: String(item.title ?? '') }));
  return items.length ? { type: data.type, items } : null;
}

/** Attaches every item of a drag to one card, in the order they were dragged. Returns what `attachMany` returns. */
export function attachItems(segment, batch) {
  return attachMany(segment, batch.items.map((item) => ({ type: batch.type, id: item.id, title: item.title })));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The one-line report of an attach, e.g. "Added 1 song to Marian Song" or "Chained 2 prayers to Opening". */
export function describeAttach(segmentName, type, counts) {
  const word = noun[type] ?? 'item';
  const parts = [];
  if (counts.added && counts.chained) parts.push(`Added ${plural(counts.added, word)} and chained ${plural(counts.chained, word)} to ${segmentName}`);
  else if (counts.added) parts.push(`Added ${plural(counts.added, word)} to ${segmentName}`);
  else if (counts.chained) parts.push(`Chained ${plural(counts.chained, word)} to ${segmentName}`);
  if (counts.present) parts.push(`${counts.present} already in ${segmentName}`);
  if (counts.left) parts.push(`${counts.left} not added: ${segmentName} is full or cannot take ${counts.left === 1 ? 'it' : 'them'}`);
  return `${parts.join('. ')}.`;
}
