// The Praise & Worship lineup as a list the planner can change: segments added, taken out, renamed, put in another order or another section.
// Pure, so the tests run it without a browser. The laptop's twelve segments are the starting point (plan-model.js PRAISE_TEMPLATE); a plan that
// already has items is read as it was saved: the segments it has, in the order it has them, in the sections it put them in.
//
// A segment added here is named on its first item's `title`, the field the server already keeps for an item. Nothing new crosses the wire: the
// laptop reads the same key, group, kind, minutes and title, and makes a card of that name (electron/plan-sync-store.js nameFor).
import { PRAISE_TEMPLATE, praiseSegments, isLegacyPraisePlan } from './plan-model.js';
import { PW_LINEUP } from './lineup-templates.js';

export const DEFAULT_SEGMENT_MINUTES = 5;
export const MAX_SEGMENT_NAME = 80;

const STANDARD_GROUPS = PW_LINEUP.groups.map((g) => g.key);
const GROUP_NAME = Object.fromEntries(PW_LINEUP.groups.map((g) => [g.key, g.name]));

/** The name a section is shown under: the laptop's own for its three, else the key made readable ("sample_part" → "Sample part"). */
export function groupTitle(key) {
  if (GROUP_NAME[key]) return GROUP_NAME[key];
  const words = String(key ?? '').replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other';
}

/** What a segment holds first. A prayer is a spoken part ('rite'), scripture a reading with a title slide behind it, a song a song. */
export const SEGMENT_TYPES = Object.freeze([
  { id: 'prayer', label: 'Prayer', kind: 'rite' },
  { id: 'song', label: 'Song', kind: 'song' },
  { id: 'scripture', label: 'Scripture', kind: 'reading' },
]);
export const typeOfKind = (kind) => (kind === 'song' ? 'song' : kind === 'reading' ? 'scripture' : 'prayer');
const kindOfType = (type) => SEGMENT_TYPES.find((t) => t.id === type)?.kind ?? 'rite';

const segmentIdOf = (item) => String(item?.slotId ?? item?.key ?? '').replace(/(\.\d+)+$/, '');
const rankOf = (group, extras) => {
  const at = STANDARD_GROUPS.indexOf(group);
  return at >= 0 ? at : STANDARD_GROUPS.length + Math.max(0, extras.indexOf(group));
};

/** The sections in the order they are shown: the laptop's three, then any other in the order the segments first name it. */
export function groupOrder(segs) {
  const extras = [];
  for (const seg of segs) if (!STANDARD_GROUPS.includes(seg.group) && !extras.includes(seg.group)) extras.push(seg.group);
  return [...STANDARD_GROUPS, ...extras];
}

/** The segments in section order (each section's segments keep their order), numbered 1 upward. */
export function normalised(segs) {
  const extras = groupOrder(segs).slice(STANDARD_GROUPS.length);
  return segs
    .map((seg, index) => ({ seg, index }))
    .sort((a, b) => rankOf(a.seg.group, extras) - rankOf(b.seg.group, extras) || a.index - b.index)
    .map(({ seg }, index) => ({ ...seg, n: index + 1 }));
}

/** The template the breakdown reads: one section for each group a segment is in, the laptop's three always present. */
export function templateFor(segs) {
  return { ...PRAISE_TEMPLATE, sections: groupOrder(segs).map((group) => ({ title: groupTitle(group), group, rows: [] })) };
}

function customSegment({ id, name, kind, group, minutes = DEFAULT_SEGMENT_MINUTES }) {
  const reading = kind === 'reading';
  return {
    id,
    n: 0,
    name,
    kind,
    group,
    defaultMinutes: minutes,
    hint: '',
    optional: reading,
    ...(reading ? { emptyLabel: 'Title slide' } : {}),
    ...(kind === 'song' ? { pickerCategory: '', maxSongs: 1 } : {}),
    custom: true,
  };
}

/**
 * The lineup a saved plan opens in: { template, segs, removed }. A plan with no items is the laptop's twelve segments. A plan with items is the
 * segments it has: a laptop segment the plan has no item for was taken out, and is listed in `removed` so it can be put back; an item the template has
 * no segment for (added here or on the laptop) is a segment of its own, in the position and section its items gave it. `titleOfSong` names a
 * segment that came without a name from its song.
 */
