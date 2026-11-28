// What a Praise & Worship card holds after the website's items for it are applied. Pure: the store hands in what needs the database.
//
// The website knows a card's prayers by title and its songs by id. The laptop's card also holds things the website never sees: the
// operator's own prayers, readings chained on it, PowerPoint decks. So the card is merged, not replaced. `memory` is what the website last
// held for the card ({ prayers: [[title, noteId]], songs: [uuid] }), which tells apart "changed on the website" from "changed here":
// - the website's prayers are as remembered: the card's prayers are the laptop's, so a prayer swapped or taken off here stays that way;
// - the website changed them: its new prayers come in, the ones it took out leave, and what it never held stays.
import { CHAIN_TEXT_TYPES, MAX_CHAIN, MAX_CHAIN_TEXT, MAX_SONGS } from '../shared/pw.js';
import { prayerTitleKey } from '../shared/pw-web-prayers.js';
import { PRAISE_READING_TYPES } from './plan-sync-map.js';

const SEGMENT_TYPE = { song: 'song', reading: 'scripture', rite: 'prayer' };

/** An item that is a prayer named by its title, whichever kind of step it sits on. A Content Hub entry is not one: it has its own link. */
export const isPrayerItem = (item) => item.contentType === 'prayer' && !item.contentHubId && typeof item.text === 'string' && item.text.trim() !== '';

const unique = (list) => [...new Set(list)];

const textKey = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * What an item further down a website step becomes on its card's chain: a Content Hub entry is its note, a reading the laptop knows by name
 * is that lectionary reading, and any other typed words (a Scripture reference, an announcement, a note) are a text item. Null for an item
 * that is not chained this way: a song (the card's songs), a prayer by title (merged with the card's prayers), or one with nothing in it.
 */
export function chainItemOf(item, hubNoteFor) {
  if (!item || item.kind === 'song' || isPrayerItem(item)) return null;
  if (item.contentHubId) {
    const noteId = hubNoteFor(item.contentHubId);
    return noteId === null || noteId === undefined ? null : { kind: 'prayer', noteId, minutes: 0 };
  }
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (!text) return null;
  if (item.kind === 'reading' && PRAISE_READING_TYPES.includes(text) && (!item.contentType || item.contentType === 'scripture')) {
    return { kind: 'lectionary', readingType: text, minutes: 0 };
  }
  // Typed words with no type are a reference on a reading, as the website saved them before it had types, and a note anywhere else.
  const contentType = CHAIN_TEXT_TYPES.includes(item.contentType) ? item.contentType : item.kind === 'reading' ? 'scripture' : 'text_note';
  return { kind: 'text', text: text.slice(0, MAX_CHAIN_TEXT), contentType, minutes: 0 };
}

const sameChained = (a, b) => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'prayer') return a.noteId === b.noteId;
  if (a.kind === 'lectionary') return a.readingType === b.readingType;
  if (a.kind === 'text') return a.contentType === b.contentType && textKey(a.text) === textKey(b.text);
  return false;
};

/**
 * The card's chain in the website's order. `more` is the chain the prayer merge left; `further` the website's items after the card's first
 * one. Each item the website holds takes its place in the website's order (keeping the laptop's minutes for it); what only the laptop holds
 * (a PowerPoint deck, its own prayer or reading) stays after the item it followed. Typed text and Content Hub entries are the website's: one
 * it no longer holds leaves the card, so a removal there is not undone here.
 */
