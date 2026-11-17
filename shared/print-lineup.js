// The printed lineup: a one-page handout for the musicians and the worship leader, built from a Holy Mass plan or a Praise & Worship
// session in exactly the order the Planner shows it. Pure, so the tests run it; shared/print-lineup-html.js typesets it as paper.
import { MASS_SECTIONS, additionalIn, indexOfSlot, slotById, slotsOfSection } from './mass-slots.js';
import { sectionTitle, slotLabel } from './mass-language.js';
import { applyTextCase } from './text-fit.js';
import { runtimeOf } from './pw.js';

/** How many copies go on one sheet: two side by side (the default, to save paper), or one across the full width. */
export const PRINT_LAYOUTS = ['double', 'single'];
export const DEFAULT_PRINT_LAYOUT = 'double';

/** A layout as one of PRINT_LAYOUTS; anything else is the default. */
export function printLayoutOf(value) {
  return PRINT_LAYOUTS.includes(value) ? value : DEFAULT_PRINT_LAYOUT;
}

/** The number of identical copies a layout puts on a sheet. */
export function copiesFor(layout) {
  return printLayoutOf(layout) === 'single' ? 1 : 2;
}

/** The paper a lineup prints on. A4 is the default; Letter and Legal (US / "long bond" offices) are the others. */
export const PAPER_SIZES = ['A4', 'Letter', 'Legal'];
export const DEFAULT_PAPER_SIZE = 'A4';

/** Each paper's portrait width and height, in mm. */
export const PAPER_MM = Object.freeze({
  A4: Object.freeze({ width: 210, height: 297 }),
  Letter: Object.freeze({ width: 215.9, height: 279.4 }),
  Legal: Object.freeze({ width: 215.9, height: 355.6 }),
});

/** A paper size as one of PAPER_SIZES (case-insensitive); anything else is A4. */
export function paperSizeOf(value) {
  const v = String(value ?? '').toLowerCase();
  return PAPER_SIZES.find((p) => p.toLowerCase() === v) ?? DEFAULT_PAPER_SIZE;
}

/** Key values that mean "no key was set": printed as nothing at all, never as an empty badge or a dash. */
const NO_KEY = new Set(['', 'none', 'n/a', 'na', '-', '--', '—', '–', 'null', 'undefined']);

/**
 * A song's musical key as it should print, or null when no key was set. A key is printed only when the operator entered one when adding or
 * editing the song: null, undefined, an empty string, "None", "-", "N/A" and the like all print nothing.
 */
export function songKeyLabel(key) {
  if (key == null) return null;
  const text = String(key).trim();
  return NO_KEY.has(text.toLowerCase()) ? null : text;
}

/** A plan item's kind on the handout. */
function kindOfModule(module) {
  if (module === 'lyrics') return 'song';
  if (module === 'notes') return 'prayer';
  if (module === 'lectionary' || module === 'bible') return 'reading';
  return 'other';
}

/**
 * A Holy Mass plan as a handout, in the Planner's order: each part of the Mass (Introductory Rites, Liturgy of the Word, …) with its filled
 * slots in slot order, each named and numbered as on screen, then the part's additional items in their order. Empty slots are left out, and so
 * is a part with nothing in it.
 *
 * `items` are the plan's rows as the Planner shows them (current song titles laid over). `songKey(item)` gives a song row's saved key, or
 * anything songKeyLabel reads as unset. `lang` is the plan's language ('en', 'tl', 'ceb'), for the part and slot names.
 */
