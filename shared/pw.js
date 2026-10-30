import { normalizeSplit } from './prayer-split.js';
import { PRAYER_MAX_PX, pageTops, prayerSlidesFor } from './prayer-slides.js';
import { LINEUP_PRAYER_FIT, prayerPages } from './prayer-fit.js';
import { lyricPagesFor } from './lyric-area.js';

// Praise & Worship: the lineup model, shared by the main process (validation, seeding) and the renderer
// (planner, live console). Plain JS with no React, so both sides run the same rules. Types live in pw.d.ts.
//
// A session is an ordered list of segments. Each segment has a content slot (`content`) whose kind matches
// its type: songs point at hymns, prayers at a projectable note, scripture at a title slide or the lectionary.
// Names stay in English in every language, as the Mass planner's skeleton does.

export const PW_TYPES = ['prayer', 'song', 'scripture'];

/** Shown on a prayer slide until a prayer from Notes & Prayers is assigned. The app ships no prayer text. */
export const PRAYER_PLACEHOLDER = '[Approved prayer wording]';

/** The lectionary slot segment 9 reads from. */
export const GOSPEL_ACCLAMATION = 'Gospel Acclamation';

export const DEFAULT_CUES = { lowerThird: true, titleFirst: true, fadeOut: false };

/** The most songs one card holds. The server clamps a card's `maxSongs` to this, and a card's own limit rises to fit what is added. */
export const MAX_SONGS = 40;

/** Items a prayer or scripture card can chain after its first item. Songs chain through `hymnIds` instead. */
export const MAX_CHAIN = 40;

/** Cards in one lineup. Matches the server's limit, so a full lineup is refused on save, not on screen. */
export const MAX_SEGMENTS = 40;

/**
 * The default lineup. Groups and their split are a proposal from the ministry and may change, so they live
 * here as data. Components read them from the session, never from this constant.
 */
