// Maps a laptop plan to the server's plan body, and merges a pulled body back into the laptop's items. Pure: no database and no
// network, so the tests run under plain Node.
//
// Only these fields leave the laptop: a song's uuid, a reading's name, a Mass part's name, a block or group, a minute count, and a
// note the planner typed into the plan. Item text is never read from a lectionary row, a scripture passage or a prayer's words.
// Announcements, media, Bible items and the laptop's own custom and note items stay on the laptop. A custom item that came from the
// web is the exception: it is a web note, so it goes back to the web as the note it was.
//
// Keys. A web item keeps the web's key (its step number, for a Mass part; its segment key, for praise). Other items get a key made
// from their content and occurrence, so it is the same each time. Nothing is stored for a key: the Mass item table is rebuilt on
// every save.
import crypto from 'node:crypto';
import { MASS_PARTS, PART_STEP } from '../shared/mass-parts.js';

export const MASS_BLOCKS = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];
export const READING_TYPES = ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel'];
// Praise & Worship also lists the acclamation, which a Mass plan never does.
export const PRAISE_READING_TYPES = [...READING_TYPES, 'Gospel Acclamation'];
// A custom item whose source id starts with this came from the web, and its label is the web note.
export const WEB_NOTE_PREFIX = 'web:';

const MAX_KEY = 20;
const MAX_ITEMS = 200;
const MAX_MINUTES = 60;
const MAX_TEXT = 200;
const MAX_NOTE = 1000;

/** A plan that cannot be sent as it is. The message is plain and names no content. */
export class MapRefused extends Error {}

/** A key the server accepts: at most 20 characters, the same each time for the same content. */
export function itemKey(parts) {
  const raw = parts.join('.');
  if (raw.length <= MAX_KEY) return raw;
  return `h${crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, MAX_KEY - 1)}`;
}

const byOrder = (a, b) => a.order - b.order;

/**
 * An entry is one laptop item: its key, whether it is sent (`synced`), the server item it becomes (when sent), and its laptop row.
 * Every entry has a row, so a merge can always find the laptop's side of an item.
 */
const entry = (key, row, item = null) => ({ key, synced: item !== null, item, row });

/**
 * The Mass plan's items in display order. `rows` are { block, module, sourceId, label, order }.
 * `hymnUuidOf(sourceId)` returns the hymn's uuid, or null if it has none (such a song is kept on the laptop).
 */
export function massEntries(rows, hymnUuidOf) {
  const occurrences = new Map();
  return [...rows].sort(byOrder).map((row) => {
    const base = [row.module, row.sourceId, row.block].join('|');
    const seen = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, seen);
    const derived = itemKey([row.module, row.sourceId, row.block, seen]);
    if (row.module === 'lyrics') {
      const uuid = hymnUuidOf(row.sourceId);
      return entry(derived, row, uuid ? { kind: 'song', group: row.block, songId: uuid } : null);
    }
    if (row.module === 'lectionary') {
      // The label is the reading's name. Anything else could carry text, so the plan is refused rather than sent.
      if (!READING_TYPES.includes(row.label)) throw new MapRefused('A reading in this plan is not a reading name. Nothing was sent.');
      return entry(derived, row, { kind: 'reading', group: row.block, text: row.label });
    }
    if (row.module === 'mass_order') {
      if (row.label.length > MAX_TEXT) throw new MapRefused('A Mass part name in this plan is too long. Nothing was sent.');
      return entry(PART_STEP[row.sourceId] ?? derived, row, { kind: 'rite', group: row.block, text: row.label });
    }
    if (row.module === 'custom' && row.sourceId.startsWith(WEB_NOTE_PREFIX)) {
      return entry(row.sourceId.slice(WEB_NOTE_PREFIX.length), row, { kind: 'rite', group: row.block, note: row.label.slice(0, MAX_NOTE) });
    }
    return entry(derived, row, null);
  });
}

/** Praise & Worship segments in display order. `segments` are { key, group, order, type, minutes, contentRef, notes, ... }. */
export function praiseEntries(segments, hymnUuidOf) {
  // A segment's notes are local-only: they are never part of an item, so they never leave the laptop.
  return [...segments].sort(byOrder).flatMap((seg) => segmentEntries(seg, hymnUuidOf));
}

