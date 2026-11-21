// The Holy Mass Plan Editor laid out as the church laptop's SERVICE PLANNING → Liturgical Plan: the readiness banner under the header, the
// song and resource library on the left (Songs, Notes & Cues, Templates), and on the right the control strip (Back to Calendar, the plan
// switcher, EN / TL / CEB / Other, PRINT LINEUP, TEMPLATES, the day's Holy Masses with the time popover, the progress and COLLAPSE ALL) above
// the four parts of the Holy Mass with their numbered slot rows.
//
// Pure markup builders and rules, so the tests run them without a browser; web/js/mass.js wires them to the page. The library lists song
// titles, categories, languages and keys only: lyrics, Bible text, announcements and media stay on the booth laptop. Every value written into
// markup goes through esc().
import { ALL_CATEGORIES, filterPickerSongs, pickerCategoryForName, pickerCategoryLabel, pickerPillsFor } from './lineup-templates.js';
import { MASS_SLOTS } from './mass-slots.js';
import { requiredSlotsFor } from './liturgical-calendar.js';
import { dateOfIso, sundayCycleOf, weekdayCycleOf } from './liturgical-day.js';
import { liturgicalDay } from './planner-calendar.js';
import { MAX_MASS_TIME, TIME_PRESETS, normalizeMassTime, scheduleLabel, sortMassSchedules, timeConflictText } from './holy-mass-schedule.js';
import { slotEntries, withoutEntries } from './plan-model.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LANGUAGE_CODE = { English: 'EN', Tagalog: 'TL', Cebuano: 'CEB' };
const lower = (value) => String(value ?? '').trim().toLowerCase();

// ---- The header ----

export const PAGE_TITLE = 'Liturgical Plan';
export const PAGE_SUBTITLE = 'Build the Holy Mass block by block. Load it to the Service Queue when it is ready.';

/** "11/07/2026" for "2026-11-07", as the laptop's plan switcher writes a date. '' for anything else. */
export function mdyDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
}

/** The header's right-hand actions: the saved state, Duplicate and Save plan (Ctrl + S). The page sets their text and state. */
export function headerActionsHtml() {
  return `
      <span class="lp-status" data-state="saved"><span class="lp-status-dot" aria-hidden="true"></span><span id="status" aria-live="polite"></span></span>
      <button id="duplicate" type="button" class="btn-quiet lp-head-btn">Duplicate</button>
      <button id="save" type="button" class="btn-primary lp-head-btn" title="Ctrl + S, or Cmd + S on a Mac" aria-keyshortcuts="Control+S Meta+S">Save plan</button>`;
}

// ---- What is filled ----

/** A slot id ('entrance') for a slot number, or null. */
const slotIdOf = (number) => MASS_SLOTS.find((slot) => slot.number === number)?.id ?? null;

/** Whether a row holds anything: a song, typed text, a Hub entry, or its note. The laptop and the calendar count a slot the same way. */
export const rowFilled = (row, segments, notes) => slotEntries(segments?.[row.id]).length > 0 || Boolean(String(notes?.[row.id] ?? '').trim());

/**
 * How ready the plan is for its date: songs chosen of the song slots, readings and spoken parts entered of theirs, and the slots the day
 * needs (requiredSlotsFor) that are still empty, in Holy Mass order. `nameOf(row)` names a row in the plan's language.
 */
export function readiness({ rows, segments, notes, date, nameOf = (row) => row.name }) {
  const slotRows = rows.filter((row) => row.slot);
  const filled = (row) => rowFilled(row, segments, notes);
  const songs = slotRows.filter((row) => row.kind === 'song');
  const texts = slotRows.filter((row) => row.kind !== 'song');
  const required = new Set(date ? requiredSlotsFor(date) : []);
  const needed = slotRows.filter((row) => required.has(slotIdOf(row.slot)));
  const missing = needed.filter((row) => !filled(row)).map((row) => ({ id: row.id, n: row.n, name: nameOf(row) }));
  return {
    songs: { done: songs.filter(filled).length, total: songs.length },
    texts: { done: texts.filter(filled).length, total: texts.length },
    slots: { done: slotRows.filter(filled).length, total: slotRows.length },
    needed: { done: needed.length - missing.length, total: needed.length },
    missing,
    ready: needed.length > 0 && missing.length === 0,
  };
}

