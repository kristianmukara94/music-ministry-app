// The plan editor's rules, with no page and no network in them, so the editors and their tests use the same code. The steps and
// their structure come from the template. What is chosen, typed, timed and noted comes only from the saved plan on the server.
// The template's sample values are never used as data.

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 60;
export const VIEW_ONLY = 'View only. Ask a planner to make changes.';
export const NO_SONGS = 'No songs yet. Songs are added from the church laptop.';

/** The Mass steps from the template: number, name, kind, song category, and the hint. */
export function massSteps(template) {
  return template.sections.flatMap((section) =>
    section.rows.map(([n, name, kind, category, , , optional, hint]) => ({
      n,
      name,
      kind,
      category: category || '',
      optional: !!optional,
      hint: hint || '',
    })),
  );
}

/** The Praise & Worship segments from the template: id, name, kind, default minutes and hint. */
export function praiseSegments(template) {
  return template.sections.flatMap((section) =>
    section.rows.map(([id, name, kind, minutes, , hint]) => ({
      id,
      name,
      kind,
      defaultMinutes: minutes,
      hint: hint || '',
      optional: hint === 'Optional',
    })),
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

/** The song's title, or a plain line when the chosen song is no longer in the church's list. Empty when nothing is chosen. */
export function titleOf(songs, songId) {
  if (!songId) return '';
  const song = songs.find((s) => s.id === songId);
  return song ? song.title : 'Song no longer in the list';
}

/** The songs the picker offers: the step's category (or all of them), narrowed by the search text. */
export function songOptions(songs, { category = '', allSongs = false, query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return songs.filter(
    (song) => (allSongs || !category || song.category === category) && (!q || song.title.toLowerCase().includes(q)),
  );
}

/**
 * The whole plan in the shape the save route takes: every listed segment with its song, text and minutes (when it has any),
 * and the notes that have text. Empty segments are left out. `defaults` gives the minutes to send for segments that have none
 * of their own (Praise & Worship sends every segment's minutes).
 */
export function payloadFor({ planId, segments, notes }, segmentIds, defaults = {}) {
  const out = {};
  for (const id of segmentIds) {
    const current = segments[id] ?? {};
    const segment = {};
    if (current.songId) segment.songId = current.songId;
    if (current.text) segment.text = current.text;
    const minutes = current.minutes ?? defaults[id];
    if (minutes !== undefined) segment.minutes = minutes;
    if (Object.keys(segment).length) out[id] = segment;
  }
  const cleanNotes = {};
  for (const [id, note] of Object.entries(notes)) {
    if (note && note.trim() !== '') cleanNotes[id] = note.trim();
  }
  return { id: planId, segments: out, notes: cleanNotes };
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