function segmentEntries(seg, hymnUuidOf) {
  const content = parseContent(seg.contentRef);
  const minutes = minutesFor(seg.minutes);
  if (seg.type === 'song') {
    const ids = Array.isArray(content.hymnIds) ? content.hymnIds : [];
    if (ids.length === 0) return [entry(itemKey([seg.key]), seg, withMinutes({ kind: 'song', group: seg.group }, minutes))];
    return ids.map((id, i) => {
      const uuid = hymnUuidOf(id);
      // The segment's minutes go on its first song only, so they are not counted twice.
      return entry(itemKey([seg.key, i + 1]), seg, uuid ? withMinutes({ kind: 'song', group: seg.group, songId: uuid }, i === 0 ? minutes : null) : null);
    });
  }
  if (seg.type === 'prayer') {
    // A prayer's words stay on the laptop. The server gets the slot only.
    return [entry(itemKey([seg.key]), seg, withMinutes({ kind: 'rite', group: seg.group }, minutes))];
  }
  if (seg.type === 'scripture') {
    if (content.kind === 'lectionary') {
      if (!PRAISE_READING_TYPES.includes(content.readingType)) throw new MapRefused('A reading in this plan is not a reading name. Nothing was sent.');
      return [entry(itemKey([seg.key]), seg, withMinutes({ kind: 'reading', group: seg.group, text: content.readingType }, minutes))];
    }
    // A title slide carries no text to send.
    return [entry(itemKey([seg.key]), seg, withMinutes({ kind: 'reading', group: seg.group }, minutes))];
  }
  return [entry(itemKey([seg.key]), seg, null)];
}

/** The server's Mass plan body: the sent items only, in order, numbered 1 to n. */
export function massBody(entries) {
  return { kind: 'mass', items: serverItems(entries) };
}

/** The server's Praise & Worship plan body. */
export function praiseBody(entries) {
  return { kind: 'pw', items: serverItems(entries) };
}

/**
 * Merges a pulled plan's items into the laptop's entries. The server's items are the sent items, in the server's order. Each
 * item the laptop keeps is placed after the nearest item before it that still exists, so it stays beside what it was next to.
 *
 * `resolve(item)` returns the laptop row for a server item, or null when the laptop cannot place it. Those are returned in
 * `unresolved` and counted, never dropped without a word.
 */
export function mergeEntries(localEntries, serverItems, resolve) {
  const serverKeys = new Set(serverItems.map((i) => i.key));
  const kept = new Map();
  let anchor = null;
  for (const e of localEntries) {
    if (e.synced) {
      if (serverKeys.has(e.key)) anchor = e.key;
      continue;
    }
    kept.set(anchor, [...(kept.get(anchor) ?? []), e]);
  }
  const unresolved = [];
  const fromServer = [];
  for (const item of [...serverItems].sort(byOrder)) {
    const row = resolve(item);
    if (!row) unresolved.push(item.key);
    else fromServer.push(entry(item.key, row, item));
  }
  const placed = (kept.get(null) ?? []).concat(fromServer.flatMap((e) => [e, ...(kept.get(e.key) ?? [])]));
  return { entries: placed, unresolved };
}

// ---- helpers --------------------------------------------------------------------------------------------------------------

function serverItems(entries) {
  const sent = entries.filter((e) => e.synced);
  if (sent.length > MAX_ITEMS) throw new MapRefused(`A plan can have up to ${MAX_ITEMS} items on the web. Nothing was sent.`);
  return sent.map((e, i) => ({ key: e.key, order: i + 1, ...e.item }));
}

function parseContent(raw) {
  try {
    const parsed = JSON.parse(raw ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function minutesFor(minutes) {
  if (!minutes) return null;
  if (minutes > MAX_MINUTES) throw new MapRefused('A segment is longer than an hour on the web. Nothing was sent.');
  return minutes;
}

function withMinutes(item, minutes) {
  return minutes ? { ...item, minutes } : item;
}

export { MASS_PARTS };