export function massPrintLineup(items, { title = '', subtitle = '', lang = 'en', songKey = () => null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const itemOf = (row) => {
    const kind = kindOfModule(row.module);
    return { kind, title: String(row.label ?? ''), key: kind === 'song' ? songKeyLabel(songKey(row)) : null };
  };
  const sections = [];
  for (const section of MASS_SECTIONS) {
    const entries = [];
    for (const slot of slotsOfSection(section.id)) {
      const index = indexOfSlot(list, slot.id);
      if (index < 0) continue;
      const item = itemOf(list[index]);
      entries.push({ number: pad2(slot.position), name: slotLabel(slot, lang), kind: item.kind, minutes: null, writeIn: false, items: [item] });
    }
    for (const block of section.blocks) {
      for (const index of additionalIn(list, block)) {
        const row = list[index];
        // A row that names a slot the plan no longer knows still prints, under no slot name.
        const slot = slotById(row.slot);
        const item = itemOf(row);
        entries.push({ number: '', name: slot ? slotLabel(slot, lang) : '', kind: item.kind, minutes: null, writeIn: false, items: [item] });
      }
    }
    if (entries.length > 0) sections.push({ heading: sectionTitle(section, lang), minutes: null, entries });
  }
  return { type: 'mass', title, subtitle, minutes: null, sections };
}

/** The icon a Praise & Worship card prints with: its first item's kind, or a song for a title card that carries songs. */
function kindOfCard(content, items) {
  if (content.kind === 'song') return 'song';
  if (content.kind === 'prayer') return 'prayer';
  if (content.kind === 'lectionary') return 'reading';
  return items[0]?.kind ?? 'other';
}

const minutesOf = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * A Praise & Worship session as a handout, in the Lineup's order: each group with its cards in lineup order, numbered as the Lineup numbers
 * them (01, 02 …), and each card's items in the order the card plays them: its first item (a prayer or a reading; a title card adds nothing),
 * its songs in sung order, then its chain of prayers, readings and slides. A group with no cards is left out.
 *
 * `hymns` maps a song id to at least `{ title, musicalKey }`; a song not loaded is left out rather than printed as a number. `noteTitle(id)`
 * gives a prayer's title. `labels.pictures` names a slides item ("{n}" is the slide count).
 */
export function pwPrintLineup(session, { title = '', subtitle = '', hymns = {}, noteTitle = () => null, labels = {} } = {}) {
  const segments = Array.isArray(session?.segments) ? session.segments : [];
  const groups = Array.isArray(session?.groups) && session.groups.length ? session.groups : [{ key: null, name: '' }];
  const known = new Set(groups.map((g) => g.key));
  const prayer = (id) => (id == null ? null : { kind: 'prayer', title: String(noteTitle(id) ?? '').trim() || String(labels.prayer ?? 'Prayer'), key: null });
  const reading = (type) => ({ kind: 'reading', title: String(type ?? ''), key: null });
  const itemsOf = (segment) => {
    const c = segment.content ?? {};
    const out = [];
    if (c.kind === 'prayer') {
      const p = prayer(c.noteId);
      if (p) out.push(p);
    } else if (c.kind === 'lectionary') out.push(reading(c.readingType));
    for (const id of c.hymnIds ?? []) {
      const hymn = hymns?.[id];
      if (!hymn || typeof hymn.title !== 'string' || !hymn.title.trim()) continue;
      out.push({ kind: 'song', title: hymn.title, key: songKeyLabel(hymn.musicalKey ?? hymn.key) });
    }
    for (const item of c.more ?? []) {
      if (item.kind === 'prayer') {
        const p = prayer(item.noteId);
        if (p) out.push(p);
      } else if (item.kind === 'lectionary') out.push(reading(item.readingType));
      else if (item.kind === 'pictures') {
        const n = Array.isArray(item.slideIds) ? item.slideIds.length : 0;
        out.push({ kind: 'other', title: String(labels.pictures ?? 'Slides ({n})').replaceAll('{n}', String(n)), key: null });
      }
    }
    return out;
  };
  const sections = [];
  let total = 0;
  for (const group of groups) {
    const entries = [];
    let minutes = 0;
    segments.forEach((segment, index) => {
      // With no groups, or a card in a group that is gone, the card still prints: under the first group.
      const inGroup = group.key === null || segment.group === group.key || (group === groups[0] && !known.has(segment.group));
      if (!inGroup) return;
      const items = itemsOf(segment);
      // The card's runtime as the Lineup shows it: its own minutes plus each chained item's.
      const runtime = runtimeOf({ minutes: segment.minutes, content: segment.content ?? {} });
      minutes += runtime;
      const content = segment.content ?? {};
      // A song or prayer card with nothing chosen yet gets a line to write on; a title card is complete as it is.
      const writeIn = items.length === 0 && (content.kind === 'song' || content.kind === 'prayer');
      entries.push({ number: pad2(index + 1), name: String(segment.name ?? ''), kind: kindOfCard(content, items), minutes: minutesOf(runtime), writeIn, items });
    });
    total += minutes;
    if (entries.length > 0) sections.push({ heading: String(group.name ?? ''), minutes: minutesOf(minutes), entries });
  }
  return { type: 'pw', title, subtitle, minutes: minutesOf(total), sections };
}

/**
 * The handout with its words in the Planner's text case: the title, the part and group headings, the slot and card names, and every item's
 * title. A song's key is left as written ("Bb" and "F#m" mean something different in capitals).
 */
export function casePrintLineup(lineup, mode) {
  const c = (s) => applyTextCase(s, mode);
  return {
    ...lineup,
    title: c(lineup.title),
    subtitle: c(lineup.subtitle),
    sections: lineup.sections.map((section) => ({
      ...section,
      heading: c(section.heading),
      entries: section.entries.map((entry) => ({
        ...entry,
        name: c(entry.name),
        items: entry.items.map((item) => ({ ...item, title: c(item.title) })),
      })),
    })),
  };
}