/** The tinted banner under the header: green when every slot the day needs is filled, amber with what is still empty otherwise. */
export function readinessBannerHtml(ready, { dateText = '', max = 6 } = {}) {
  const counts = `Songs: ${ready.songs.done} of ${ready.songs.total} chosen · Readings/Notes: ${ready.texts.done} of ${ready.texts.total} entered`;
  let detail;
  if (ready.ready) {
    detail = 'Every slot this day needs is filled. Load it to the Service Queue on the church laptop when it is ready.';
  } else {
    const shown = ready.missing.slice(0, max).map((row) => `<button type="button" class="lp-banner-slot" data-jump-row="${esc(row.id)}">${esc(row.name)}</button>`);
    const more = ready.missing.length - shown.length;
    detail = `Still empty${dateText ? ` for ${esc(dateText)}` : ''} (${ready.missing.length} of ${ready.needed.total}): ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`;
  }
  return `
      <span class="lp-banner-icon" aria-hidden="true">${ready.ready ? '✓' : '!'}</span>
      <p class="lp-banner-text"><strong>${esc(counts)}</strong><span>${ready.ready ? esc(detail) : detail}</span></p>`;
}

/** How many items the plan holds across its rows: each song, typed text and Hub entry. */
export const itemCount = (rows, segments) => rows.reduce((sum, row) => sum + slotEntries(segments?.[row.id]).length, 0);

/** The control strip's subtitle: the liturgical day, its cycle and the item count ("… · Sunday Cycle A · 8 items"). */
export function stripSubtitle(date, items) {
  if (!date) return '';
  const day = liturgicalDay(date);
  const when = dateOfIso(date);
  const festive = day.rank === 'sunday' || day.rank === 'solemnity';
  const cycle = festive ? `Sunday Cycle ${sundayCycleOf(when)}` : `Weekday Cycle ${weekdayCycleOf(when)}`;
  return `${day.name} · ${cycle} · ${items} item${items === 1 ? '' : 's'}`;
}

// ---- The library ----

export const LIBRARY_TABS = [
  { id: 'songs', label: 'Songs' },
  { id: 'cues', label: 'Notes & Cues' },
  { id: 'templates', label: 'Templates' },
];
export const libraryTabOf = (value) => (LIBRARY_TABS.some((tab) => tab.id === value) ? value : 'songs');

/** The service filter: Holy Mass (the default), Praise & Worship, or every song. */
export const SERVICE_FILTERS = [
  { id: 'mass', label: 'Holy Mass' },
  { id: 'praise_worship', label: 'Praise & Worship' },
  { id: 'all', label: 'All' },
];
export const serviceFilterOf = (value) => (SERVICE_FILTERS.some((f) => f.id === value) ? value : 'mass');

/**
 * The SONG CATEGORY choices for a service filter: All categories, then the laptop's picker categories (Entrance, Kyrie, Gloria, Psalm …)
 * and the church's own categories, each with its count. Under All, the song categories as the church files them, by name.
 */
export function libraryCategories(songs, service) {
  if (service === 'all') {
    const names = new Map();
    for (const song of songs) {
      const name = String(song.category ?? '').trim();
      if (name && !names.has(lower(name))) names.set(lower(name), { id: name, label: name, count: 0 });
      if (name) names.get(lower(name)).count += 1;
    }
    const own = [...names.values()].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
    return [{ id: ALL_CATEGORIES, label: 'All categories', count: songs.length }, ...own];
  }
  return pickerPillsFor(songs, service).map((pill) => (pill.id === ALL_CATEGORIES ? { ...pill, label: 'All categories' } : pill));
}

