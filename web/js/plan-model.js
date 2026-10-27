// The plan editor's rules, with no page and no network in them, so the editors and their tests use the same code. The steps and
// their structure come from the template. What is chosen, typed, timed and noted comes only from the saved plan on the server.
// The template's sample values are never used as data.

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

/** The Praise & Worship segments from the template: id, name, kind, default minutes and hint. */
export function praiseSegments(template) {
  return template.sections.flatMap((section, index) =>
    section.rows.map(([id, name, kind, minutes, , hint]) => ({
      id,
      name,
      kind,
      defaultMinutes: minutes,
      hint: hint || '',
      optional: hint === 'Optional',
      group: PRAISE_GROUPS[index],
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

/**
 * Turns a saved Mass plan's items into the editor's state: the song or text for each step, the notes, and any items the editor
 * does not show (for example, items the laptop added). Nothing here comes from the template's sample values.
 */
export function massFromItems(items, steps) {
  const known = new Set(steps.map((s) => String(s.n)));
  const segments = {};
  const notes = {};
  const extra = [];
  for (const item of items) {
    if (!known.has(item.key)) {
      extra.push(item);
      continue;
    }
    const seg = {};
    if (item.songId) seg.songId = item.songId;
    if (item.text) seg.text = item.text;
    if (Object.keys(seg).length) segments[item.key] = seg;
    if (item.note) notes[item.key] = item.note;
  }
  return { segments, notes, extra };
}

/**
 * The items the server takes, for a Mass plan: one per step that has a choice or a note, in step order, then the items the editor
 * does not show. The order is then renumbered from 1, so the two never clash.
 */
export function massToItems({ segments, notes, extra }, steps) {
  const items = [];
  for (const step of steps) {
    const key = String(step.n);
    const seg = segments[key] ?? {};
    const note = (notes[key] ?? '').trim();
    if (!seg.songId && !seg.text && !note) continue;
    const kind = step.kind === 'reading' ? 'reading' : step.kind === 'rite' ? 'rite' : 'song';
    const item = { key, group: step.group, order: 0, kind };
    if (seg.songId) item.songId = seg.songId;
    if (seg.text) item.text = seg.text;
    if (note) item.note = note;
    items.push(item);
  }
  return withOrders([...items, ...extra]);
}

/** Turns a saved Praise & Worship plan's items into the editor's state, with the minutes of each segment. */
export function praiseFromItems(items, segs) {
  const known = new Set(segs.map((s) => s.id));
  const segments = {};
  const notes = {};
  const extra = [];
  for (const item of items) {
    if (!known.has(item.key)) {
      extra.push(item);
      continue;
    }
    const seg = {};
    if (item.songId) seg.songId = item.songId;
    if (item.text) seg.text = item.text;
    if (item.minutes !== undefined) seg.minutes = item.minutes;
    if (Object.keys(seg).length) segments[item.key] = seg;
    if (item.note) notes[item.key] = item.note;
  }
  return { segments, notes, extra };
}

/** The items the server takes, for a Praise & Worship plan: every segment, with its minutes, then the items the editor does not show. */
export function praiseToItems({ segments, notes, extra }, segs) {
  const items = segs.map((seg, index) => {
    const current = segments[seg.id] ?? {};
    const kind = seg.kind === 'reading' ? 'reading' : seg.kind === 'rite' ? 'rite' : 'song';
    const item = { key: seg.id, group: seg.group, order: index + 1, kind, minutes: current.minutes ?? seg.defaultMinutes };
    if (current.songId) item.songId = current.songId;
    if (current.text) item.text = current.text;
    const note = (notes[seg.id] ?? '').trim();
    if (note) item.note = note;
    return item;
  });
  return withOrders([...items, ...extra]);
}

/** The same items in a fresh order, 1 upward, so no two items share an order number. */
export function withOrders(items) {
  return items.map((item, index) => ({ ...item, order: index + 1 }));
}

/** The body the plan-save route takes: the plan's id, the version the editor loaded, and the items. */
export function savePayload(plan, items) {
  return { id: plan.id, baseUpdatedAt: plan.updatedAt, items };
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

/** Whether a user may create a plan: a planner or an admin. Viewers see no New plan button and cannot create. */
export const canCreatePlans = (role) => role === 'planner' || role === 'admin';

/**
 * Checks the New plan form before anything is sent: a name of 1 to 120 characters, a real date, and Mass or Praise & Worship. Returns
 * the plain message for the first problem, or null.
 */
export function checkNewPlan({ name, date, kind } = {}) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') return 'Enter a name for the plan.';
  if (trimmed.length > 120) return 'A plan name can be up to 120 characters.';
  const day = String(date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return 'Choose a date for the plan.';
  if (kind !== 'mass' && kind !== 'pw') return 'Choose Mass or Praise & Worship.';
  return null;
}
