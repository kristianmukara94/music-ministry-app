// The plan editor's rules, with no page and no network in them, so the editors and their tests use the same code. The steps and
// their structure come from the template. What is chosen, typed, timed and noted comes only from the saved plan on the server.
// The template's sample values are never used as data.

import { LEGACY_STEP_SLOT, MASS_SECTIONS, MASS_SLOTS, slotOfNumber } from './mass-slots.js';
import { PW_LINEUP, PW_SEGMENT_KEYS, pickerCategoryForName, pickerCategoryLabel, serviceTypeOfPlanKind } from './lineup-templates.js';

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 60;
export const VIEW_ONLY = 'View only. Ask a planner to make changes.';
export const NO_SONGS = 'No songs yet. Songs are added from the church laptop.';

/** The Mass steps from the template: number, name, kind, song category, and the hint. */
// The group each Mass section belongs to, by section order. The laptop's blocks are introductory, word, eucharist and concluding;
// the web's fifth section, Communion, is its own group.
export const MASS_GROUPS = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];
export const PRAISE_GROUPS = ['opening', 'word', 'closing'];

export function massSteps(template) {
  return template.sections.flatMap((section, index) =>
    section.rows.map(([n, name, kind, category, , , optional, hint]) => ({
      n,
      name,
      kind,
      category: category || '',
      optional: !!optional,
      hint: hint || '',
      group: MASS_GROUPS[index],
    })),
  );
}

/**
 * The rows the Holy Mass editor shows, in sections: for each of the four parts of the Mass, its numbered slots first, then the other steps
 * of the website's earlier editor that fill no slot (Greeting, Preface, Dismissal …), still there to fill.
 *
 * A row is { id, n, slot, name, kind, category, group, optional, hint, legacyKey }. `id` names the row in the editor's state: "s7" for a
 * slot, the step number for another step. `n` is the number shown. `legacyKey` is the key the earlier editor gave the step that stands for
 * the slot, so a plan saved by it is read into the slot. `kind` is 'song', 'reading', 'rite', or 'slot-text' for a spoken slot, whose
 * words are typed.
 */
export function massSections(template) {
  const steps = massSteps(template);
  const slotByStep = new Map(steps.map((step) => [String(step.n), LEGACY_STEP_SLOT[step.n] ?? null]));
  return MASS_SECTIONS.map((section) => {
    const slots = MASS_SLOTS.filter((slot) => section.groups.includes(slot.group)).map((slot) => ({
      id: `s${slot.number}`,
      n: slot.position,
      slot: slot.number,
      name: slot.name,
      kind: slot.kind === 'text' ? 'slot-text' : slot.kind,
      category: slot.category ?? '',
      // The song picker opens on this category for the slot.
      pickerCategory: pickerCategoryForName('mass', slot.category) ?? '',
      group: slot.group,
      optional: false,
      hint: '',
      legacyKey: Object.entries(LEGACY_STEP_SLOT).find(([, number]) => number === slot.number)?.[0] ?? null,
    }));
    const others = steps
      .filter((step) => section.groups.includes(step.group) && !slotByStep.get(String(step.n)))
      .map((step) => ({ ...step, id: String(step.n), slot: null, legacyKey: null, pickerCategory: pickerCategoryForName('mass', step.category) ?? '' }));
    return { ...section, rows: [...slots, ...others] };
  });
}

/** Every row of the editor, in order. */
export const massRows = (template) => massSections(template).flatMap((section) => section.rows);

// ---- The Praise & Worship lineup ----
// A plan is laid out as the church laptop lays it out: the twelve slots of the shared lineup (lineup-templates.js), under the laptop's own
// segment keys and in its three groups, so a plan made on either side fills the same slots on the other. A plan saved by the website's
// earlier editor has other steps, numbered 1 to 12, and still opens in that layout (see isLegacyPraisePlan).

/** What the website calls each of the laptop's slot types. */
const WEB_KIND = { prayer: 'rite', song: 'song', scripture: 'reading' };

function lineupRow(slot) {
  const row = { id: slot.key, name: slot.name, kind: WEB_KIND[slot.type], minutes: slot.minutes, hint: '', optional: false };
  if (slot.type === 'prayer') row.hint = 'Prayer';
  if (slot.type === 'song') {
    row.pickerCategory = slot.pickerCategory ?? '';
    row.maxSongs = slot.maxSongs ?? 1;
    row.hint = [pickerCategoryLabel('praise_worship', slot.pickerCategory), row.maxSongs > 1 ? `up to ${row.maxSongs} songs` : ''].filter(Boolean).join(' · ');
  }
  if (slot.type === 'scripture') {
    // The laptop shows a title slide, or the day's reading, when the slot is left as it is. So it never counts as unfilled.
    row.optional = true;
    row.hint = slot.readingType ? 'Lectionary by default' : 'Title slide by default';
    // What the row says while nothing is chosen for it here.
    row.emptyLabel = slot.readingType ? 'From the lectionary, on the church laptop' : 'Title slide';
    // The reading's name is what tells the laptop to fill the slot from the lectionary, so it goes with the empty slot.
    if (slot.readingType) row.defaultText = slot.readingType;
  }
  return row;
}