/** The songs the library lists: the service filter's, in one category, matching the search by title, category or language. */
export function librarySongs(songs, { service = 'mass', category = ALL_CATEGORIES, query = '' } = {}) {
  const needle = lower(query);
  const inService = filterPickerSongs(songs, { serviceType: service === 'all' ? undefined : service, category });
  if (!needle) return inService;
  return inService.filter((song) => [song.title, song.category, song.language, LANGUAGE_CODE[song.language]].some((field) => lower(field).includes(needle)));
}

/** A song card's second line: its category as the picker names it, and its language ("Entrance · EN"). */
export function songMeta(song) {
  const id = pickerCategoryForName('mass', song.category) ?? pickerCategoryForName('praise_worship', song.category);
  const category = id ? (pickerCategoryForName('mass', song.category) ? pickerCategoryLabel('mass', id) : pickerCategoryLabel('praise_worship', id)) : song.category;
  return [category, LANGUAGE_CODE[song.language] ?? song.language, song.key ? `Key ${song.key}` : ''].filter(Boolean).join(' · ');
}

/**
 * The slot a library song goes into when + is pressed: the active target slot if there is one; otherwise the first empty song slot of the
 * song's own category (an Entrance song to the Entrance Hymn), then the first song slot of that category. Null when nothing fits: the
 * planner then picks a slot first.
 */
export function slotForSong(song, rows, segments, activeId = null) {
  if (activeId && rows.some((row) => row.id === activeId)) return activeId;
  const category = pickerCategoryForName('mass', song?.category);
  if (!category) return null;
  const matching = rows.filter((row) => row.slot && row.kind === 'song' && row.pickerCategory === category);
  return (matching.find((row) => slotEntries(segments?.[row.id]).length === 0) ?? matching[0])?.id ?? null;
}

/** The library's tab strip. */
export function libraryTabsHtml(active) {
  return LIBRARY_TABS.map((tab) => {
    const on = tab.id === active;
    return `<button type="button" role="tab" id="lib-tab-${tab.id}" aria-selected="${on}" aria-controls="lib-panel" tabindex="${on ? 0 : -1}" class="lp-lib-tab${on ? ' is-on' : ''}" data-lib-tab="${tab.id}">${esc(tab.label)}</button>`;
  }).join('');
}

/** Who + adds to: the active slot, or the slot each song's category picks. */
export function targetLineHtml(target) {
  return target
    ? `<span class="lp-target-label">Adding to</span><strong class="lp-target-name">${esc(`${target.n} · ${target.name}`)}</strong><button type="button" class="lp-target-clear" data-clear-target aria-label="Clear the target slot">×</button>`
    : '<span class="lp-target-label">No slot selected.</span><span class="lp-target-hint">+ puts a song in the slot of its category. Click a slot to choose it instead.</span>';
}

/** The Songs tab's controls: Search, Holy Mass / Praise & Worship / All, and SONG CATEGORY. */
export function songControlsHtml(view, songs) {
  const service = SERVICE_FILTERS.map((f) => {
    const on = f.id === view.service;
    return `<button type="button" class="lp-seg${on ? ' is-on' : ''}" data-lib-service="${f.id}" aria-pressed="${on}">${esc(f.label)}</button>`;
  }).join('');
  const options = libraryCategories(songs, view.service).map((c) =>
    `<option value="${esc(c.id)}"${c.id === view.category ? ' selected' : ''}>${esc(c.label)} (${c.count})</option>`).join('');
  return `
      <label class="lp-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" data-lib-search aria-label="Search songs by title, category or language" placeholder="Search" value="${esc(view.query)}" autocomplete="off">
      </label>
      <div class="lp-segs" role="group" aria-label="Service">${service}</div>
      <label class="lp-category"><span>Song category</span>
        <select data-lib-category>${options}</select>
      </label>`;
}

