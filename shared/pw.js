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

export const MAX_SONGS = 3;

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
    { key: 'bible_enthronement', group: 'opening', name: 'Bible Enthronement', type: 'scripture', minutes: 4, content: { kind: 'title' } },
    { key: 'joyful_song', group: 'praise', name: 'Joyful Song', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    { key: 'worship', group: 'praise', name: 'Worship', type: 'song', minutes: 15, content: { kind: 'song', hymnIds: [], maxSongs: 3, category: null } },
    { key: 'repentance', group: 'praise', name: 'Repentance', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    { key: 'holy_spirit', group: 'praise', name: 'Holy Spirit', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    { key: 'gospel_acclamation', group: 'word', name: 'Gospel Acclamation', type: 'scripture', minutes: 3, content: { kind: 'lectionary', readingType: GOSPEL_ACCLAMATION } },
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
  switch (c.kind) {
    case 'song':
      return c.hymnIds.length > 0 ? 'ready' : 'needs_song';
    case 'prayer':
      return c.noteId != null ? 'ready' : 'needs_prayer';
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

export function totalMinutes(segments) {
  return segments.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
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

/**
 * The slides a segment shows, in order. `resolved` carries the content already loaded from the libraries:
 * `{ hymns: Hymn[], prayer: { title, body } | null, reading: { citation, rawText } | null }`.
 *
 * Slide kinds: `title` (segment title slide), `lyrics` (one song section), `prayer` (one page of prayer or reading).
 * A segment always has at least one slide, so the projector never goes blank mid-lineup.
 */
export function slidesFor(segment, resolved = {}) {
  const c = segment.content;
  const title = { kind: 'title', label: segment.name, subtitle: '' };
  const slides = [];

  if (c.kind === 'song') {
    const hymns = (resolved.hymns ?? []).filter((h) => c.hymnIds.includes(h.id));
    // No song: the projector shows only the segment's title slide.
    if (hymns.length === 0) return [title];
    if (segment.cues.titleFirst) slides.push({ ...title, subtitle: hymns.map((h) => h.title).join(' · ') });
    for (const hymn of c.hymnIds.map((id) => hymns.find((h) => h.id === id)).filter(Boolean)) {
      for (const sectionId of sectionOrder(hymn, segment.arrangement)) {
        const stanza = hymn.stanzas.find((s) => String(s.id) === sectionId);
        slides.push({ kind: 'lyrics', label: stanza.stanzaType, chip: sectionChip(stanza.stanzaType), text: stanza.lyricsText, hymnId: hymn.id, hymnTitle: hymn.title, sectionId });
      }
    }
    return slides;
  }

  if (c.kind === 'prayer') {
    if (segment.cues.titleFirst) slides.push(title);
    const body = resolved.prayer?.body?.trim();
    const pages = body ? pagesOf(body) : [PRAYER_PLACEHOLDER];
    pages.forEach((text) => slides.push({ kind: 'prayer', label: segment.name, text, placeholder: !body }));
    return slides;
  }

  if (c.kind === 'lectionary') {
    const reading = resolved.reading;
    // Nothing entered for the day yet: the title slide stands in.
    if (!reading?.rawText?.trim()) return [{ ...title, subtitle: reading?.citation ?? '' }];
    if (segment.cues.titleFirst) slides.push({ ...title, subtitle: reading.citation });
    pagesOf(reading.rawText).forEach((text) => slides.push({ kind: 'prayer', label: reading.citation || segment.name, text }));
    return slides;
  }

  return [title];
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