function orderedChain(more, further, { keyOfNote, placed, headNote, hubNoteFor, isHubNote }) {
  const used = new Set();
  const listed = [];
  const claim = (pred) => {
    const at = more.findIndex((m, k) => !used.has(k) && pred(m));
    if (at >= 0) used.add(at);
    return at;
  };
  for (const item of further) {
    if (isPrayerItem(item)) {
      const key = prayerTitleKey(item.text);
      const at = claim((m) => m.kind === 'prayer' && m.noteId !== headNote && (keyOfNote(m.noteId) === key || placed.get(key) === m.noteId));
      if (at >= 0) listed.push({ item: more[at], from: at });
      continue;
    }
    const wanted = chainItemOf(item, hubNoteFor);
    if (!wanted || (wanted.kind === 'prayer' && wanted.noteId === headNote)) continue;
    if (listed.some((l) => sameChained(l.item, wanted))) continue;
    const at = claim((m) => sameChained(m, wanted));
    listed.push(at >= 0 ? { item: more[at], from: at } : { item: wanted, from: null });
  }
  // What the laptop holds that the website does not list. The website's own kinds it dropped go; the rest stays beside what it followed.
  const ownOnly = (m) => m.kind !== 'text' && !(m.kind === 'prayer' && isHubNote(m.noteId));
  const anchored = new Map();
  let anchor = -1;
  more.forEach((m, k) => {
    if (used.has(k)) {
      anchor = listed.findIndex((l) => l.from === k);
      return;
    }
    if (ownOnly(m)) anchored.set(anchor, [...(anchored.get(anchor) ?? []), m]);
  });
  const out = [...(anchored.get(-1) ?? [])];
  listed.forEach((l, i) => out.push(l.item, ...(anchored.get(i) ?? [])));
  return out.slice(0, MAX_CHAIN);
}

/**
 * The type and content of a card, and what to remember of the website's side of it. `row` is the laptop's card ({ id, type, content }) or a
 * new one ({ id: null }); `items` are the website's items for it, in order. `deps`:
 *   titleOf(noteId)      the title the website knows this prayer note by, or null for the laptop's own
 *   noteFor(title)       the note to show a website prayer from, or null
 *   hubNoteFor(entryId)  the projectable note of a Content Hub entry, or null
 *   noteExists(noteId)   whether a note can still be projected
 *   songIdOf(uuid)       the laptop's song, or null
 *   songUuidOf(id)       the website's id of a laptop song, or null
 *   hubEntryOf(noteId)   the website's Content Hub entry a note was brought in for, or null for the laptop's own
 *   template             the lineup's own content for this card's key, if it has one
 */