/** The song cards: title, "Entrance · EN", and + (✓ when the song is already in the target slot; pressing it then takes it out). */
export function songListHtml(list, { chosen = new Set(), canEdit = true, songs = list, hasTarget = false } = {}) {
  if (songs.length === 0) return '<p class="lp-empty">No songs yet. Songs are added on the church laptop and appear here after it syncs.</p>';
  if (list.length === 0) return '<p class="lp-empty">No songs match. Try All categories, another service, or clear the search.</p>';
  const lock = canEdit ? '' : ' disabled';
  return `<ul class="lp-songs">${list.map((song) => {
    const added = hasTarget && chosen.has(song.id);
    return `<li class="lp-song${added ? ' is-added' : ''}">
          <span class="lp-song-text"><strong>${esc(song.title)}</strong><span>${esc(songMeta(song))}</span></span>
          <button type="button" class="lp-song-add" data-lib-add="${esc(song.id)}" aria-pressed="${added}" aria-label="${added ? 'Remove' : 'Add'} ${esc(song.title)}" title="${added ? 'In the target slot. Press to take it out.' : 'Add to the target slot'}"${lock}>${added ? '✓' : '+'}</button>
        </li>`;
  }).join('')}</ul>`;
}

/** Quick musician cues and choir reminders, put on the target slot's note. Plain instructions, no liturgical texts. */
export const CUE_PRESETS = Object.freeze([
  'Choir only',
  'Congregation joins',
  'Cantor leads',
  'Instrumental intro',
  'Repeat the refrain',
  'Soft and slow',
  'Upbeat tempo',
  'Last verse a key higher',
  'Wait for the priest',
  'Read by the lector',
]);

export const MAX_NOTE = 1000;

/** A note with a cue added on its own line, unless it already has it. Kept within MAX_NOTE. */
export function withCue(note, cue) {
  const text = String(note ?? '').trim();
  const add = String(cue ?? '').trim();
  if (!add) return text;
  if (text.split('\n').some((line) => line.trim().toLowerCase() === add.toLowerCase())) return text;
  return (text ? `${text}\n${add}` : add).slice(0, MAX_NOTE);
}

/** The Notes & Cues tab: the cue chips, a typed cue, and the target it goes to. */
export function cuesPanelHtml({ target = null, canEdit = true } = {}) {
  const lock = canEdit && target ? '' : ' disabled';
  return `
      <p class="lp-lib-hint">${target ? `Cues are added to the note of <strong>${esc(`${target.n} · ${target.name}`)}</strong>. The operator sees them on the church laptop; they are not shown on the projector.` : 'Click a slot on the right first, then add a cue to its note.'}</p>
      <div class="lp-cues" role="group" aria-label="Quick cues">${CUE_PRESETS.map((cue) => `<button type="button" class="bc-chip" data-cue="${esc(cue)}"${lock}>${esc(cue)}</button>`).join('')}</div>
      <label class="lp-field"><span>Your own cue or reminder</span>
        <textarea id="lib-cue" rows="3" maxlength="${MAX_NOTE}" placeholder="e.g. Choir sings the second verse"${lock}></textarea>
      </label>
      <button type="button" class="btn-primary lp-lib-wide" data-action="add-cue"${lock}>Add to the slot note</button>`;
}

// ---- Templates ----

/** The slots the laptop's Weekday template says rather than sings (shared/mass-slots.js BUILT_IN_TEMPLATES 'weekday'), by slot number. */
export const WEEKDAY_SAID_SLOTS = Object.freeze([3, 9, 10, 12, 14]);
export const WEEKDAY_CUE = 'Said, not sung. Load its spoken text from the Holy Mass Order on the church laptop.';

/** The presets, as the laptop's TEMPLATES panel offers them, plus Clear All Slots. */
export const MASS_TEMPLATES = Object.freeze([
  { id: 'standard', label: 'Standard Sunday / Solemnity', description: 'Every slot empty, ready for this day’s songs and readings.' },
  { id: 'weekday', label: 'Weekday Holy Mass', description: 'The Kyrie, Sanctus, Memorial Acclamation, Our Father and Lamb of God marked as said, with a cue for the operator.' },
  { id: 'clear', label: 'Clear All Slots', description: 'Takes every song, text and note out of this plan.', danger: true },
]);