/** The Praise & Worship editor's template: the laptop's lineup, group by group. `targetMinutes` is the length the time bars are read against. */
export const PRAISE_TEMPLATE = {
  targetMinutes: 90,
  speakerSegment: null,
  sections: PW_LINEUP.groups.map((group) => ({
    title: group.name,
    group: group.key,
    rows: PW_LINEUP.segments.filter((slot) => slot.group === group.key).map(lineupRow),
  })),
};

/** The segment an item belongs to: the step the website recorded, or its key without the number of a further item ("worship.2"). */
const segmentIdOf = (item) => String(item?.slotId ?? item?.key ?? '').replace(/(\.\d+)+$/, '');
const LEGACY_SEGMENT = /^([1-9]|1[0-2])$/;

/**
 * Whether a Praise & Worship plan was laid out by the website's earlier editor: it has a step numbered 1 to 12 and none of the lineup's
 * slots. Such a plan keeps its layout, so nothing in it moves. A new plan, and any plan from the laptop's lineup, is not one.
 */
export function isLegacyPraisePlan(items = []) {
  let legacy = false;
  for (const item of items) {
    const id = segmentIdOf(item);
    if (PW_SEGMENT_KEYS.includes(id)) return false;
    if (LEGACY_SEGMENT.test(id)) legacy = true;
  }
  return legacy;
}

/** The template a Praise & Worship plan opens in: the lineup, or `legacy` (the earlier editor's template) for a plan that editor laid out. */
export const praiseTemplateFor = (items, legacy) => (legacy && isLegacyPraisePlan(items) ? legacy : PRAISE_TEMPLATE);

/** The group a template section's segments are saved in: its own, or the earlier editor's by section order. */
const sectionGroup = (section, index) => section.group ?? PRAISE_GROUPS[index];

/**
 * The Praise & Worship segments from the template: id, name, kind, default minutes and hint. `n` is the number shown. A lineup segment also
 * has the song picker category it opens on. A row is a lineup row (an object) or the earlier editor's [id, name, kind, minutes, value, hint].
 */
// The song picker category each song step of the website's earlier Praise & Worship layout opens on (sample-data.js PRAISE_PLAN). Its steps
// carry no category of their own, so without this they all opened on every song.
const LEGACY_PICKER_CATEGORY = { 2: 'joyful', 3: 'joyful', 5: 'worship', 10: 'offertory', 11: 'finale' };

/** The picker category an earlier-layout song step opens on: its own, else the one its name or hint names ("Fast praise"), else none. */
function legacyPickerCategory(id, name, hint) {
  return LEGACY_PICKER_CATEGORY[id] ?? pickerCategoryForName('praise_worship', name) ?? pickerCategoryForName('praise_worship', hint) ?? '';
}

export function praiseSegments(template) {
  let n = 0;
  return template.sections.flatMap((section, index) =>
    section.rows.map((row) => {
      n += 1;
      const group = sectionGroup(section, index);
      if (!Array.isArray(row)) {
        const { minutes, ...rest } = row;
        return { ...rest, n, defaultMinutes: minutes, group };
      }
      const [id, name, kind, minutes, , hint] = row;
      const pickerCategory = kind === 'song' ? legacyPickerCategory(id, name, hint) : '';
      return { id, n, name, kind, defaultMinutes: minutes, hint: hint || '', optional: hint === 'Optional', group, ...(kind === 'song' ? { pickerCategory } : {}) };
    }),
  );
}

/**
 * What the page starts from when a plan is loaded or discarded: copies of the saved segments and notes, so an edit made on the
 * page cannot change the saved copy. Discard uses this again, so it always goes back to the saved version.
 */
export function savedState(saved) {
  return {
    segments: structuredClone(saved?.segments ?? {}),
    notes: structuredClone(saved?.notes ?? {}),
  };
}

/** The minutes a segment runs for: the saved minutes, or the template's default. */
export const minutesOf = (segments, segment) => segments[segment.id]?.minutes ?? segment.defaultMinutes;