export function praiseCard({ row, items, memory, deps }) {
  const head = items[0];
  const owned = Boolean(row.id);
  const local = owned ? row.content ?? {} : {};
  const localMore = local.more ?? [];

  const titles = new Map();
  for (const item of items.filter(isPrayerItem)) {
    const title = item.text.trim();
    if (!titles.has(prayerTitleKey(title))) titles.set(prayerTitleKey(title), title);
  }
  const wanted = [...titles.keys()];
  const known = (memory?.prayers ?? []).map(([title]) => prayerTitleKey(title));
  const songUuids = unique(items.filter((i) => i.kind === 'song' && i.songId).map((i) => i.songId));
  const serverSongs = unique(songUuids.map(deps.songIdOf).filter((id) => id !== null && id !== undefined));

  const localHead = local.kind === 'prayer' && local.noteId != null ? local.noteId : null;
  const held = [localHead, ...localMore.filter((m) => m.kind === 'prayer').map((m) => m.noteId)].filter((id) => id !== null);
  const keyOfNote = (noteId) => {
    const title = deps.titleOf(noteId);
    return title === null ? null : prayerTitleKey(title);
  };

  const unchanged = owned && Boolean(memory) && wanted.length > 0 && wanted.length === known.length && wanted.every((t, i) => t === known[i]);
  const headPrayer = isPrayerItem(head) ? prayerTitleKey(head.text) : null;
  let type = headPrayer !== null || head.contentType === 'prayer' ? 'prayer' : SEGMENT_TYPE[head.kind];
  let noteId = localHead;
  let more = localMore;
  const placed = new Map();

  if (unchanged) {
    type = row.type;
    // A prayer note deleted from the Hub since is made again from the website's title.
    if (noteId !== null && !deps.noteExists(noteId)) {
      const title = memory.prayers.find(([, id]) => id === noteId)?.[0];
      noteId = title ? deps.noteFor(title) : noteId;
    }
  } else {
    // A prayer the website still holds that this card no longer does was taken off here: it stays off.
    for (const key of wanted) {
      const mine = held.find((id) => keyOfNote(id) === key) ?? null;
      if (mine === null && known.includes(key)) continue;
      const id = mine ?? deps.noteFor(titles.get(key));
      if (id !== null) placed.set(key, id);
    }
    const removedOnWeb = (id) => {
      const key = keyOfNote(id);
      return key !== null && known.includes(key) && !wanted.includes(key);
    };
    const privateHead = localHead !== null && keyOfNote(localHead) === null;
    // The laptop's own prayer is not given up to a song or a reading the website put on a card it saw as empty.
    if (privateHead && type !== 'prayer') type = 'prayer';
    if (type === 'prayer') {
      const fromHub = head.contentHubId ? deps.hubNoteFor(head.contentHubId) : null;
      noteId = placed.get(headPrayer) ?? fromHub
        ?? (privateHead ? localHead : null)
        ?? [...placed.values()][0]
        ?? (localHead !== null && !removedOnWeb(localHead) ? localHead : null);
    } else {
      noteId = null;
    }
    more = localMore.filter((m) => m.kind !== 'prayer' || (m.noteId !== noteId && !removedOnWeb(m.noteId)));
    // A first prayer that moved off the head, and is still on the card on the website or only here, is chained.
    if (localHead !== null && localHead !== noteId && keyOfNote(localHead) !== null && !removedOnWeb(localHead)) placed.set(keyOfNote(localHead), localHead);
    for (const id of placed.values()) {
      if (id !== noteId && !more.some((m) => m.kind === 'prayer' && m.noteId === id)) more = [...more, { kind: 'prayer', noteId: id, minutes: 0 }];
    }
    more = more.slice(0, MAX_CHAIN);
  }

  // The step's further items (a second reading, typed words, a Content Hub entry, more prayers) all go on this card, in the website's order.
  more = orderedChain(more, items.slice(1), {
    keyOfNote,
    placed,
    headNote: type === 'prayer' ? noteId : null,
    hubNoteFor: deps.hubNoteFor,
    isHubNote: (id) => (deps.hubEntryOf?.(id) ?? null) !== null,
  });

  // A song card's songs are the website's. Any other card keeps its own songs, less those the website took out, plus those it added.
  let hymnIds = serverSongs;
  const localSongs = local.hymnIds ?? [];
  const mergeSongs = owned && type !== 'song' && !(local.kind === 'song' && !memory);
  if (mergeSongs) {
    const before = memory?.songs ?? [];
    const kept = localSongs.filter((id) => {
      const uuid = deps.songUuidOf(id);
      return !(before.includes(uuid) && !songUuids.includes(uuid));
    });
    const added = serverSongs.filter((id) => !kept.includes(id) && !before.includes(deps.songUuidOf(id)));
    hymnIds = [...kept, ...added];
  }
  hymnIds = hymnIds.slice(0, MAX_SONGS);

  let content;
  if (type === 'song') {
    // A segment new to the laptop starts as the lineup's own slot of that key does (Worship takes three songs), so it is the same card as one made here.
    const base = local.kind === 'song' ? local : deps.template?.kind === 'song' ? deps.template : {};
    content = { kind: 'song', hymnIds, maxSongs: Math.max(base.maxSongs ?? 1, hymnIds.length, 1), category: base.category ?? null };
  } else {
    if (type === 'prayer') content = { kind: 'prayer', noteId };
    // Only a known reading name can be a lectionary slot. Anything else, such as a reference, would be refused when the plan is sent.
    else if (head.kind === 'reading' && !isPrayerItem(head)) {
      const reading = PRAISE_READING_TYPES.includes(head.text);
      content = reading ? { kind: 'lectionary', readingType: head.text } : { kind: 'title' };
    } else content = local.kind === 'lectionary' ? { kind: 'lectionary', readingType: local.readingType } : { kind: 'title' };
    if (hymnIds.length) content.hymnIds = hymnIds;
  }
  if (more.length) content.more = more;

  const noteHeld = (key) => placed.get(key) ?? held.find((id) => keyOfNote(id) === key) ?? null;
  return {
    type,
    content,
    memory: { prayers: wanted.map((key) => [titles.get(key), noteHeld(key)]), songs: songUuids },
  };
}