/**
 * What a template leaves in the plan: every row emptied (a row keeps its other fields) and no notes; the Weekday template then puts its cue
 * on the slots it says. The Content Hub entries stay with the plan.
 */
export function templateState(id, rows, segments) {
  let cleared = { ...(segments ?? {}) };
  for (const key of new Set([...Object.keys(cleared), ...rows.map((row) => row.id)])) cleared = withoutEntries(cleared, key);
  const notes = {};
  if (id === 'weekday') {
    for (const row of rows) if (row.slot && WEEKDAY_SAID_SLOTS.includes(row.slot)) notes[row.id] = WEEKDAY_CUE;
  }
  return { segments: cleared, notes };
}

/** The Templates tab: the presets, and Copy from another Holy Mass plan. */
export function templatesPanelHtml({ canEdit = true, otherPlans = [] } = {}) {
  const lock = canEdit ? '' : ' disabled';
  const presets = MASS_TEMPLATES.map((t) => `
        <li class="lp-template${t.danger ? ' is-danger' : ''}">
          <span><strong>${esc(t.label)}</strong><span>${esc(t.description)}</span></span>
          <button type="button" class="${t.danger ? 'btn-quiet is-danger' : 'btn-quiet'}" data-template="${t.id}"${lock}>${t.danger ? 'Clear' : 'Use'}</button>
        </li>`).join('');
  const sorted = sortMassSchedules(otherPlans, 'desc');
  const copy = sorted.length
    ? `<label class="lp-field"><span>Copy songs, text and notes from another Holy Mass</span>
          <select id="copy-from"${lock}>${sorted.map((p) => `<option value="${esc(p.id)}">${esc(planOptionLabel(p))}</option>`).join('')}</select>
        </label>
        <button type="button" class="btn-quiet lp-lib-wide" data-action="copy-plan"${lock}>Copy into this plan</button>`
    : '<p class="lp-lib-hint">No other Holy Mass plans to copy from yet.</p>';
  return `
      <p class="lp-lib-hint">A template replaces what this plan holds, after asking. Nothing is saved until Save plan.</p>
      <ul class="lp-templates">${presets}</ul>
      ${copy}`;
}

// ---- The control strip ----

/** A plan as the plan switcher lists it: "11/07/2026 · Sample Plan Title · 6:00 AM". */
export function planOptionLabel(plan) {
  const date = mdyDate(plan.liturgicalDate ?? plan.liturgical_date ?? plan.date);
  const time = normalizeMassTime(plan.massTime);
  return [date, plan.name, time].filter(Boolean).join(' · ');
}

/** The plan switcher's options: the church's Holy Mass plans, newest date first, this one selected (with its title as being edited). */
export function planSwitchOptionsHtml(plans, current) {
  const others = (plans ?? []).filter((p) => p.kind !== 'pw' && String(p.id) !== String(current.id));
  const list = sortMassSchedules([...others, current], 'desc');
  return list.map((p) => `<option value="${esc(p.id)}"${String(p.id) === String(current.id) ? ' selected' : ''}>${esc(planOptionLabel(p))}</option>`).join('');
}

/**
 * HOLY MASSES ON THIS DAY: a pill per Holy Mass in the order they are celebrated. The open one is a button that opens the time popover
 * (a link to the others), then Edit Time and + Add Time for planners.
 */
export function scheduleRowHtml(dayPlans, activeId, { pathOf, addHref = null, canEdit = true, popoverOpen = false } = {}) {
  const pills = dayPlans.map((plan) => {
    const on = String(plan.id) === String(activeId);
    const label = scheduleLabel(plan) || 'No time set';
    if (!on) return `<a class="bc-switch" href="${esc(pathOf(plan))}" title="${esc(plan.name)}">${esc(label)}</a>`;
    return canEdit
      ? `<button type="button" class="bc-switch is-on" aria-current="page" data-edit-time aria-expanded="${popoverOpen}" aria-controls="time-popover" title="Change the time of this Holy Mass">${esc(label)}</button>`
      : `<span class="bc-switch is-on" aria-current="page">${esc(label)}</span>`;
  });
  const edit = canEdit ? `<button type="button" class="lp-link-btn" data-edit-time aria-expanded="${popoverOpen}" aria-controls="time-popover">Edit Time</button>` : '';
  const add = addHref ? `<a class="bc-switch is-add" href="${esc(addHref)}"><span aria-hidden="true">+</span> Add Time</a>` : '';
  return `<span class="bc-switch-label">Holy Masses on this day</span>${pills.join('')}${edit}${add}`;
}

