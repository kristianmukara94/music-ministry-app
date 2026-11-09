// Operator notes and projectable prayers, shared by the main process (validation) and the renderer.
import { sanitizeTextStyle } from './text-style.js';
import { splitFingerprint, stampSplit } from './prayer-split.js';
import { isSlotId } from './mass-slots.js';

/**
 * Where a note is shown. `operator` never leaves the operator's screens. `full` is a full-screen slide and
 * `lower` is a lower-third banner. Only the last two can be staged, taken live, or pushed to the queue.
 */
export const NOTE_DISPLAYS = ['operator', 'full', 'lower'];

/** Prayers and intentions the congregation prays. */
export const PRAYER_CATEGORIES = ['Special Intercession', 'Mass Intention', 'Oratio Imperata', 'Novena', 'Consecration', 'Community Prayer'];
/** The parish's own Mass Ordinary and Mass flow texts. The app ships none: the operator types the approved text. */
export const MASS_FLOW_CATEGORIES = ['Creed', 'Gloria', 'Kyrie', 'Sanctus', 'Agnus Dei', 'Eucharistic Preface', 'Holy Mass Response', 'Scripture Reading'];
/** Notices for the congregation. */
export const ANNOUNCEMENT_CATEGORIES = ['Pastoral Notice', 'Bulletin Update', 'Event Reminder', 'Emergency Notice'];
/** Private cues for the booth. A note in any category can be private too: these are the ones meant only for the booth. */
export const OPERATOR_CATEGORIES = ['Liturgical Cue', 'Presider Note', 'Choir / Booth Prompt'];

/**
 * Every category a note can be saved under. Stored names never change and new ones are only appended, so saved notes keep validating.
 * The category column has no CHECK constraint, so a new category needs no migration.
 */
export const NOTE_CATEGORIES = [
  'Mass Intention',
  'Oratio Imperata',
  'Special Intercession',
  'Novena',
  'Community Prayer',
  'Presider Note',
  'Liturgical Cue',
  'Choir / Booth Prompt',
  'Consecration',
  ...MASS_FLOW_CATEGORIES,
  ...ANNOUNCEMENT_CATEGORIES,
];

/** The Liturgical Content Hub's three sections. A note's section follows from its category. */
export const NOTE_SECTIONS = ['prayers', 'massFlow', 'announcements'];

/** The section each category is listed under. Booth cues go with the Mass flow they cue. */
const SECTION_OF = Object.fromEntries([
  ...PRAYER_CATEGORIES.map((c) => [c, 'prayers']),
  ...MASS_FLOW_CATEGORIES.map((c) => [c, 'massFlow']),
  ...ANNOUNCEMENT_CATEGORIES.map((c) => [c, 'announcements']),
  ...OPERATOR_CATEGORIES.map((c) => [c, 'massFlow']),
]);

/** The section a category belongs to. An unknown category falls back to prayers, so nothing goes missing from the Hub. */
export const sectionOfCategory = (category) => SECTION_OF[category] ?? 'prayers';

/**
 * The kinds of entry the creation form offers. The first three are projectable and pick the section; an operator note is private and can
 * take any category, so a booth reminder can sit beside the announcement or prayer it is about.
 */
export const NOTE_TYPES = ['prayer', 'massFlow', 'announcement', 'operator'];

const TYPE_CATEGORIES = {
  prayer: PRAYER_CATEGORIES,
  massFlow: MASS_FLOW_CATEGORIES,
  announcement: ANNOUNCEMENT_CATEGORIES,
  operator: [...OPERATOR_CATEGORIES, ...PRAYER_CATEGORIES, ...MASS_FLOW_CATEGORIES, ...ANNOUNCEMENT_CATEGORIES],
};

/** The categories the creation form offers for a type. */
export const categoriesForType = (type) => TYPE_CATEGORIES[type] ?? PRAYER_CATEGORIES;

const TYPE_OF_SECTION = { prayers: 'prayer', massFlow: 'massFlow', announcements: 'announcement' };

/** The type of a saved note: operator for a private note, otherwise the type of its category's section. */
export const typeOfNote = (note) => (note?.display === 'operator' ? 'operator' : TYPE_OF_SECTION[sectionOfCategory(note?.category)]);

/** The type the creation form starts on for a Hub section. */
export const typeOfSection = (section) => TYPE_OF_SECTION[section] ?? 'prayer';

/** What each category is called on screen, where that differs from the stored name. The stored name never changes, so saved notes keep working. */
const CATEGORY_LABELS = { 'Mass Intention': 'Holy Mass Intention' };

/** The name to show for a note category. */
export const noteCategoryLabel = (category) => CATEGORY_LABELS[category] ?? category;

export const MAX_NOTE_TITLE = 200;
export const MAX_NOTE_BODY = 4000;