export const DEFAULT_TEMPLATE = {
  name: 'Praise & Worship Night',
  groups: [
    { key: 'opening', name: 'Opening' },
    { key: 'praise', name: 'Praise & Worship' },
    { key: 'word', name: 'Word & Offering' },
  ],
  segments: [
    { key: 'prayer_authority', group: 'opening', name: 'Prayer to Take Authority', type: 'prayer', minutes: 3, content: { kind: 'prayer', noteId: null } },
    { key: 'consecration_mary', group: 'opening', name: 'Consecration to Mary, Our Lady of Nazareth', type: 'prayer', minutes: 3, content: { kind: 'prayer', noteId: null } },
    { key: 'marian_song', group: 'opening', name: 'Marian Song', type: 'song', minutes: 5, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    // The title slide is the default. The slot can also hold a song, so `types` lists both.
    { key: 'bible_enthronement', group: 'opening', name: 'Bible Enthronement', type: 'scripture', types: ['scripture', 'song'], minutes: 4, content: { kind: 'title' } },
    { key: 'joyful_song', group: 'praise', name: 'Joyful Song', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    { key: 'worship', group: 'praise', name: 'Worship', type: 'song', minutes: 15, content: { kind: 'song', hymnIds: [], maxSongs: 3, category: null } },
    { key: 'repentance', group: 'praise', name: 'Repentance', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    { key: 'holy_spirit', group: 'praise', name: 'Holy Spirit', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    // The slot fills from the lectionary by default. A song from the library replaces that reading for the session.
    { key: 'gospel_acclamation', group: 'word', name: 'Gospel Acclamation', type: 'scripture', types: ['scripture', 'song'], minutes: 3, content: { kind: 'lectionary', readingType: GOSPEL_ACCLAMATION } },
    { key: 'offertory', group: 'word', name: 'Offertory', type: 'song', minutes: 6, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: 'Offertory' } },
    { key: 'thanksgiving', group: 'word', name: 'Thanksgiving', type: 'song', minutes: 6, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    { key: 'finale', group: 'word', name: 'Finale', type: 'song', minutes: 5, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
  ],
};

/** A template segment as a fresh session segment: no leader, default cues, no notes or arrangement. */
export function segmentFromTemplate(t) {
  return {
    key: t.key,
    group: t.group,
    name: t.name,
    type: t.type,
    minutes: t.minutes,
    leader: t.leader ?? '',
    content: structuredClone(t.content),
    arrangement: structuredClone(t.arrangement ?? {}),
    cues: { ...DEFAULT_CUES, ...(t.cues ?? {}) },
    notes: '',
  };
}

/**
 * Whether a segment has something to present.
 *   ready         content assigned (or a title slide, which needs none)
 *   auto          filled from the lectionary for the session date
 *   needs_song    a song segment with no song
 *   needs_prayer  a prayer segment with no prayer
 *   missing       content was assigned but has since been deleted from its library
 */
export function segmentStatus(segment) {
  if (segment.stale) return 'missing';
  const c = segment.content;
  // Any songs or chained items count as content, whatever the card's first item is.
  const hasItems = songsOf(segment).length > 0 || chainOf(segment).length > 0;
  switch (c.kind) {
    case 'song':
      return hasItems ? 'ready' : 'needs_song';
    case 'prayer':
      return c.noteId != null || hasItems ? 'ready' : 'needs_prayer';
    case 'lectionary':
      return 'auto';
    default:
      return 'ready';
  }
}

/** Segments that can go on screen as planned, out of the total. Auto counts: it falls back to a title slide. */
export function readiness(segments) {
  const ready = segments.filter((s) => ['ready', 'auto'].includes(segmentStatus(s))).length;
  return { ready, total: segments.length, missingSongs: segments.filter((s) => segmentStatus(s) === 'needs_song').length };
}

/** The items chained after a card's first item, in the order they play. Any card can chain prayers and readings. */
export function chainOf(segment) {
  return segment.content?.more ?? [];
}

/** The songs on a card, in sung order. Any card can hold songs; a song card's songs are the same list. */
export function songsOf(segment) {
  return segment.content?.hymnIds ?? [];
}

/**
 * A card's runtime: its own minutes (the operator's figure, which can be overridden) plus the minutes of each chained item.
 * Each chained item carries its own minutes, so the total follows what is attached.
 */
export function runtimeOf(segment) {
  return (Number(segment.minutes) || 0) + chainOf(segment).reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
}

export function totalMinutes(segments) {
  return segments.reduce((sum, s) => sum + runtimeOf(s), 0);
}

export function groupMinutes(segments, groupKey) {
  return totalMinutes(segments.filter((s) => s.group === groupKey));
}

/** 74 → "1h 14m", 39 → "39m". */
export function formatRunTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** A hymn suits a segment when it is tagged for it, or when its category is the one the segment asks for. */
export function fitsSegment(hymn, segment, tags) {
  if (tags.some((t) => t.hymnId === hymn.id && t.segmentKey === segment.key)) return true;
  return segment.content.kind === 'song' && segment.content.category != null && hymn.category === segment.content.category;
}

/**
 * The segment types a slot may hold. The template decides, by the segment's key, so a saved session that predates the `types`
 * field still follows the lineup. A segment the template does not list holds only its own type.
 */
export function typesFor(segment) {
  return DEFAULT_TEMPLATE.segments.find((t) => t.key === segment.key)?.types ?? [segment.type];
}

/** Whether items from a library tab (song, prayer or scripture) may go into this segment. */
export function acceptsTab(segment, tab) {
  return typesFor(segment).includes(tab);
}

/**
 * The segment fields that put a song into it, or null when nothing should change. A song slot fills, replaces or adds as before.
 * A slot that holds something else (the title slide) takes its first song only if its types allow songs. Its minutes stay as they
 * are, since songs carry no duration.
 */
export function songAssignment(segment, hymnId, replacing) {
  const c = segment.content;
  if (c.kind !== 'song') {
    // A card whose first item is something else keeps it. The song joins the card's songs, or takes the place of the one replaced.
    const songs = songsOf(segment);
    if (songs.includes(hymnId)) return null;
    const hymnIds = replacing != null && songs.includes(replacing) ? songs.map((id) => (id === replacing ? hymnId : id)) : [...songs, hymnId];
    const arrangement = Object.fromEntries(Object.entries(segment.arrangement).filter(([id]) => hymnIds.includes(Number(id))));
    return { content: { ...c, hymnIds }, arrangement };
  }
  let hymnIds;
  if (replacing != null && c.hymnIds.includes(replacing)) hymnIds = c.hymnIds.map((id) => (id === replacing ? hymnId : id));
  else if (c.maxSongs === 1) hymnIds = [hymnId];
  else if (c.hymnIds.includes(hymnId) || c.hymnIds.length >= c.maxSongs) return null;
  else hymnIds = [...c.hymnIds, hymnId];
  // An arrangement belongs to the song it was made for, so a replaced song's arrangement goes with it.
  const arrangement = Object.fromEntries(Object.entries(segment.arrangement).filter(([id]) => hymnIds.includes(Number(id))));
  return { type: 'song', content: { ...c, hymnIds }, arrangement };
}

/** The segment fields that put a scripture item (a title slide or a reading) into it, or null when its types do not allow scripture. */
export function scriptureAssignment(segment, content) {
  if (!acceptsTab(segment, 'scripture')) return null;
  return { type: 'scripture', content, arrangement: {} };
}

/** The item a card's first slot holds, in the shape a chained item takes. Null for an empty prayer slot or a title slide. */
export function primaryOf(segment) {
  const c = segment.content;
  if (c.kind === 'prayer') return c.noteId != null ? { kind: 'prayer', noteId: c.noteId } : null;
  if (c.kind === 'lectionary') return { kind: 'lectionary', readingType: c.readingType };
  return null;
}

/** Whether a chained item fits this card: prayers chain into prayer cards, readings into scripture cards. Song cards never chain. */
export function chainAccepts(segment, item) {
  return Boolean(segment.content) && (item.kind === 'prayer' || item.kind === 'lectionary');
}

const sameItem = (a, b) => a.kind === b.kind && (a.kind === 'prayer' ? a.noteId === b.noteId : a.readingType === b.readingType);

/** Whether the card already holds `item`, as its first item or in its chain. */
export function holdsItem(segment, item) {
  const primary = primaryOf(segment);
  return Boolean((primary && sameItem(primary, item)) || chainOf(segment).some((x) => sameItem(x, item)));
}

/**
 * The segment fields that chain `item` after the card's last item, or null when the card refuses it: wrong kind, already in the card,
 * or full. The first item of the card is never duplicated by a chain.
 */
export function chainAssignment(segment, item) {
  if (!chainAccepts(segment, item)) return null;
  const more = chainOf(segment);
  if (more.length >= MAX_CHAIN || holdsItem(segment, item)) return null;
  return withChain(segment, [...more, { ...item, minutes: Number(item.minutes) || 0 }]);
}

/** The segment fields that replace the card's chain. The first item is untouched. */
export function withChain(segment, more) {
  return { content: { ...segment.content, more } };
}

/** `list` with the item at `index` moved one place up (-1) or down (+1). The list is returned as it was when the move is off the end. */
export function shiftItem(list, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** `list` with the item at `from` moved to position `to` (its place in the new list). Off-range positions leave the list as it was. */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The segment fields after a song is dragged from `from` to `to` within the card. Null when nothing moves. */
export function reorderSong(segment, from, to) {
  const songs = songsOf(segment);
  const hymnIds = moveItem(songs, from, to);
  return hymnIds === songs ? null : { content: { ...segment.content, hymnIds } };
}

/** The segment fields after a chained item is dragged from `from` to `to` within the card. Null when nothing moves. */
export function reorderChainItem(segment, from, to) {
  const more = chainOf(segment);
  const next = moveItem(more, from, to);
  return next === more ? null : withChain(segment, next);
}

/** The segment fields after the song at `index` moves one place up (-1) or down (+1), or null when it cannot move. */
export function moveSong(segment, index, delta) {
  const songs = songsOf(segment);
  const hymnIds = shiftItem(songs, index, delta);
  return hymnIds === songs ? null : { content: { ...segment.content, hymnIds } };
}

/** The segment fields after one song leaves the card. Its arrangement goes with it. Null when the song is not on the card. */
export function removeSong(segment, hymnId) {
  if (!songsOf(segment).includes(hymnId)) return null;
  const arrangement = Object.fromEntries(Object.entries(segment.arrangement).filter(([id]) => Number(id) !== hymnId));
  return { content: { ...segment.content, hymnIds: songsOf(segment).filter((id) => id !== hymnId) }, arrangement };
}

/** The segment fields after the chained item at `index` moves one place up (-1) or down (+1), or null when it cannot move. */
export function moveChainItem(segment, index, delta) {
  const more = chainOf(segment);
  const next = shiftItem(more, index, delta);
  return next === more ? null : withChain(segment, next);
}

/** The segment fields after the chained item at `index` leaves the card. The first item and the other chained items stay. */
export function removeChainItem(segment, index) {
  const more = chainOf(segment);
  if (index < 0 || index >= more.length) return null;
  return withChain(segment, more.filter((_, k) => k !== index));
}

/** Short chip label for a stanza, in the lyrics parser's own tags: "Verse 2" → V2, "Chorus" → C. */
export function sectionChip(stanzaType) {
  const m = String(stanzaType).match(/^(Verse|Chorus|Bridge|Tag|Outro)\s*(\d*)$/);
  if (!m) return String(stanzaType).slice(0, 3).toUpperCase();
  return `${{ Verse: 'V', Chorus: 'C', Bridge: 'B', Tag: 'T', Outro: 'O' }[m[1]]}${m[2]}`;
}

/** The order a hymn's sections are sung in: the segment's override, or the stanzas as stored. Unknown ids are dropped. */
export function sectionOrder(hymn, arrangement) {
  const ids = hymn.stanzas.map((s) => String(s.id));
  const override = arrangement?.[String(hymn.id)];
  const order = Array.isArray(override) ? override.filter((id) => ids.includes(id)) : [];
  return order.length ? order : ids;
}

/** Splits a text into slides at blank lines. Blocks longer than `maxLines` are cut into runs of that many lines. */
export function pagesOf(text, maxLines = 5) {
  const pages = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    for (let i = 0; i < lines.length; i += maxLines) pages.push(lines.slice(i, i + maxLines).join('\n'));
  }
  return pages;
}

export {
  PRAYER_STAGE,
  prayerFit,
  LINEUP_PRAYER_FIT,
  PRAYER_FIT_CHARS,
  PRAYER_FIT_LINES,
  visualLinesOf,
  prayerTextHeight,
  fitsPrayerSlide,
  prayerPages,
} from './prayer-fit.js';

/**
 * The slides a segment shows, in order. `resolved` carries the content already loaded from the libraries:
 * `{ hymns: Hymn[], prayer: { title, body } | null, reading: { citation, rawText } | null }`.
 *
 * Slide kinds: `title` (segment title slide), `lyrics` (one song section), `prayer` (one page of prayer or reading).
 * A segment always has at least one slide, so the projector never goes blank mid-lineup.
 */
export function slidesFor(segment, resolved = {}, options = {}) {
  // The lower third on screen, if any: a page leaves room for it, so the split can change. Without one, the layout is the lineup's own.
  const band = options.band ?? null;
  // The operator's size scale: every page is laid out for the text at that size, so a larger scale makes more pages.
  const scale = options.scale ?? 1;
  const c = segment.content;
  const title = { kind: 'title', label: segment.name, subtitle: '' };
  const titleFirst = segment.cues.titleFirst;

  // A card holds three kinds of item, in this order: its own first item (a prayer, a reading or a title slide), its songs, then its chain.
  // Each part is built alone and the parts join, so the card plays straight through.
  let head = [];
  if (c.kind === 'prayer') head = prayerSlides(segment, resolved.prayer, scale, titleFirst ? title : null);
  else if (c.kind === 'lectionary') head = readingSlides(segment, resolved.reading, titleFirst);
  else if (c.kind === 'title') head = [title];

  // A song card's title slide names its songs. On a card whose first item is something else, the songs follow without one.
  const songs = songSlides(segment, resolved.hymns ?? [], { band, scale, withTitle: c.kind === 'song' && titleFirst });
  const slides = [...head, ...songs, ...chainSlides(segment, resolved, scale)];
  // A card with nothing to show keeps its title slide, so the projector never goes blank mid-lineup.
  return slides.length ? slides : [title];
}

/** The slides of a card's songs, in the card's order. Songs not loaded yet are skipped. `withTitle` adds the song card's title slide. */
function songSlides(segment, hymns, { band, scale, withTitle }) {
  const list = songsOf(segment).map((id) => hymns.find((h) => h.id === id)).filter(Boolean);
  if (list.length === 0) return [];
  const slides = [];
  if (withTitle) slides.push({ kind: 'title', label: segment.name, subtitle: list.map((h) => h.title).join(' · ') });
  for (const hymn of list) {
    // The song's slides are one group: its normal slides share one top, and a short one is centred (see shared/text-area.js).
    const entries = [];
    for (const sectionId of sectionOrder(hymn, segment.arrangement)) {
      const stanza = hymn.stanzas.find((s) => String(s.id) === sectionId);
      // The stanza's position in the song, and the song's stanza count, let the projector follow an edit while this slide is live.
      // A stanza longer than a lineup slide is split under the same rule as a prayer. Each page keeps the stanza's text, in order.
      // The band, when it is on, only changes how the stanza is split: the text and its size stay the same.
      const pages = lyricPagesFor(stanza.lyricsText, band, scale);
      entries.push({ sectionId, stanza, list: pages.length ? pages : [''] });
    }
    const tops = pageTops(entries.flatMap((e) => e.list), PRAYER_MAX_PX * scale);
    let k = 0;
    for (const { sectionId, stanza, list } of entries) {
      for (const [part, text] of list.entries()) {
        const { top, centred } = tops[k];
        k += 1;
        slides.push({ kind: 'lyrics', label: stanza.stanzaType, chip: sectionChip(stanza.stanzaType), text, hymnId: hymn.id, hymnTitle: hymn.title, sectionId, position: hymn.stanzas.indexOf(stanza), stanzaCount: hymn.stanzas.length, part, parts: list.length, fontPx: 96, top, centred, align: hymn.style?.textAlign ?? 'center' });
      }
    }
  }
  return slides;
}

/** One prayer's slides: its title slide (when given), then its pages. A prayer with no text shows the placeholder. */
function prayerSlides(segment, prayer, scale, titleSlide) {
  const slides = titleSlide ? [titleSlide] : [];
  if (!prayer?.body?.trim()) {
    slides.push({ kind: 'prayer', label: segment.name, text: PRAYER_PLACEHOLDER, placeholder: true });
    return slides;
  }
  // The same split on every surface, at one size; each slide's text block is centred in the shared text area (see shared/prayer-slides.js).
  const laidOut = prayerSlidesFor(prayer.body, normalizeSplit(prayer.split, prayer.body), scale);
  laidOut.pages.forEach((page, part) =>
    slides.push({
      kind: 'prayer',
      label: segment.name,
      text: page.text,
      fontPx: page.fontPx,
      top: page.top,
      centred: page.centred,
      align: prayer.align ?? 'center',
      part,
      parts: laidOut.pages.length,
      placeholder: false,
      ...(laidOut.mode === 'stale' ? { notice: 'stale' } : {}),
    }),
  );
  return slides;
}

/** One reading's slides. Nothing entered for the day yet: a title slide with the citation stands in. */
function readingSlides(segment, reading, titleFirst) {
  const title = { kind: 'title', label: segment.name, subtitle: '' };
  if (!reading?.rawText?.trim()) return [{ ...title, subtitle: reading?.citation ?? '' }];
  const slides = titleFirst ? [{ ...title, subtitle: reading.citation }] : [];
  pagesOf(reading.rawText).forEach((text) => slides.push({ kind: 'prayer', label: reading.citation || segment.name, text }));
  return slides;
}

/**
 * The slides of the items chained after a card's first item, in order. `resolved.more` lines up with the chain: each entry carries the
 * prayer or reading that item points at. A chained prayer gets its own title slide, so the operator sees each one start.
 */
function chainSlides(segment, resolved, scale) {
  const title = { kind: 'title', label: segment.name, subtitle: '' };
  return chainOf(segment).flatMap((item, i) => {
    const entry = resolved.more?.[i] ?? {};
    if (item.kind === 'prayer') {
      const titleSlide = segment.cues.titleFirst ? { ...title, subtitle: entry.prayer?.title ?? '' } : null;
      return prayerSlides(segment, entry.prayer ?? null, scale, titleSlide);
    }
    return readingSlides(segment, entry.reading ?? null, segment.cues.titleFirst);
  });
}

/**
 * Moves through the lineup. `counts` is the number of slides in each segment, `pos` is `{ segment, slide }`.
 * Next goes to the next slide, then to the first slide of the next segment; Back mirrors it. Returns null at either end.
 */
export function step(counts, pos, delta) {
  if (counts.length === 0) return null;
  let { segment, slide } = pos;
  slide += delta;
  while (segment >= 0 && segment < counts.length && (slide < 0 || slide >= counts[segment])) {
    if (slide < 0) {
      segment -= 1;
      slide = segment >= 0 ? counts[segment] - 1 : 0;
    } else {
      segment += 1;
      slide = 0;
    }
  }
  if (segment < 0 || segment >= counts.length) return null;
  return { segment, slide };
}

/**
 * Which slides of a song a list shows while "Show all verses" is off: the live one and the next one. Before any slide is
 * live (`liveIndex` is -1 or null), only the first is shown, as the next one. Returns indexes in order.
 */
export function visibleSlideIndexes(count, liveIndex) {
  if (liveIndex == null || liveIndex < 0) return count > 0 ? [0] : [];
  return [liveIndex, liveIndex + 1].filter((i) => i < count);
}

/**
 * Where the live position is in the lineup now. It is held by segment key, so reordering a live lineup moves nothing on
 * the projector. A null `segmentKey` is the start of the lineup. Null when the live segment has been removed.
 */
export function livePosition(segments, pw) {
  if (!pw) return null;
  if (pw.segmentKey == null) return { segment: 0, slide: 0 };
  const index = segments.findIndex((s) => s.key === pw.segmentKey);
  return index < 0 ? null : { segment: index, slide: pw.slide };
}

/** The lineup in group order. Within a group, segments keep their relative order. */
export function groupOrdered(segments, groups) {
  const rank = new Map(groups.map((g, i) => [g.key, i]));
  return segments
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (rank.get(a.s.group) ?? 99) - (rank.get(b.s.group) ?? 99) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Drag and drop: moves the segment at `from` to position `slot` among `group`'s rows, as shown (source row included).
 * A segment dropped in another group joins it. Returns the lineup in group order.
 */
export function moveSegment(segments, groups, from, group, slot) {
  const list = groupOrdered(segments, groups);
  const moved = list[from];
  if (!moved) return list;
  let target = slot;
  if (moved.group === group) {
    // Removing a row above the target shifts the target up by one.
    const sourceSlot = list.slice(0, from).filter((s) => s.group === group).length;
    if (sourceSlot < slot) target -= 1;
  }
  const rest = list.filter((_, i) => i !== from);
  const members = rest.flatMap((s, i) => (s.group === group ? [i] : []));
  let at;
  if (members.length === 0) {
    const rank = groups.findIndex((g) => g.key === group);
    at = rest.findIndex((s) => groups.findIndex((g) => g.key === s.group) > rank);
    if (at < 0) at = rest.length;
  } else if (target < members.length) {
    at = members[Math.max(target, 0)];
  } else {
    at = members[members.length - 1] + 1;
  }
  return [...rest.slice(0, at), { ...moved, group }, ...rest.slice(at)];
}

/**
 * Keyboard reorder: one step up (-1) or down (+1). At the edge of a group the segment crosses into the
 * neighbouring group instead of swapping, so every position is reachable. Returns `{ segments, index }`.
 */
export function nudgeSegment(segments, groups, index, delta) {
  const list = groupOrdered(segments, groups);
  const seg = list[index];
  if (!seg) return { segments: list, index };
  const neighbour = list[index + delta];
  if (neighbour && neighbour.group === seg.group) {
    const next = list.slice();
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    return { segments: next, index: index + delta };
  }
  const g = groups.findIndex((x) => x.key === seg.group) + delta;
  if (g < 0 || g >= groups.length) return { segments: list, index };
  const groupKey = groups[g].key;
  const slot = delta < 0 ? list.filter((s) => s.group === groupKey).length : 0;
  const next = moveSegment(list, groups, index, groupKey, slot);
  return { segments: next, index: next.findIndex((s) => s === seg || (s.key === seg.key && s.group === groupKey)) };
}

/**
 * A new, empty card of `type`. Its key and name are the caller's, so a key stays unique across the lineup. Minutes start at 5
 * and the operator changes them. Its group is set when it is inserted.
 */
export function newLineupCard({ key, name, type, minutes = 5 }) {
  const content =
    type === 'song'
      ? { kind: 'song', hymnIds: [], maxSongs: 1, category: null, more: [] }
      : type === 'prayer'
        ? { kind: 'prayer', noteId: null, hymnIds: [], more: [] }
        : { kind: 'title', hymnIds: [], more: [] };
  return { key, group: '', name, type, minutes, leader: '', content, arrangement: {}, cues: { ...DEFAULT_CUES }, notes: '' };
}

/**
 * Inserts a card straight after the card at `after` (an index in group order), in that card's group. With no card to follow
 * (`after` is -1), it goes to the top of the first group. Returns the lineup in group order and the new card's index.
 * Throws when the lineup is full or the key is taken.
 */
export function addLineupCard(segments, groups, after, card) {
  const list = groupOrdered(segments, groups);
  if (list.length >= MAX_SEGMENTS) throw new Error(`A lineup can have at most ${MAX_SEGMENTS} cards.`);
  if (list.some((s) => s.key === card.key)) throw new Error('Each card in a lineup needs its own key.');
  const anchor = list[after] ?? null;
  const group = anchor?.group ?? groups[0]?.key;
  if (!group) throw new Error('A lineup needs a group before a card can be added.');
  const at = anchor ? after + 1 : 0;
  const next = [...list.slice(0, at), { ...card, group }, ...list.slice(at)];
  return { segments: next, index: at };
}

/**
 * Removes the card at `index` (an index in group order). The selection moves to the card that takes its place, or to the last card
 * when the removed one was at the end. Returns the lineup in group order and the selected index.
 */
export function removeLineupCard(segments, groups, index) {
  const list = groupOrdered(segments, groups);
  if (!list[index]) return { segments: list, index: Math.min(index, Math.max(list.length - 1, 0)) };
  const next = list.filter((_, i) => i !== index);
  return { segments: next, index: Math.min(index, Math.max(next.length - 1, 0)) };
}