/** The time popover: the time box, the four quick chips, and the taken-time warning that holds Set time back. */
export function timePopoverHtml({ value = '', conflict = null } = {}) {
  const time = normalizeMassTime(value);
  const chips = TIME_PRESETS.map((preset) => `<button type="button" class="bc-chip" data-tp-preset="${esc(preset)}" aria-pressed="${time === preset}">${esc(preset)}</button>`).join('');
  return `
      <label class="bc-label" for="tp-time">Holy Mass time</label>
      <input id="tp-time" class="bc-input" data-tp-time type="text" maxlength="${MAX_MASS_TIME}" autocomplete="off" placeholder="e.g. 6:00 AM" value="${esc(value)}">
      <div class="bc-chips" role="group" aria-label="Quick times">${chips}</div>
      <p class="lp-popover-error" role="alert" data-tp-error>${conflict ? `${esc(timeConflictText(conflict))} Pick another time, or open it from the pills.` : ''}</p>
      <div class="lp-popover-actions">
        <button type="button" class="btn-quiet" data-tp="cancel">Cancel</button>
        <button type="button" class="btn-primary" data-tp="apply"${conflict ? ' disabled' : ''}>Set time</button>
      </div>`;
}

// ---- The slots ----

/** The add button's words: ADD HYMN / ITEM on a song slot, ADD ITEM on any other. */
export const addLabel = (row) => (row.kind === 'song' ? 'Add hymn / item' : 'Add item');

const ICON = { list: '♪', text: '✎', hub: '◆' };

/** A row's items as pills: ♪ for a song (with its key), ✎ typed text, ◆ a Hub entry; Move up / Move down when there is more than one; × removes. */
export function entryPillsHtml(entries, rowId, canEdit) {
  const lock = canEdit ? '' : ' disabled';
  return entries.map((entry, at) => {
    const moves = entries.length > 1 && canEdit
      ? `<button type="button" class="lp-pill-btn" data-move-entry="${entry.index}" data-delta="-1" data-for="${esc(rowId)}" aria-label="${esc(`Move up: ${entry.title}`)}"${at === 0 ? ' disabled' : ''}>↑</button><button type="button" class="lp-pill-btn" data-move-entry="${entry.index}" data-delta="1" data-for="${esc(rowId)}" aria-label="${esc(`Move down: ${entry.title}`)}"${at === entries.length - 1 ? ' disabled' : ''}>↓</button>`
      : '';
    const key = entry.songId && entry.key ? `<span class="lp-pill-key">${esc(entry.key)}</span>` : '';
    return `<li class="lp-pill is-${entry.source}"><span class="lp-pill-icon" aria-hidden="true">${ICON[entry.source] ?? '•'}</span><span class="lp-pill-title">${esc(entry.title)}</span>${key}${moves}<button type="button" class="lp-pill-btn is-remove" data-remove-entry="${entry.index}" data-for="${esc(rowId)}" aria-label="${esc(`Remove ${entry.title}`)}"${lock}>×</button></li>`;
  }).join('');
}

/**
 * One numbered slot row: the number and the slot's name (a button that makes it the active target slot), its items as pills with the
 * note as a cue badge, and + ADD HYMN / ITEM, which opens the quick-assign panel (`panelHtml`) inside the row.
 */