/** Returns new segments with one segment's fields changed. A null, empty or undefined value clears that field. */
export function withChoice(segments, id, patch) {
  const current = { ...(segments[id] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') delete current[key];
    else current[key] = value;
  }
  // A segment holds a song or typed text, never both: choosing one clears the other.
  if (current.songId && current.text) delete current.text;
  return { ...segments, [id]: current };
}

// ---- What a step holds ----
// A step's first item lives on the segment itself, as it always has; any more are in `segment.more`, in order. An entry is
// { key?, songId?, text?, keyTransposed?, contentType?, contentHubId?, title?, durationMinutes?, note? }.
const MAX_KEY = 20;
const ENTRY_FIELDS = ['key', 'songId', 'text', 'keyTransposed', 'contentType', 'contentHubId', 'title', 'durationMinutes'];
const pickEntry = (source, fields = ENTRY_FIELDS) => Object.fromEntries(fields.filter((f) => source?.[f] !== undefined && source[f] !== null && source[f] !== '').map((f) => [f, source[f]]));
const holdsContent = (entry) => Boolean(entry?.songId || entry?.text || entry?.contentHubId);

/** Everything a step holds, first item first. */
export function slotEntries(segment) {
  const first = pickEntry(segment);
  return [...(holdsContent(first) ? [first] : []), ...(segment?.more ?? [])];
}

/** Puts entries back on a segment, keeping what is not an entry (the minutes). */
function withEntries(segment, entries) {
  const rest = Object.fromEntries(Object.entries(segment ?? {}).filter(([field]) => !ENTRY_FIELDS.includes(field) && field !== 'more'));
  const [first, ...more] = entries;
  return { ...rest, ...(first ?? {}), ...(more.length ? { more } : {}) };
}

/** Returns new segments with one more entry at the end of a step. */
export const withEntry = (segments, id, entry) => ({ ...segments, [id]: withEntries(segments[id], [...slotEntries(segments[id]), entry]) });

/** Returns new segments without the step's entry at `index`. The next entry moves up. */
export const withoutEntry = (segments, id, index) => ({ ...segments, [id]: withEntries(segments[id], slotEntries(segments[id]).filter((_, i) => i !== index)) });

/** Returns new segments with the key of the step's entry at `index`. An empty key goes back to the song's own. */
export function withEntryKey(segments, id, index, keyTransposed) {
  const entries = slotEntries(segments[id]).map((entry, i) => {
    if (i !== index) return entry;
    const { keyTransposed: _old, ...rest } = entry;
    return keyTransposed ? { ...rest, keyTransposed } : rest;
  });
  return { ...segments, [id]: withEntries(segments[id], entries) };
}

/** How a step's entries read on the page: a title, where it came from, and a song's key. `hubItems` are the plan's Content Hub entries. */
export function describeEntries(segment, songs, hubItems = []) {
  return slotEntries(segment).map((entry, index) => {
    const hub = entry.contentHubId ? hubItems.find((h) => h.id === entry.contentHubId) : null;
    const originalKey = (entry.songId && songs.find((s) => s.id === entry.songId)?.key) || '';
    const keyTransposed = entry.songId ? entry.keyTransposed ?? '' : '';
    return {
      index,
      songId: entry.songId ?? null,
      contentHubId: entry.contentHubId ?? null,
      title: entry.songId ? titleOf(songs, entry.songId) : hub?.title ?? entry.title ?? entry.text ?? '',
      source: entry.songId ? 'list' : entry.contentHubId ? 'hub' : 'text',
      originalKey,
      keyTransposed,
      key: keyTransposed || originalKey,
      contentType: entry.contentType ?? '',
    };
  });
}

/** The fields an entry adds to a saved item. A Content Hub entry is sent by its current title; its words stay in the plan's Hub. */
function entryFields(entry, kind, slotId, hubItems) {
  const hubTitle = entry.contentHubId ? hubItems.find((h) => h.id === entry.contentHubId)?.title : undefined;
  const text = entry.songId ? undefined : (hubTitle ?? entry.text);
  const item = { slotId };
  if (entry.songId) item.songId = entry.songId;
  if (text) item.text = text.slice(0, 500);
  if (entry.songId && entry.keyTransposed) item.keyTransposed = entry.keyTransposed;
  if (entry.contentHubId) {
    item.contentHubId = entry.contentHubId;
    item.title = (hubTitle ?? entry.title ?? entry.text ?? '').slice(0, 200);
  } else if (entry.title) item.title = entry.title;
  if (entry.durationMinutes !== undefined) item.durationMinutes = entry.durationMinutes;
  if (entry.songId) item.contentType = 'song';
  else if (entry.contentHubId) item.contentType = 'hub_item';
  else if (kind === 'reading') {
    if (text && READING_TYPE_VALUES.includes(entry.contentType)) item.contentType = entry.contentType;
  } else if (text) item.contentType = 'text_note';
  return item;
}

/** A song names a song and a Content Hub entry is a spoken part, whatever the step was made for. Anything else keeps the step's kind. */
const entryKind = (entry, fallback) => (entry.songId ? 'song' : entry.contentHubId ? 'rite' : fallback);

/** The next key free for another item in a step: "s16.2", "s16.3" … */
function nextKey(base, used) {
  // A key is at most 20 characters on the server, so a long segment key gives up its last letters to the number. The item still names its step (slotId).
  const keyFor = (n) => `${base.slice(0, MAX_KEY - String(n).length - 1)}.${n}`;
  let n = 2;
  while (used.has(keyFor(n))) n += 1;
  const key = keyFor(n);
  used.add(key);
  return key;
}

/** The song's title, or a plain line when the chosen song is no longer in the church's list. Empty when nothing is chosen. */
export function titleOf(songs, songId) {
  if (!songId) return '';
  const song = songs.find((s) => s.id === songId);
  if (!song) return 'Song no longer in the list';
  return song.removed ? `${song.title} (removed)` : song.title;
}

/** The songs the picker offers: the step's category (or all of them), narrowed by the search text. */
export function songOptions(songs, { category = '', allSongs = false, query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return songs.filter(
    (song) => (allSongs || !category || song.category === category) && (!q || song.title.toLowerCase().includes(q)),
  );
}

const idOf = (row) => row.id ?? String(row.n);

/**
 * Turns a saved Holy Mass plan's items into the editor's state: the song or text for each row, the notes, and any items the editor does not
 * show (for example, items the laptop added that fill no row). `rows` are the editor's rows (massRows), or the template's steps.
 *
 * An item fills the slot its `slot` number names, which is how an item made on the laptop or saved by this editor finds its place. An item from
 * the website's earlier editor has no slot, only the step's key, and fills the slot that step stands for. A second item with content for a row
 * joins it in `more`; one with no content stays among the items the editor does not show. `meta` keeps each filled row's first key and kind.
 */
export function massFromItems(items, rows) {
  const segments = {};
  const notes = {};
  const meta = {};
  const extra = [];
  const rowOf = (item) =>
    (Number.isInteger(item.slot) ? rows.find((r) => r.slot === item.slot) : undefined) ??
    (item.slotId ? rows.find((r) => idOf(r) === item.slotId) : undefined) ??
    rows.find((r) => (r.legacyKey ?? (r.slot ? null : String(r.n))) === item.key);
  for (const item of items) {
    const row = rowOf(item);
    if (row && meta[idOf(row)]) {
      if (holdsContent(item)) {
        const id = idOf(row);
        const more = { ...pickEntry(item), ...(item.note ? { note: item.note } : {}), kind: item.kind };
        segments[id] = { ...segments[id], more: [...(segments[id]?.more ?? []), more] };
        continue;
      }
    }
    if (!row || meta[idOf(row)]) {
      extra.push(item);
      continue;
    }
    const id = idOf(row);
    const seg = pickEntry(item, ENTRY_FIELDS.filter((f) => f !== 'key'));
    if (Object.keys(seg).length) segments[id] = seg;
    if (item.note) notes[id] = item.note;
    meta[id] = { key: item.key, kind: item.kind, ...(Number.isInteger(item.slot) ? { slot: item.slot } : {}) };
  }
  return { segments, notes, extra, meta };
}

/**
 * The items the server takes, for a Holy Mass plan: one per row that has a choice or a note, in the editor's order, then the items the editor
 * does not show. A slot's item carries its number (1 to 28), so it keeps its place on the laptop and on every other pull. An item keeps the key
 * and kind it was read with; a new one gets "s7" for slot 7, or the step number for another step. The order is then renumbered from 1.
 */
export function massToItems({ segments, notes, extra, meta = {}, contentHubItems = [] }, rows) {
  const items = [];
  const used = new Set(extra.map((item) => item.key));
  for (const row of rows) {
    for (const entry of slotEntries(segments[idOf(row)])) if (entry.key) used.add(entry.key);
  }
  for (const row of rows) {
    const id = idOf(row);
    const entries = slotEntries(segments[id]);
    const note = (notes[id] ?? '').trim();
    if (entries.length === 0 && !note) continue;
    const was = meta[id] ?? {};
    const baseKey = row.slot ? `s${row.slot}` : String(row.n);
    const stepKind = row.kind === 'reading' ? 'reading' : row.kind === 'rite' || row.kind === 'slot-text' ? 'rite' : 'song';
    // A slot row names its own slot. An item that reached another row by its key keeps the slot it came with.
    const slot = row.slot ?? was.slot;
    (entries.length ? entries : [{}]).forEach((entry, index) => {
      const first = index === 0;
      // A further item that is typed or from the Hub is always a rite, so the laptop keeps it as a web note and never holds the plan.
      const kind = entryKind(entry, first ? (was.kind ?? stepKind) : (entry.kind ?? 'rite'));
      let key = entry.key ?? (first ? was.key ?? baseKey : undefined);
      if (!key) key = nextKey(baseKey, used);
      used.add(key);
      const item = { key, group: row.group, order: 0, kind, ...entryFields(entry, kind, id, contentHubItems) };
      if (first && note) item.note = note;
      else if (!first && entry.note) item.note = entry.note;
      if (slot) item.slot = slot;
      items.push(item);
    });
  }
  return withOrders([...items, ...extra]);
}

/** Turns a saved Praise & Worship plan's items into the editor's state, with the minutes of each segment. */
export function praiseFromItems(items, segs) {
  const known = new Set(segs.map((s) => s.id));
  // A laptop numbers a segment's songs ("5.1", "5.2"), and this editor numbers a further item the same way, so the number is not part of the segment.
  const segmentOf = (item) => {
    if (known.has(item.slotId)) return item.slotId;
    if (known.has(item.key)) return item.key;
    const base = String(item.key).replace(/(\.\d+)+$/, '');
    return known.has(base) ? base : null;
  };
  const segments = {};
  const notes = {};
  const extra = [];
  // The segments the saved plan has an item for. A card taken out of the lineup on the laptop has none, and is not sent back (praiseToItems).
  const present = new Set();
  const defaults = new Map(segs.filter((s) => s.defaultText).map((s) => [s.id, s.defaultText]));
  for (const saved of items) {
    const id = segmentOf(saved);
    if (id === null) {
      extra.push(saved);
      continue;
    }
    present.add(id);
    // A slot's own default (the reading the laptop fills it from) is how an empty slot is saved. It is not something chosen for it.
    const isDefault = defaults.has(id) && !saved.songId && !saved.contentHubId && saved.text === defaults.get(id);
    const item = isDefault ? { ...saved, text: undefined, contentType: undefined } : saved;
    if (holdsContent(segments[id]) && holdsContent(item)) {
      const more = { ...pickEntry(item), ...(item.note ? { note: item.note } : {}), kind: item.kind };
      segments[id] = { ...segments[id], more: [...(segments[id].more ?? []), more] };
      continue;
    }
    const seg = pickEntry(item, ENTRY_FIELDS.filter((f) => f !== 'key'));
    if (item.key !== id) seg.key = item.key;
    if (item.minutes !== undefined) seg.minutes = item.minutes;
    if (Object.keys(seg).length) segments[id] = { ...segments[id], ...seg };
    if (item.note && !notes[id]) notes[id] = item.note;
  }
  return { segments, notes, extra, present };
}

/** The items the server takes, for a Praise & Worship plan: every segment, with its minutes on its first item, then the items the editor does not show. */
export function praiseToItems({ segments, notes, extra, present, contentHubItems = [] }, segs) {
  const used = new Set(extra.map((item) => item.key));
  for (const seg of segs) for (const entry of slotEntries(segments[seg.id])) if (entry.key) used.add(entry.key);
  // A plan that came with items but none for a segment had that card taken out on the laptop. It stays out unless something is put in it here.
  const takenOut = (seg) => Boolean(present?.size) && !present.has(seg.id);
  const items = segs.flatMap((seg) => {
    const current = segments[seg.id] ?? {};
    const stepKind = seg.kind === 'reading' ? 'reading' : seg.kind === 'rite' ? 'rite' : 'song';
    const entries = slotEntries(current);
    if (entries.length === 0 && takenOut(seg) && current.minutes === undefined && !(notes[seg.id] ?? '').trim()) return [];
    // An empty slot goes with its default, so the laptop fills it as its own lineup does.
    const empty = seg.defaultText ? { text: seg.defaultText } : {};
    return (entries.length ? entries : [empty]).map((entry, index) => {
      const first = index === 0;
      const kind = entryKind(entry, first ? stepKind : (entry.kind ?? 'rite'));
      const key = entry.key ?? (first ? seg.id : nextKey(seg.id, used));
      used.add(key);
      const item = { key, group: seg.group, order: 0, kind, ...(first ? { minutes: current.minutes ?? seg.defaultMinutes } : {}), ...entryFields(entry, kind, seg.id, contentHubItems) };
      const note = first ? (notes[seg.id] ?? '').trim() : entry.note;
      if (note) item.note = note;
      return item;
    });
  });
  return withOrders([...items, ...extra]);
}

/** What a reading slot can hold. The slot keeps a short title or reference only; the words stay in the Content Hub on the laptop. */
export const CONTENT_TYPES = [
  { value: 'scripture', label: 'Scripture reading', icon: '📖' },
  { value: 'prayer', label: 'Prayer', icon: '🙏' },
  { value: 'announcement', label: 'Announcement', icon: '📢' },
];
const READING_TYPE_VALUES = CONTENT_TYPES.map((type) => type.value);

/** A reading's type. One saved without a type is a scripture reference, which is all a reading slot held before. */
export const contentTypeOf = (value) => CONTENT_TYPES.find((type) => type.value === value) ?? CONTENT_TYPES[0];

/** The tag a filled reading slot shows, for example "📖 Psalm 100:1-5". */
export const contentTag = (value, text) => (text ? `${contentTypeOf(value).icon} ${text}` : '');

/** Minutes as the page shows them: "45 min", or "1 h 17 min" from an hour up. */
export const durationLabel = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`);

/** One Praise & Worship segment as the page shows it: its minutes, what is chosen, the key it is sung in, and its note. */
export function praiseRow(seg, { segments, notes, contentHubItems = [] }, songs) {
  const current = segments[seg.id] ?? {};
  const originalKey = (current.songId && songs.find((song) => song.id === current.songId)?.key) || '';
  const keyTransposed = current.songId ? current.keyTransposed ?? '' : '';
  // `text` is what can be edited in place: typed words, never the title of a Content Hub entry.
  const text = current.contentHubId ? '' : current.text ?? '';
  const entries = describeEntries(current, songs, contentHubItems);
  return {
    ...seg,
    minutes: minutesOf(segments, seg),
    songId: current.songId ?? null,
    text,
    entries,
    value: entries.map((entry) => entry.title).join(' + '),
    note: notes[seg.id] ?? '',
    originalKey,
    keyTransposed,
    key: keyTransposed || originalKey,
    contentType: contentTypeOf(current.contentType).value,
    tag: seg.kind === 'reading' ? contentTag(current.contentType, text) : '',
  };
}

/**
 * Every number and check the Praise & Worship editor shows, worked out from the template and the choices so far. A section's `percent` is its
 * share of the target slot, so a bar moves with every minute and all three bars can be read against the same 90 minutes.
 */
export function praiseBreakdown(template, segs, state, songs) {
  const target = template.targetMinutes;
  const sections = template.sections.map((section, index) => {
    const group = sectionGroup(section, index);
    const rows = segs.filter((seg) => seg.group === group).map((seg) => praiseRow(seg, state, songs));
    const minutes = rows.reduce((sum, row) => sum + row.minutes, 0);
    return { group, title: section.title, rows, minutes, percent: Math.min(100, Math.round((minutes / target) * 100)) };
  });
  const rows = sections.flatMap((section) => section.rows);
  const total = rows.reduce((sum, row) => sum + row.minutes, 0);
  const songRows = rows.filter((row) => row.kind === 'song');
  const missing = rows.filter((row) => (row.kind === 'song' || row.kind === 'reading') && !row.value && !row.optional).map((row) => row.name);
  const over = total - target;
  // Only the earlier editor's template has a teaching step whose note names the speaker. The laptop's lineup has none, so no check.
  const speaker = Boolean((state.notes[template.speakerSegment] ?? '').trim());
  const checks = [
    {
      ok: missing.length === 0,
      text: missing.length === 0 ? 'Every required song and reading is set' : `${missing.length} step${missing.length === 1 ? '' : 's'} still need${missing.length === 1 ? 's' : ''} a song or reading`,
      sub: missing.slice(0, 3).join(', '),
    },
    {
      ok: over <= 0,
      text: over <= 0 ? `Fits the ${target} minute slot (${durationLabel(total)})` : `Runs ${over} min over the ${target} minute slot`,
      sub: '',
    },
    ...(template.speakerSegment
      ? [{
          ok: speaker,
          text: speaker ? 'Speaker is noted' : 'Speaker is not confirmed',
          sub: speaker ? '' : `Add a note on step ${template.speakerSegment}`,
        }]
      : []),
  ];
  return { sections, total, songsTotal: songRows.length, songsDone: songRows.filter((row) => row.value).length, checks };
}

/**
 * A saved plan read the way its editor reads it. `templates` is { mass, praise }: `praise` is the earlier Praise & Worship editor's
 * template, for the plans it laid out. Every other Praise & Worship plan is read as the laptop's lineup.
 */
function readPlan(plan, templates) {
  if (plan.kind === 'pw') {
    const rows = praiseSegments(praiseTemplateFor(plan.items, templates.praise));
    return { rows, filled: praiseFromItems(plan.items, rows), toItems: (state) => praiseToItems(state, rows) };
  }
  const rows = massRows(templates.mass);
  return { rows, filled: massFromItems(plan.items, rows), toItems: (state) => massToItems(state, rows) };
}

/** The steps of a saved plan that can hold a song: { id, row, filled, hasSong, matches }. `matches` is a step of the song's own category. */
export function songSteps(plan, templates, songId, category = '') {
  const { rows, filled } = readPlan(plan, templates);
  // A step is the song's own when it asks for the song's category by name, or for the picker category that name belongs to.
  const pill = pickerCategoryForName(serviceTypeOfPlanKind(plan.kind), category);
  const matches = (row) => Boolean(category) && (row.category === category || (Boolean(pill) && row.pickerCategory === pill));
  return rows.filter((row) => row.kind === 'song').map((row) => {
    const entries = slotEntries(filled.segments[idOf(row)]);
    return { id: idOf(row), row, filled: entries.length, hasSong: entries.some((entry) => entry.songId === songId), matches: matches(row) };
  });
}

/** The step to offer first: the song's own category, then an empty step, then any step that does not already hold the song. */
export function defaultSongStep(steps) {
  const open = steps.filter((step) => !step.hasSong);
  return open.find((step) => step.matches) ?? open.find((step) => step.filled === 0) ?? open[0] ?? null;
}

/**
 * The plan's items with one more song at the end of a step, built the way its editor builds them, so a song added from the Songs page is saved
 * exactly like one added in the plan. Null when the step cannot hold a song or already holds this one.
 */
export function itemsWithSong(plan, templates, stepId, songId) {
  const { rows, filled, toItems } = readPlan(plan, templates);
  if (!rows.some((row) => idOf(row) === stepId && row.kind === 'song')) return null;
  if (slotEntries(filled.segments[stepId]).some((entry) => entry.songId === songId)) return null;
  return toItems({ ...filled, segments: withEntry(filled.segments, stepId, { songId }), contentHubItems: plan.contentHubItems ?? [] });
}

/** The same items in a fresh order, 1 upward, so no two items share an order number. */
export function withOrders(items) {
  return items.map((item, index) => ({ ...item, order: index + 1 }));
}

/**
 * The body the plan-save route takes: the plan's id, the version the editor loaded, and the items. A Holy Mass plan also sends its details:
 * `language` (EN, TL or CEB) and `massTime` ("HH:MM", or null for none). Either planner can send the plan's `contentHubItems`. Details left out
 * are not sent, and the server keeps what it has.
 */
export function savePayload(plan, items, details = {}) {
  const payload = { id: plan.id, baseUpdatedAt: plan.updatedAt, items };
  if (details.language !== undefined) payload.language = details.language;
  if (details.massTime !== undefined) payload.massTime = details.massTime || null;
  if (details.contentHubItems !== undefined) payload.contentHubItems = details.contentHubItems;
  return payload;
}

/** The songs the editor can show: the picker's songs, plus any song the plan refers to that has since been removed. */
export function songsForEditor(pickerSongs, planSongs) {
  const listed = new Set(pickerSongs.map((s) => s.id));
  return [...pickerSongs, ...planSongs.filter((s) => s.removed && !listed.has(s.id))];
}

/** The Save plan button: disabled for the whole of a save, with a label that says so. */
export const saveButton = (saving) => ({ disabled: saving, label: saving ? 'Saving…' : 'Save plan' });

/** The status line: a failure's plain message first, then unsaved changes, otherwise saved. */
export function statusText({ dirty, error }) {
  if (error) return error;
  return dirty ? 'Unsaved changes' : 'Saved';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A plan's date (YYYY-MM-DD) as it reads on the page, for example "SUNDAY 1 NOVEMBER 2026". Fixed names, so no locale changes it. */
export function dateLabel(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`.toUpperCase();
}

/** The date as it reads in a list: "Sunday 1 November 2026". */
export const shortDate = (isoDate) => dateLabel(isoDate).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The editor a plan opens in, with its id in the address. A Praise & Worship plan (kind 'pw') opens the Praise editor; a Mass
 * plan, or one with no type recorded, opens the Mass editor.
 */
export function editorPathFor(plan) {
  const page = plan.kind === 'pw' ? 'praise' : 'mass';
  return `plan/${page}.html?id=${encodeURIComponent(plan.id)}`;
}

/** The plan-type tabs and how many plans each one holds. A plan with no type counts as a Mass plan, the editor it opens in. */
export function tabCounts(plans) {
  return {
    all: plans.length,
    mass: plans.filter((p) => p.kind !== 'pw').length,
    pw: plans.filter((p) => p.kind === 'pw').length,
  };
}

/** A day as YYYY-MM-DD on the reader's own calendar, not in UTC, so a plan does not turn Past hours before the day ends. */
export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whether a plan's date is 'upcoming' or 'past'. A plan dated today is still upcoming. Both are YYYY-MM-DD, so they compare as text. */
export const planTiming = (isoDate, today) => (isoDate >= today ? 'upcoming' : 'past');

/** The list's layout. Anything else, such as a blank or an old stored value, is the list. */
export const viewModeOf = (value) => (value === 'grid' ? 'grid' : 'list');

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
const SORTERS = {
  'date-desc': (a, b) => b.liturgical_date.localeCompare(a.liturgical_date) || byName(a, b),
  'updated-desc': (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || byName(a, b),
  'title-asc': byName,
};
export const DEFAULT_SORT = 'date-desc';

/** A sorted copy of the plans. An order this does not know is the default. */
export const sortPlans = (plans, order = DEFAULT_SORT) => [...plans].sort(SORTERS[order] ?? SORTERS[DEFAULT_SORT]);

const COPY_SUFFIX = ' (copy)';
const MAX_PLAN_NAME = 120;

/** The name of a copy, kept within the longest name a plan can have. */
export const copyName = (name) => `${name.slice(0, MAX_PLAN_NAME - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;

/** The plan-create body for a copy of a plan (as plan-get returns it) under a new id. A plan with no type copies as the Mass plan it opens as. */
export const duplicateRequest = (plan, id) => ({
  id,
  name: copyName(plan.name),
  date: plan.date,
  kind: plan.kind === 'pw' ? 'pw' : 'mass',
  items: plan.items,
  ...(plan.contentHubItems?.length ? { contentHubItems: plan.contentHubItems } : {}),
});

/**
 * The lines of a plan's setlist, in the editor's order: { label, title, key } for each place holding a song or typed text. `filled` is what
 * massFromItems or praiseFromItems returned for the plan, `rows` the same rows, and `songs` the songs plan-get sent. Notes are not included.
 */
export function setlistEntries({ segments, extra = [] }, rows, songs, nameOf = (row) => row.name) {
  const entry = (label, { songId, text, keyTransposed }) => {
    if (songId) return { label, title: titleOf(songs, songId), key: keyTransposed || (songs.find((s) => s.id === songId)?.key ?? '') };
    return text ? { label, title: text, key: '' } : null;
  };
  return [...rows.flatMap((row) => slotEntries(segments[idOf(row)]).map((e) => entry(nameOf(row), e))), ...extra.map((item) => entry('Also in this plan', item))].filter(Boolean);
}

/** The rows the list shows: the chosen tab, then the search text matched against the name. */
export function visiblePlans(plans, { tab = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return plans.filter(
    (p) => (tab === 'all' || (tab === 'pw' ? p.kind === 'pw' : p.kind !== 'pw')) && (!q || p.name.toLowerCase().includes(q)),
  );
}

/**
 * The editor's controls. Save and Discard need a plan that is open; Save also needs a planner's or an admin's role and no save
 * running. A plan a viewer has open shows the view-only note.
 */
export function editorControls({ plan, canEdit, saving }) {
  return {
    save: Boolean(plan) && Boolean(canEdit) && !saving,
    discard: Boolean(plan) && !saving,
    viewOnly: Boolean(plan) && !canEdit,
  };
}

/** Whether a user may create a plan: a planner or an admin. Viewers see no New plan button and cannot create. */
export const canCreatePlans = (role) => role === 'planner' || role === 'admin';

/**
 * Checks the New plan form before anything is sent: a name of 1 to 120 characters, a real date, and Holy Mass or Praise & Worship. Returns
 * the plain message for the first problem, or null.
 */
export function checkNewPlan({ name, date, kind } = {}) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') return 'Enter a name for the plan.';
  if (trimmed.length > 120) return 'A plan name can be up to 120 characters.';
  const day = String(date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return 'Choose a date for the plan.';
  if (kind !== 'mass' && kind !== 'pw') return 'Choose Holy Mass or Praise & Worship.';
  return null;
}

/**
 * The date a New plan shortcut picks, on the reader's calendar. 'today' is today. 'saturday' is the Saturday of this week, today when it is
 * Saturday. 'sunday' is the next Sunday after today, so on a Sunday it is a week away.
 */
export function dateShortcut(which, now = new Date()) {
  const weekday = now.getDay();
  const ahead = { today: 0, saturday: 6 - weekday, sunday: 7 - weekday }[which];
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead));
}

/** The name the New plan form suggests: "Sunday Holy Mass (15 Nov)" or "Praise & Worship Night (26 Oct)". With no date yet, the name without one. */
export function suggestPlanName({ kind, date } = {}) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!parts) return kind === 'pw' ? 'Praise & Worship Night' : 'Holy Mass';
  const [year, month, day] = parts.slice(1).map(Number);
  const when = `(${day} ${MONTHS[month - 1].slice(0, 3)})`;
  if (kind === 'pw') return `Praise & Worship Night ${when}`;
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} Holy Mass ${when}`;
}

/** The plan-create body for a new, empty plan. Language and Mass time belong to a Holy Mass plan; a time left unchosen is not sent. */
export const newPlanRequest = ({ name, date, kind, language, massTime }, id) => ({
  id,
  name: name.trim(),
  date,
  kind,
  items: [],
  ...(kind === 'mass' ? { language, ...(massTime ? { massTime } : {}) } : {}),
});
