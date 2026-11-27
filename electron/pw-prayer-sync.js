// What a Praise & Worship card holds after the website's items for it are applied. Pure: the store hands in what needs the database.
//
// The website knows a card's prayers by title and its songs by id. The laptop's card also holds things the website never sees: the
// operator's own prayers, readings chained on it, PowerPoint decks. So the card is merged, not replaced. `memory` is what the website last
// held for the card ({ prayers: [[title, noteId]], songs: [uuid] }), which tells apart "changed on the website" from "changed here":
// - the website's prayers are as remembered: the card's prayers are the laptop's, so a prayer swapped or taken off here stays that way;
// - the website changed them: its new prayers come in, the ones it took out leave, and what it never held stays.
import { MAX_CHAIN, MAX_SONGS } from '../shared/pw.js';
import { prayerTitleKey } from '../shared/pw-web-prayers.js';
import { PRAISE_READING_TYPES } from './plan-sync-map.js';

const SEGMENT_TYPE = { song: 'song', reading: 'scripture', rite: 'prayer' };

/** An item that is a prayer named by its title, whichever kind of step it sits on. A Content Hub entry is not one: it has its own link. */
export const isPrayerItem = (item) => item.contentType === 'prayer' && !item.contentHubId && typeof item.text === 'string' && item.text.trim() !== '';

const unique = (list) => [...new Set(list)];

/**
 * The type and content of a card, and what to remember of the website's side of it. `row` is the laptop's card ({ id, type, content }) or a
 * new one ({ id: null }); `items` are the website's items for it, in order. `deps`:
 *   titleOf(noteId)      the title the website knows this prayer note by, or null for the laptop's own
 *   noteFor(title)       the note to show a website prayer from, or null
 *   hubNoteFor(entryId)  the projectable note of a Content Hub entry, or null
 *   noteExists(noteId)   whether a note can still be projected
 *   songIdOf(uuid)       the laptop's song, or null
 *   songUuidOf(id)       the website's id of a laptop song, or null
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