export function lineupFromPlan(items = [], titleOfSong = () => '') {
  const base = praiseSegments(PRAISE_TEMPLATE);
  if (!items.length || isLegacyPraisePlan(items)) return { template: PRAISE_TEMPLATE, segs: base, removed: [] };
  const firstOf = new Map();
  for (const item of [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const id = segmentIdOf(item);
    if (id && !firstOf.has(id)) firstOf.set(id, item);
  }
  const known = new Map(base.map((seg) => [seg.id, seg]));
  const segs = [];
  const removed = [];
  for (const seg of base) {
    if (firstOf.has(seg.id)) segs.push({ ...seg, group: firstOf.get(seg.id).group || seg.group });
    else removed.push(seg);
  }
  for (const [id, item] of firstOf) {
    if (known.has(id)) continue;
    const kind = item.kind === 'song' ? 'song' : item.kind === 'reading' ? 'reading' : 'rite';
    const hub = Boolean(item.contentHubId);
    const name = (!hub && item.title) || (item.songId ? titleOfSong(item.songId) : '') || (kind === 'song' ? 'Song' : item.text || (kind === 'reading' ? 'Scripture' : 'Prayer'));
    segs.push(customSegment({ id, name: String(name).slice(0, MAX_SEGMENT_NAME), kind, group: item.group || 'praise', minutes: item.minutes ?? DEFAULT_SEGMENT_MINUTES }));
  }
  // The order the plan was saved in: each segment sits where its first item did.
  const place = (seg) => [...firstOf.keys()].indexOf(seg.id);
  const ordered = [...segs].sort((a, b) => place(a) - place(b));
  const result = normalised(ordered);
  return { template: templateFor(result), segs: result, removed };
}

/** A key for a new segment: neutral, at most 14 characters, and not any key a segment or an item already uses. */
export function newSegmentId(segs, extraKeys = []) {
  const used = new Set([...segs.map((s) => s.id), ...extraKeys]);
  let n = 1;
  while (used.has(`seg_${n}`)) n += 1;
  return `seg_${n}`;
}

/**
 * A segment to add: `name` (trimmed, up to 80 characters), `type` ('prayer', 'song' or 'scripture'), the section it goes in, and its minutes.
 * Returns { seg } or { error } in plain words.
 */
export function buildSegment({ name, type = 'prayer', group = 'praise', minutes = DEFAULT_SEGMENT_MINUTES } = {}, segs = [], extraKeys = []) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return { error: 'Give the segment a title.' };
  if (clean.length > MAX_SEGMENT_NAME) return { error: `A segment title can be up to ${MAX_SEGMENT_NAME} characters.` };
  const minutesNumber = Number(minutes);
  if (!Number.isInteger(minutesNumber) || minutesNumber < 1 || minutesNumber > 60) return { error: 'A segment runs for 1 to 60 minutes.' };
  const target = groupOrder(segs).includes(group) ? group : 'praise';
  return { seg: customSegment({ id: newSegmentId(segs, extraKeys), name: clean, kind: kindOfType(type), group: target, minutes: minutesNumber }) };
}

/** The segments with `seg` at the end of its section. */
export const withSegmentAdded = (segs, seg) => normalised([...segs, seg]);

/** The segments without `id`. */
export const withoutSegment = (segs, id) => normalised(segs.filter((s) => s.id !== id));

/** The segments with one segment's name changed. Only a segment added here is named by the planner; the laptop's twelve keep the laptop's names. */
export const withSegmentRenamed = (segs, id, name) =>
  segs.map((s) => (s.id === id && s.custom ? { ...s, name: String(name).replace(/\s+/g, ' ').trim().slice(0, MAX_SEGMENT_NAME) || s.name } : s));

/**
 * The segments with `id` one place earlier (delta -1) or later (+1). Inside a section it swaps with its neighbour; at the edge of a section it
 * goes into the next section over (the end of the one above, the start of the one below). The first and last segment stay where they are.
 */
export function withSegmentMoved(segs, id, delta) {
  const list = normalised(segs);
  const at = list.findIndex((s) => s.id === id);
  if (at < 0 || (delta !== -1 && delta !== 1)) return segs;
  const seg = list[at];
  const neighbour = list[at + delta];
  if (!neighbour) {
    // The edge of the lineup. A segment at the top of a later section may still move up into an empty section above it.
    const order = groupOrder(list);
    const next = order[order.indexOf(seg.group) + delta];
    if (!next || list.some((s) => s.group === next)) return segs;
    return normalised(list.map((s) => (s.id === id ? { ...s, group: next } : s)));
  }
  if (neighbour.group === seg.group) {
    const swapped = [...list];
    [swapped[at], swapped[at + delta]] = [swapped[at + delta], swapped[at]];
    return normalised(swapped);
  }
  // Into the neighbour's section: first of it when moving down, last of it when moving up, which is where the list already puts it.
  return normalised(list.map((s) => (s.id === id ? { ...s, group: neighbour.group } : s)));
}

/** The segments with `id` dropped before `targetId` (or after it, with `after`), in the target's section. */
export function withSegmentDropped(segs, id, targetId, after = false) {
  const list = normalised(segs);
  const moving = list.find((s) => s.id === id);
  const target = list.find((s) => s.id === targetId);
  if (!moving || !target || id === targetId) return segs;
  const rest = list.filter((s) => s.id !== id);
  const to = rest.findIndex((s) => s.id === targetId) + (after ? 1 : 0);
  rest.splice(to, 0, { ...moving, group: target.group });
  return normalised(rest);
}

/** A laptop segment taken out of the plan, put back as it was in the laptop's lineup (at the end of its own section). */
export function withSegmentRestored(segs, id) {
  const seg = praiseSegments(PRAISE_TEMPLATE).find((s) => s.id === id);
  return seg && !segs.some((s) => s.id === id) ? normalised([...segs, seg]) : segs;
}

/**
 * What a segment's row says about itself: 'ready' (it holds something), 'auto' (a reading or title slide the laptop fills itself), or what it still
 * needs ('Needs prayer' / 'Needs song' / 'Needs reading'). `row` is a praiseRow.
 */
export function segmentStatus(row) {
  if (row.entries.length > 0) return { tone: 'ready', label: 'Ready' };
  if (row.kind === 'reading') return row.optional ? { tone: 'auto', label: 'Auto' } : { tone: 'needs', label: 'Needs reading' };
  return { tone: 'needs', label: row.kind === 'song' ? 'Needs song' : 'Needs prayer' };
}

/** The line under a segment's title: what it holds, or what to pick. */
export function segmentSubtitle(row) {
  if (row.entries.length > 0) return row.entries.map((e) => e.title).filter(Boolean).join(' + ') || row.value;
  if (row.kind === 'song') return '[Select song]';
  if (row.kind === 'reading') return row.emptyLabel || 'Title slide';
  return '[Select prayer]';
}
