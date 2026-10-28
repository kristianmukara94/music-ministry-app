// Moving and swapping what a lineup slot holds. An item is a song (or songs), a prayer, or a scripture item, with its arrangement and
// its minutes. Dragging an item onto a slot of the same type swaps the two, or moves the item into an empty slot. A refused move
// changes nothing. The worship limit (a slot's maxSongs) and the segment 4 rule (a song-or-title slot does not take a reading) are
// checked for both sides.

import { DEFAULT_TEMPLATE, acceptsTab, songAssignment, typesFor } from './pw.js';

const templateOf = (key) => DEFAULT_TEMPLATE.segments.find((t) => t.key === key);

/** How many songs a slot takes: a song slot's own limit, or the template's for a slot that holds something else. */
export function capacityOf(segment) {
  return segment.content.kind === 'song' ? segment.content.maxSongs : templateOf(segment.key)?.content?.maxSongs ?? 1;
}

/** The item a slot holds: what it holds, its arrangement and its minutes. Null for an empty slot. */
export function itemOf(segment) {
  const c = segment.content;
  if (c.kind === 'song') {
    if (c.hymnIds.length === 0) return null;
    return { content: { kind: 'song', hymnIds: [...c.hymnIds] }, arrangement: segment.arrangement, minutes: segment.minutes };
  }
  if (c.kind === 'prayer') {
    if (c.noteId == null) return null;
    return { content: { kind: 'prayer', noteId: c.noteId }, arrangement: {}, minutes: segment.minutes };
  }
  return { content: { ...c }, arrangement: {}, minutes: segment.minutes };
}

/** Why an item cannot go into a slot of its type, or null when it can. */
function refusalFor(segment, item) {
  if (!acceptsTab(segment, segment.type)) return 'type';
  // A slot that takes songs is a song-or-title slot: a reading does not go in it.
  if (typesFor(segment).includes('song') && item.content.kind === 'lectionary') return 'segment4';
  if (item.content.kind === 'song' && item.content.hymnIds.length > capacityOf(segment)) return 'limit';
  return null;
}

/** The slot after it takes an item: its own limit, type and label stay; the item's content, arrangement and minutes come in. */
function placed(segment, item) {
  const c = item.content;
  let content;
  if (c.kind === 'song') {
    content = { kind: 'song', hymnIds: [...c.hymnIds], maxSongs: capacityOf(segment), category: segment.content.kind === 'song' ? segment.content.category : null };
  } else {
    content = { ...c };
  }
  return { ...segment, type: segment.type, content, arrangement: item.arrangement, minutes: item.minutes };
}

/** The slot after its item leaves: empty, with its template minutes, and the same type. */
function emptied(segment) {
  const template = templateOf(segment.key);
  const content =
    segment.content.kind === 'song'
      ? { kind: 'song', hymnIds: [], maxSongs: capacityOf(segment), category: segment.content.category }
      : { kind: 'prayer', noteId: null };
  return { ...segment, content, arrangement: {}, minutes: template?.minutes ?? segment.minutes };
}

/**
 * Swaps the items in two slots of the same type, or moves an item into an empty slot of its type (the source is left empty).
 * Returns `{ segments }`, or `{ refused }` with 'type', 'empty', 'limit' or 'segment4'. A refused move changes nothing.
 */
export function exchangeSlots(segments, from, to) {
  if (from === to) return { segments };
  const a = segments[from];
  const b = segments[to];
  if (!a || !b) return { refused: 'type' };
  const itemA = itemOf(a);
  if (!itemA) return { refused: 'empty' };
  if (a.type !== b.type) return { refused: 'type' };
  const itemB = itemOf(b);
  const intoB = refusalFor(b, itemA);
  if (intoB) return { refused: intoB };
  if (itemB) {
    const intoA = refusalFor(a, itemB);
    if (intoA) return { refused: intoA };
  }
  const nextA = itemB ? placed(a, itemB) : emptied(a);
  const nextB = placed(b, itemA);
  return { segments: segments.map((s, i) => (i === from ? nextA : i === to ? nextB : s)) };
}

/**
 * Fills the empty song slots, in lineup order, with the songs in the order they were ticked: one song to each empty slot. Songs left
 * over when the slots are full are returned, so nothing is lost. Returns `{ segments, left }`.
 */
export function fillEmptySongSlots(segments, hymnIds) {
  const queue = [...hymnIds];
  const next = segments.map((seg) => {
    if (queue.length === 0 || seg.type !== 'song' || seg.content.kind !== 'song' || seg.content.hymnIds.length > 0) return seg;
    const patch = songAssignment(seg, queue.shift(), null);
    return patch ? { ...seg, ...patch } : seg;
  });
  return { segments: next, left: queue };
}

/**
 * Fills the empty prayer slots, in lineup order, with the prayers in the order they were ticked: one prayer to each empty slot. Prayers
 * left over when the slots are full are returned. Returns `{ segments, left }`.
 */
export function fillEmptyPrayerSlots(segments, noteIds) {
  const queue = [...noteIds];
  const next = segments.map((seg) => {
    if (queue.length === 0 || seg.type !== 'prayer' || seg.content.kind !== 'prayer' || seg.content.noteId != null) return seg;
    return { ...seg, content: { kind: 'prayer', noteId: queue.shift() } };
  });
  return { segments: next, left: queue };
}