export function slotRowHtml(row, { active = false, open = false, flash = false, canEdit = true, note = '', panelHtml = '' } = {}) {
  const pills = entryPillsHtml(row.entries ?? [], row.id, canEdit);
  const cue = String(note ?? '').trim();
  const items = pills || cue
    ? `<ul class="lp-pills" aria-label="${esc(`In ${row.name}`)}">${pills}${cue ? `<li class="lp-cue" title="Slot note / musician cue"><span aria-hidden="true">✎</span><span class="sr-only">Note: </span>${esc(cue)}</li>` : ''}</ul>`
    : '';
  const english = row.english && row.english !== row.name ? `<span class="lp-slot-english">${esc(row.english)}</span>` : '';
  const number = row.slot ? row.n : '•';
  return `
          <div class="lp-slot${active ? ' is-active' : ''}${open ? ' is-open' : ''}${flash ? ' is-flash' : ''}" data-row="${esc(row.id)}"${row.slot ? ` data-slot="${row.slot}"` : ''}>
            <div class="lp-slot-main">
              <button type="button" class="lp-slot-label" data-select-row="${esc(row.id)}" aria-pressed="${active}" title="${active ? 'The target slot: library songs and cues go here' : 'Make this the target slot'}">
                <span class="lp-slot-num"><span class="sr-only">${row.slot ? 'Slot ' : 'Step '}</span>${number}</span>
                <span class="lp-slot-names"><span class="lp-slot-name">${esc(row.name)}</span>${english}</span>
              </button>
              <div class="lp-slot-items">${items}</div>
              <button type="button" class="lp-add" data-open-row="${esc(row.id)}" aria-expanded="${open}"${canEdit ? '' : ' disabled'}><span aria-hidden="true">+</span> ${esc(addLabel(row))}</button>
            </div>${open ? `
            <div class="lp-slot-panel" data-panel="${esc(row.id)}">${panelHtml}</div>` : ''}
          </div>`;
}

/** One of the four parts: its chevron and "1. INTRODUCTORY RITES", the "X of Y" badge, and its rows. */
export function sectionCardHtml(section, { title, open = true, filled = 0, total = 0, rowsHtml = '' } = {}) {
  return `
        <section class="lp-section${open ? '' : ' is-closed'}" data-section="${esc(section.group)}">
          <h2 class="lp-section-head">
            <button type="button" data-toggle="${esc(section.group)}" aria-expanded="${open}" aria-controls="section-${esc(section.group)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              <span>${section.number}. ${esc(title)}</span>
            </button>
            <span class="lp-section-count${total > 0 && filled === total ? ' is-done' : ''}">${filled} of ${total}</span>
          </h2>
          <div id="section-${esc(section.group)}" class="lp-section-body"${open ? '' : ' hidden'}>${rowsHtml}</div>
        </section>`;
}

/** COLLAPSE ALL while any part is open, EXPAND ALL once all are closed. */
export const collapseLabel = (collapsedCount, total) => (collapsedCount >= total ? 'Expand all' : 'Collapse all');

// ---- PRINT LINEUP ----

/**
 * The printable lineup, on white paper: every part with its numbered slots, each item's title and key, and the slot's cue. Titles only: no
 * lyrics or readings are on the web. `sections` are [{ title, rows: [{ n, name, entries, note }] }].
 */
export function printLineupHtml({ eyebrow = '', name = '', when = '', sections = [] }) {
  const body = sections.map((section) => {
    const rows = section.rows.map((row) => {
      const items = (row.entries ?? []).map((entry) => `${esc(entry.title)}${entry.songId && entry.key ? ` <em>(Key ${esc(entry.key)})</em>` : ''}`).join('<br>');
      return `<tr><td>${esc(row.n)}</td><td>${esc(row.name)}</td><td>${items || '—'}</td><td>${esc(row.note ?? '')}</td></tr>`;
    }).join('');
    return `<tr class="lineup-part"><th colspan="4" scope="colgroup">${esc(section.title)}</th></tr>${rows}`;
  }).join('');
  return `
    <p class="setlist-eyebrow">${esc(eyebrow)}</p>
    <h1>${esc(name)}</h1>
    <p class="setlist-when">${esc(when)}</p>
    <table>
      <thead><tr><th scope="col">#</th><th scope="col">Slot</th><th scope="col">Song or item</th><th scope="col">Cue</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}