/** Checks one note and returns the clean fields. Throws with a message the operator can act on. */
export function cleanNote(input = {}) {
  const title = String(input.title ?? '').trim();
  if (!title || title.length > MAX_NOTE_TITLE) throw new Error(`Title must be 1 to ${MAX_NOTE_TITLE} characters.`);
  const category = String(input.category ?? '');
  if (!NOTE_CATEGORIES.includes(category)) throw new Error('Choose a category for this note.');
  const display = String(input.display ?? '');
  if (!NOTE_DISPLAYS.includes(display)) throw new Error('Choose where this note is shown.');
  const body = String(input.body ?? '');
  if (body.length > MAX_NOTE_BODY) throw new Error(`The body must be at most ${MAX_NOTE_BODY} characters.`);
  // A split is checked against the body it was placed in, so a stored break never points past the text.
  const clean = { title, category, body, display, style: sanitizeTextStyle(input.style), split: stampSplit(input.split, body) };
  // The Holy Mass slot a note was made for. Left out, a save keeps the slot the note already has; null (or anything that is not a slot) unlinks it.
  if (input.slot !== undefined) clean.slot = isSlotId(input.slot) ? input.slot : null;
  return clean;
}

/** A line that is only a slide break: three or more dashes, with nothing else on it. */
const DIVIDER = /^\s*-{3,}\s*$/;

/**
 * Text typed with `---` lines between its slides, as the note it becomes: the body without the divider lines, and the manual split that puts a
 * slide break where each divider was (see shared/prayer-split.js). A divider at the start or end, or two in a row, makes no empty slide.
 * Text with no divider has no split, so it shows as one slide. Returns { body, split }.
 */
export function dividedNote(text) {
  const kept = [];
  const at = [];
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!DIVIDER.test(line)) {
      kept.push(line);
      continue;
    }
    // The break follows the last line with text before the divider, so blank lines around a divider never make a slide of their own.
    let last = kept.length - 1;
    while (last >= 0 && !kept[last].trim()) last -= 1;
    if (last >= 0 && !at.includes(last)) at.push(last);
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  let lead = 0;
  while (lead < kept.length && !kept[lead].trim()) lead += 1;
  const lines = kept.slice(lead);
  // A break after the last line would make an empty slide.
  const breaks = at.map((k) => k - lead).filter((k) => k >= 0 && k < lines.length - 1);
  return { body: lines.join('\n'), split: breaks.length > 0 ? { mode: 'manual', at: breaks } : null };
}

/**
 * The inverse of dividedNote: a saved note's text with a `---` line after each manual slide break, so the editor shows the breaks the way
 * they are typed. An automatic split, no split, or a split made for an earlier version of the text gives the text as it is.
 */
export function dividedText(body, split) {
  const text = String(body ?? '');
  if (!split || split.mode !== 'manual' || !Array.isArray(split.at) || split.at.length === 0) return text;
  if (typeof split.of === 'string' && split.of !== splitFingerprint(text)) return text;
  const lines = text.split('\n');
  const breaks = new Set(split.at.filter((k) => Number.isInteger(k) && k >= 0 && k < lines.length - 1));
  return lines.flatMap((line, k) => (breaks.has(k) ? [line, '---'] : [line])).join('\n');
}

/**
 * A Holy Mass plan row that plays a note names it by `sourceId`: the note's id alone plays every slide, and `<id>:<slides>` plays only the
 * slides listed (0-based, in ranges: "12:1-2,5" is slides 2, 3 and 6 of note 12). The selection rides in the row's source id the way a deck
 * slice does for announcements, so a plan needs no extra column for it.
 */
export function noteSourceId(id, slides = null) {
  const list = [...new Set((slides ?? []).filter((k) => Number.isInteger(k) && k >= 0))].sort((a, b) => a - b);
  if (list.length === 0) return String(id);
  const ranges = [];
  for (const k of list) {
    const last = ranges[ranges.length - 1];
    if (last && k === last[1] + 1) last[1] = k;
    else ranges.push([k, k]);
  }
  return `${id}:${ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')}`;
}

/** The note a plan row's source id names, and the slides it plays (null: every slide). Null for a source id that names no note. */
export function noteSource(sourceId) {
  const match = /^(\d+)(?::([\d,-]+))?$/.exec(String(sourceId ?? '').trim());
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (!match[2]) return { id, slides: null };
  const slides = new Set();
  for (const part of match[2].split(',')) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!range) return null;
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    // A range is capped, so a hand-edited id cannot make a huge list.
    if (to < from || to - from > 500) return null;
    for (let k = from; k <= to; k += 1) slides.add(k);
  }
  return { id, slides: [...slides].sort((a, b) => a - b) };
}

/**
 * The slides of `pages` a row plays: the ones at `slides`, in order. Every slide when `slides` is null, and also when none of them is
 * there any more (the note was shortened after the row was put in), so the row still plays the prayer rather than nothing.
 */
export function pickSlides(pages, slides) {
  if (!slides) return pages;
  const kept = slides.filter((k) => k < pages.length).map((k) => pages[k]);
  return kept.length > 0 ? kept : pages;
}
