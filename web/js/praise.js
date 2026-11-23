// Praise & Worship editor, laid out as the church laptop's Praise & Worship planner: the Library on the left (Songs, Prayers, Scripture) and the LINEUP on
// the right, in sections with their minute totals and numbered segment rows. The segments are the laptop's own lineup (lineup-templates.js): the same
// twelve slots, keys and groups, so a plan fills the same slots on both. A segment can be added, taken out, renamed, moved and put in another section
// (praise-lineup.js); one added here is named on its first item and the laptop makes a card of that name. A plan the website's earlier editor laid out
// keeps that layout and cannot be restructured. Any segment takes any song from the church's list, a prayer by its title, a Scripture reference, typed text
// and Content Hub entries, and more than one of them. The minutes and what is chosen come from the saved plan on the server. Every value written into
// markup goes through esc(). Every segment also takes a note for the musicians and the operator and can be cleared in one press.
//
// The page is the Planner's Plan Editor tab: the Planner header sits above it, the title is edited in place, the badges show the date and how many
// segments are filled, and Duplicate Plan and Delete Plan sit beside Save.
import { PRAISE_PLAN } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';
import { guard, parishLine } from './auth.js';
import { getPlan, listSongs, savePlan, watchSongList } from './plan-api.js';
import { calendarHref, lastPlan, mountPlannerHeader, newPlanFlowHref, rememberPlan } from './planner-header.js';
import { deletePlanById, deleteWarning, duplicatePlanById } from './plan-actions.js';
import { usedHubIds } from './content-hub.js';
import { entryListHtml, hubButtonsHtml, openContentHub } from './slot-ui.js';
import { mountAppearanceButton, samePlanAppearance, sanitizePlanAppearance } from './plan-appearance-ui.js';
import { printLineupFromPlan, printSheet, sheetHtml } from './print-lineup-sheet.js';
import { ALL_CATEGORIES } from './lineup-templates.js';
import {
  PRAYER_CATALOG,
  buildScripture,
  prayerEntry,
  scriptureEntry,
  scriptureFromTyped,
  scripturePanelHtml,
  scripturePreview,
} from './prayer-scripture.js';
import {
  addSegmentFormHtml,
  librarySongs,
  lineupHeadHtml,
  pwActionBarHtml,
  pwEditPanelHtml,
  pwLineupHtml,
  pwPrayerCardsHtml,
  pwRowHtml,
  pwSearchHtml,
  pwSongCardsHtml,
  pwSongControlsHtml,
  pwTabOf,
  pwTabsHtml,
  pwTargetPillHtml,
} from './praise-workspace.js';
import {
  buildSegment,
  groupOrder,
  lineupFromPlan,
  templateFor,
  withSegmentAdded,
  withSegmentDropped,
  withSegmentMoved,
  withSegmentRenamed,
  withSegmentRestored,
  withoutSegment,
} from './praise-lineup.js';
import {
  MAX_MINUTES,
  MIN_MINUTES,
  PRAISE_TEMPLATE,
  VIEW_ONLY,
  dateLabel,
  durationLabel,
  praiseBreakdown,
  praiseFromItems,
  praiseRow,
  praiseSegments,
  praiseTemplateFor,
  praiseToItems,
  savePayload,
  setlistEntries,
  songsForEditor,
  saveButton,
  slotEntries,
  statusText,
  withChoice,
  withEntry,
  withEntryKey,
  withEntryMoved,
  withoutEntry,
  withoutEntries,
  checkPlanName,
  shortDate,
  editorPathFor,
} from './plan-model.js';

mountSidebar();

const ROOT = document.documentElement.dataset.base ?? '';
const header = { setSubtitle() {} };
const titleInput = document.getElementById('plan-title');
const planId = new URLSearchParams(location.search).get('id');
// The laptop's lineup, until a plan is loaded (see load). `SEGMENTS` is the lineup in the order it is shown; `REMOVED` the laptop segments the plan has taken out.
let TEMPLATE = PRAISE_TEMPLATE;
let SEGMENTS = praiseSegments(TEMPLATE);
let REMOVED = [];
// A plan the website's earlier editor laid out keeps its layout, which cannot be restructured.
let legacy = false;

let plan = null;
let canEdit = false;
let songs = [];
// The songs the saved plan refers to, removed ones included, so a fresh song list still names them.
let planSongs = [];
// A song saved on the church laptop while this plan is open shows here when the page is next looked at, without a reload.
const songWatch = watchSongList((list) => {
  if (!plan) return;
  songs = songsForEditor(list.songs, planSongs);
  renderKeepingField();
});
// The Library: the open tab, the song filters and the search.
const lib = { tab: 'songs', service: 'praise_worship', category: ALL_CATEGORIES, query: '' };
let state = fresh(null);

function fresh(saved) {
  return {
    segments: saved?.segments ?? {},
    notes: saved?.notes ?? {},
    extra: saved?.extra ?? [],
    // The segments the saved plan has an item for, so a card taken out on the laptop is not put back by a save here.
    present: saved?.present ?? new Set(),
    contentHubItems: structuredClone(plan?.contentHubItems ?? []),
    // The plan's own slide look (Plan Appearance), as it is being edited; saved with the plan.
    appearance: sanitizePlanAppearance(plan?.appearance),
    // The plan's title as it is being edited; saved with the plan.
    name: plan?.name ?? '',
    // The segment the Library adds to (the gold pill), and the segment whose panel is open.
    sel: SEGMENTS[0]?.id ?? null,
    open: null,
    // The highlighted Library card ("song:<id>" or "prayer:<id>"), which INSERT INTO SEGMENT and ADD SELECTED use.
    pick: '',
    // + Add segment's form, its draft and its plain refusal.
    addOpen: false,
    addDraft: { name: '', type: 'prayer', group: 'praise', minutes: 5 },
    addError: '',
    // The Scripture builder's draft, with the plain line for the last add that was refused.
    scripture: { book: '', chapter: '', verses: '', version: 'WEB', typed: '', title: '' },
    scriptureError: '',
    dirty: false,
    // Counts the changes made, so a change made while a save is running is not marked as saved.
    edits: 0,
    saving: false,
    error: '',
  };
}

const DISABLED = (ok) => (ok ? '' : 'disabled');
const structure = () => canEdit && !legacy;

const rowOf = (id) => {
  const seg = SEGMENTS.find((s) => s.id === id);
  return seg ? praiseRow(seg, state, songs) : null;
};
const compute = () => praiseBreakdown(TEMPLATE, SEGMENTS, state, songs);
const setlist = () => setlistEntries(state, SEGMENTS, songs);

function markEdited() {
  state.dirty = true;
  state.edits += 1;
  state.error = '';
}

function statusState() {
  if (state.error) return 'error';
  if (!plan) return 'idle';
  return state.dirty ? 'unsaved' : 'saved';
}

/** Replaces the lineup (the order, the sections, the segments) and keeps the template, the target and the open panel pointing at segments that exist. */
function setSegments(next) {
  SEGMENTS = next;
  if (!legacy) TEMPLATE = templateFor(SEGMENTS);
  if (!SEGMENTS.some((s) => s.id === state.sel)) state.sel = SEGMENTS[0]?.id ?? null;
  if (!SEGMENTS.some((s) => s.id === state.open)) state.open = null;
}

function renderHeader(view) {
  document.getElementById('eyebrow').textContent = plan ? `PRAISE & WORSHIP · ${dateLabel(plan.date)}` : 'PRAISE & WORSHIP';
  // The title is edited in place; it is not redrawn while it is being typed in.
  if (document.activeElement !== titleInput) titleInput.value = plan ? state.name : 'No plan open';
  titleInput.disabled = !plan || !canEdit;
  document.getElementById('date-badge').textContent = plan ? shortDate(plan.date) : '';
  const filled = SEGMENTS.filter((seg) => slotEntries(state.segments[seg.id]).length > 0).length;
  const fill = document.getElementById('fill-badge');
  fill.textContent = plan ? `${filled} / ${SEGMENTS.length} segments filled` : '';
  fill.classList.toggle('is-ready', Boolean(plan) && SEGMENTS.length > 0 && filled === SEGMENTS.length);
  document.getElementById('duplicate').disabled = !plan || !canEdit || state.saving;
  document.getElementById('delete').disabled = !plan || !canEdit || state.saving;
  header.setSubtitle(plan ? `${state.name || plan.name} · ${shortDate(plan.date)}` : 'Open a plan from a calendar to edit it.');
  document.title = `${plan ? state.name || plan.name : 'Praise & Worship'} · APCCMMA Web Planner`;
  document.getElementById('status').textContent = plan ? statusText({ dirty: state.dirty, error: state.error }) : state.error || 'Not loaded';
  document.getElementById('status-pill').dataset.state = statusState();
  document.getElementById('songs-label').textContent = `${view.songsDone} of ${view.songsTotal} chosen`;
  document.getElementById('total-label').textContent = durationLabel(view.total);
  const segments = view.sections.reduce((n, s) => n + s.rows.length, 0);
  document.getElementById('segments-label').textContent = `${segments} segments`;
  const save = saveButton(state.saving);
  const saveEl = document.getElementById('save');
  saveEl.disabled = !plan || !canEdit || save.disabled;
  saveEl.textContent = save.label;
  document.getElementById('discard').disabled = !plan || state.saving;
  document.getElementById('print').disabled = !plan;
  const lookButton = document.getElementById('plan-appearance');
  lookButton.disabled = !plan;
  if (plan) look.refresh();
  const note = document.getElementById('view-only');
  note.textContent = VIEW_ONLY;
  note.hidden = !plan || canEdit;
}

// ---- The Library ----

/** The target segment as the Library names it, or null. */
function targetOf() {
  const row = state.sel ? rowOf(state.sel) : null;
  return row ? { id: row.id, n: row.n, name: row.name } : null;
}

function libStatus(text) {
  document.getElementById('lib-status').textContent = text;
}

/** Makes `id` the segment the Library adds to. A song segment opens the Songs tab on its own category (Joyful Song on Joyful / Fast Praise). */
function targetSegment(id) {
  state.sel = id;
  const row = rowOf(id);
  if (row?.kind === 'song' && lib.tab === 'songs' && lib.service === 'praise_worship') lib.category = row.pickerCategory || ALL_CATEGORIES;
}

/** What the target segment already holds, so a card can say Added and a second press takes it out. */
function heldIn(id) {
  const entries = id ? slotEntries(state.segments[id]) : [];
  return {
    songs: new Set(entries.map((entry) => entry.songId).filter(Boolean)),
    prayers: new Set(entries.filter((entry) => entry.contentType === 'prayer').map((entry) => String(entry.text ?? '').trim().toLowerCase())),
  };
}

/** The library: its tabs, who it adds to, the search, the actions and the open tab's panel. */
function renderLibrary() {
  document.getElementById('lib-tabs').innerHTML = pwTabsHtml(lib.tab);
  document.getElementById('lib-target').innerHTML = plan ? pwTargetPillHtml(targetOf()) : '';
  const panel = document.getElementById('lib-panel');
  panel.setAttribute('aria-labelledby', `lib-tab-${lib.tab}`);
  const searchBox = document.getElementById('lib-search');
  const actions = document.getElementById('lib-actions');
  if (!plan) {
    searchBox.innerHTML = '';
    actions.innerHTML = '';
    panel.innerHTML = '';
    return;
  }
  const typing = document.activeElement?.dataset?.libSearch !== undefined;
  if (lib.tab === 'scripture') {
    searchBox.innerHTML = '';
    actions.innerHTML = '';
    panel.innerHTML = scripturePanelHtml({ draft: state.scripture, error: state.scriptureError, canEdit, newSegment: true });
    libStatus('');
    return;
  }
  searchBox.innerHTML = pwSearchHtml(lib.query, lib.tab);
  actions.innerHTML = pwActionBarHtml({ canEdit, hasPick: Boolean(state.pick), hasTarget: Boolean(state.sel) });
  panel.innerHTML = lib.tab === 'songs'
    ? `<div class="lp-lib-controls">${pwSongControlsHtml(lib, songs.filter((s) => !s.removed))}</div><div data-lib-list class="lp-lib-list"></div>`
    : `<p class="lp-lib-hint">A prayer is added by its title. The church laptop shows its own approved text for the Holy Mass parts it has; no prayer words are kept on the website.</p><div data-lib-list class="lp-lib-list"></div>`;
  refreshLibraryList();
  if (typing) {
    const box = searchBox.querySelector('[data-lib-search]');
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

/** Redraws only the cards, so typing in Search is never interrupted. */
function refreshLibraryList() {
  const box = document.querySelector('[data-lib-list]');
  if (!box) return;
  const held = heldIn(state.sel);
  if (lib.tab === 'songs') {
    const available = songs.filter((s) => !s.removed);
    const list = librarySongs(available, lib);
    box.innerHTML = pwSongCardsHtml(list, { picked: state.pick, held: held.songs, canEdit, songs: available });
    libStatus(available.length ? `${list.length} of ${available.length} song${available.length === 1 ? '' : 's'} shown` : '');
  } else {
    box.innerHTML = pwPrayerCardsHtml({ query: lib.query, picked: state.pick, held: held.prayers, canEdit });
    libStatus('');
  }
  const actions = document.getElementById('lib-actions');
  if (actions.firstElementChild) actions.innerHTML = pwActionBarHtml({ canEdit, hasPick: Boolean(state.pick), hasTarget: Boolean(state.sel) });
}

/** Puts one entry at the end of a segment, or takes it out when it is already there (`match` finds it). Returns whether it went in. */
function toggleEntry(id, entry, match) {
  const at = slotEntries(state.segments[id]).findIndex(match);
  state.segments = at >= 0 ? withoutEntry(state.segments, id, at) : withEntry(state.segments, id, entry);
  state.present.add(id);
  markEdited();
  return at < 0;
}

/** Brings a segment into view, on a phone where the lineup is above or below the Library. */
function showSegment(id) {
  const el = document.querySelector(`[data-seg="${CSS.escape(id)}"]`);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (!window.matchMedia('(min-width: 1024px)').matches || rect.top < 0 || rect.bottom > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** ADD on a song card: the target segment, or out of it again when it is already there. */
function addSong(songId, { quiet = false } = {}) {
  const song = songs.find((s) => s.id === songId);
  const target = state.sel && rowOf(state.sel);
  if (!song || !plan || !canEdit) return;
  if (!target) return libStatus('Click a segment first, then add.');
  const went = toggleEntry(target.id, { songId, contentType: 'song' }, (entry) => entry.songId === songId);
  libStatus(went ? `Added ${song.title} to ${target.name}.` : `Took ${song.title} out of ${target.name}.`);
  if (!quiet) render();
}

/** ADD on a prayer card: the target segment, as a title. */
function addPrayer(id) {
  const prayer = PRAYER_CATALOG.find((p) => p.id === id);
  const target = state.sel && rowOf(state.sel);
  if (!prayer || !plan || !canEdit) return;
  if (!target) return libStatus('Click a segment first, then add.');
  const went = toggleEntry(target.id, prayerEntry(prayer), (entry) => entry.contentType === 'prayer' && entry.text === prayer.title);
  libStatus(went ? `Added ${prayer.title} to ${target.name}.` : `Took ${prayer.title} out of ${target.name}.`);
  render();
}

/** The Scripture builder's reference, or the plain line why there is none. */
function scriptureDraft() {
  const draft = state.scripture;
  return draft.typed.trim() ? scriptureFromTyped(draft.typed, draft.version) : buildScripture(draft);
}

function refuseScripture(message) {
  state.scriptureError = message;
  for (const el of document.querySelectorAll('[data-sf-error]')) el.textContent = message;
}

/** INSERT INTO SEGMENT on the Scripture tab: the reference goes at the end of the target segment. */
function addScripture() {
  if (!canEdit || !state.sel) return refuseScripture('Click a segment first, then add.');
  const made = scriptureDraft();
  if (made.error) return refuseScripture(made.error);
  if (slotEntries(state.segments[state.sel]).some((entry) => entry.contentType === 'scripture' && entry.text === made.text)) return refuseScripture(`${made.text} is already in this segment.`);
  state.scriptureError = '';
  state.scripture = { ...state.scripture, chapter: '', verses: '', typed: '' };
  state.segments = withEntry(state.segments, state.sel, scriptureEntry(made.text));
  state.present.add(state.sel);
  markEdited();
  render();
}

/** A new segment of its own, in the target segment's section, holding `entry`. Returns the segment's id, or null with the reason shown. */
function addSegmentWith({ name, type, entry, minutes = 5, group = null }, refuse = libStatus) {
  if (!structure()) {
    refuse(legacy ? 'This plan uses an earlier layout, so segments cannot be added.' : 'You cannot change this plan.');
    return null;
  }
  const into = group || (state.sel && SEGMENTS.find((s) => s.id === state.sel)?.group) || 'praise';
  const built = buildSegment({ name, type, group: into, minutes }, SEGMENTS, plan ? plan.items.map((i) => i.key) : []);
  if (built.error) {
    refuse(built.error);
    return null;
  }
  setSegments(withSegmentAdded(SEGMENTS, built.seg));
  state.present.add(built.seg.id);
  if (entry) state.segments = withEntry(state.segments, built.seg.id, entry);
  state.sel = built.seg.id;
  markEdited();
  return built.seg.id;
}

/** ADD AS NEW SEGMENT on the Scripture tab. The title is the one typed, or the reference. */
function addScriptureAsSegment() {
  const made = scriptureDraft();
  if (made.error) return refuseScripture(made.error);
  const id = addSegmentWith({ name: state.scripture.title.trim() || made.text, type: 'scripture', entry: scriptureEntry(made.text) }, refuseScripture);
  if (!id) return;
  state.scriptureError = '';
  state.scripture = { ...state.scripture, chapter: '', verses: '', typed: '', title: '' };
  render();
  showSegment(id);
}

/** INSERT INTO SEGMENT: the highlighted card goes into the target segment. */
function insertPicked() {
  const [type, id] = String(state.pick).split(':');
  if (type === 'song') addSong(id);
  else if (type === 'prayer') addPrayer(id);
}

/** ADD SELECTED: the highlighted card becomes a segment of its own. */
function addSelected() {
  const [type, id] = String(state.pick).split(':');
  let made = null;
  if (type === 'song') {
    const song = songs.find((s) => s.id === id);
    if (song) made = { name: song.title, type: 'song', entry: { songId: song.id, contentType: 'song' } };
  } else if (type === 'prayer') {
    const prayer = PRAYER_CATALOG.find((p) => p.id === id);
    if (prayer) made = { name: prayer.title, type: 'prayer', entry: prayerEntry(prayer) };
  }
  if (!made) return libStatus('Pick a song or a prayer first.');
  const newId = addSegmentWith(made);
  if (!newId) return;
  libStatus(`Added a segment: ${made.name}.`);
  render();
  showSegment(newId);
}

// ---- The LINEUP ----

function renderLineup(view) {
  document.getElementById('lineup-head').innerHTML = lineupHeadHtml({ count: SEGMENTS.length, canEdit: structure(), open: state.addOpen });
  const form = document.getElementById('add-segment');
  form.hidden = !state.addOpen;
  if (state.addOpen && !form.contains(document.activeElement)) {
    form.innerHTML = addSegmentFormHtml({ draft: state.addDraft, groups: groupOrder(SEGMENTS), removed: REMOVED, error: state.addError, canEdit: structure() });
  } else if (!state.addOpen) form.innerHTML = '';
  document.getElementById('segments').innerHTML = pwLineupHtml(view.sections, (row, first, last) => {
    const open = state.open === row.id;
    const panelHtml = open
      ? pwEditPanelHtml(row, { canEdit, entriesHtml: entryListHtml(row.entries, row.id, canEdit), hubHtml: hubButtonsHtml(canEdit) })
      : '';
    return pwRowHtml(row, { active: state.sel === row.id, open, canEdit, structure: structure(), first, last, panelHtml });
  }) + extraHtml();
}

/** The items the laptop put in the plan that fill no segment here are kept and listed, so nothing is hidden. */
function extraHtml() {
  if (!state.extra.length) return '';
  const rows = state.extra.map((item) => `<li class="lp-pill"><span class="lp-pill-title">${esc(item.title || item.text || item.key)}</span></li>`).join('');
  return `<section class="pw-section pw-extra" aria-label="Also in this plan"><header class="pw-section-head"><h3 class="pw-section-title">Also in this plan</h3><span class="pw-section-min">${state.extra.length}</span></header><ul class="lp-pills">${rows}</ul><p class="lp-lib-hint">These came from the church laptop without a segment. They are kept, and sent back when you save.</p></section>`;
}

/** Updates the readiness panel in place, so the bar slides to its new length. */
function renderReadiness(view) {
  const okCount = view.checks.filter((c) => c.ok).length;
  const left = view.checks.length - okCount;
  document.getElementById('readiness-headline').textContent = left === 0 ? 'Ready to sync' : `${left} thing${left === 1 ? '' : 's'} to finish`;
  document.getElementById('readiness-fill').style.width = `${Math.round((okCount / view.checks.length) * 100)}%`;
  document.getElementById('readiness-checks').innerHTML = view.checks.map((c) => `
            <li class="pw-check${c.ok ? ' is-ok' : ''}"><span aria-hidden="true" class="pw-check-mark">${c.ok ? '✓' : '!'}</span><span><span class="sr-only">${c.ok ? 'Done: ' : 'To do: '}</span>${esc(c.text + (c.sub ? ` (${c.sub})` : ''))}</span></li>`).join('');
}

function render() {
  const view = compute();
  renderHeader(view);
  renderLibrary();
  renderLineup(view);
  renderReadiness(view);
}

/** Changes a segment's choice in this session. Nothing is saved until Save plan. */
function choose(id, patch) {
  state.segments = withChoice(state.segments, id, patch);
  state.present.add(id);
  markEdited();
}

/** Takes in what is typed in the open panel but not yet applied, so a save never leaves it behind. Returns whether anything changed. */
function applyOpenPanel() {
  if (!state.open) return false;
  const row = rowOf(state.open);
  if (!row) return false;
  let changed = false;
  const nameBox = document.querySelector('[data-role="panel-name"]');
  if (nameBox && row.custom && !nameBox.disabled && nameBox.value.trim() && nameBox.value.replace(/\s+/g, ' ').trim() !== row.name) {
    setSegments(withSegmentRenamed(SEGMENTS, row.id, nameBox.value));
    markEdited();
    changed = true;
  }
  const minutesBox = document.querySelector('[data-role="panel-minutes"]');
  if (minutesBox && minutesBox.value !== '') {
    const minutes = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(Number(minutesBox.value)) || row.minutes));
    if (minutes !== row.minutes) {
      choose(row.id, { minutes });
      changed = true;
    }
  }
  const textBox = document.querySelector('[data-role="panel-text"]');
  if (textBox && textBox.value.trim()) {
    state.segments = withEntry(state.segments, row.id, { text: textBox.value.trim() });
    textBox.value = '';
    state.present.add(row.id);
    markEdited();
    changed = true;
  }
  const noteBox = document.querySelector('[data-role="panel-note"]');
  if (noteBox && noteBox.value.trim() !== row.note) {
    state.notes[row.id] = noteBox.value.trim();
    state.present.add(row.id);
    markEdited();
    changed = true;
  }
  return changed;
}

function openHub(mode) {
  const row = rowOf(state.open);
  openContentHub({
    items: state.contentHubItems,
    slotName: row.name,
    mode,
    usedIds: () => usedHubIds(state.segments),
    onChange: (items) => {
      state.contentHubItems = items;
      markEdited();
      renderKeepingField();
    },
    onUse: (entry) => {
      state.segments = withEntry(state.segments, row.id, { contentHubId: entry.id, text: entry.title, contentType: 'hub_item' });
      state.present.add(row.id);
      markEdited();
      render();
    },
  });
}

/** Redraws the page, keeping the cursor in the panel field it was in. */
function renderKeepingField() {
  const role = document.activeElement?.dataset?.role;
  render();
  if (role) document.querySelector(`[data-role="${role}"]`)?.focus();
}

/** Reads the saved plan and the song list from the server. A failure keeps what was on screen and shows the plain message. */
async function load() {
  try {
    const [saved, list] = await Promise.all([getPlan(planId), listSongs()]);
    plan = saved.plan;
    canEdit = saved.canEdit;
    songs = songsForEditor(list.songs, saved.songs);
    planSongs = saved.songs;
    songWatch.seen(list);
    // A plan the earlier editor laid out opens in that layout; every other plan opens in the laptop's lineup, as it was saved.
    const template = praiseTemplateFor(plan.items, PRAISE_PLAN);
    legacy = template !== PRAISE_TEMPLATE;
    if (legacy) {
      TEMPLATE = template;
      SEGMENTS = praiseSegments(template);
      REMOVED = [];
    } else {
      const lineup = lineupFromPlan(plan.items, (songId) => songs.find((s) => s.id === songId)?.title ?? '');
      TEMPLATE = lineup.template;
      SEGMENTS = lineup.segs;
      REMOVED = lineup.removed;
    }
    state = fresh(praiseFromItems(plan.items, SEGMENTS));
    rememberPlan({ id: plan.id, kind: 'pw', name: plan.name, date: plan.date });
    mountHeader();
  } catch (err) {
    if (plan) state.error = err.message;
    else state = { ...fresh(null), error: err.message };
  }
  render();
}

async function save({ onlyIfChanged = false } = {}) {
  if (!plan || !canEdit || state.saving) return;
  const applied = applyOpenPanel();
  if (onlyIfChanged && !state.dirty) return;
  if (applied) renderKeepingField();
  const nameProblem = checkPlanName(state.name);
  if (nameProblem) {
    state.error = nameProblem;
    renderHeader(compute());
    titleInput.focus();
    return;
  }
  state.saving = true;
  state.error = '';
  const sent = state.edits;
  renderHeader(compute());
  try {
    const sentName = state.name;
    const response = await savePlan(savePayload(plan, praiseToItems(state, SEGMENTS), { name: sentName, contentHubItems: state.contentHubItems, appearance: state.appearance }));
    plan.updatedAt = response.savedAt;
    plan.appearance = response.appearance ?? state.appearance;
    plan.name = response.name ?? sentName.trim();
    if (state.name === sentName) state.name = plan.name;
    if (state.edits === sent) state.dirty = false;
    rememberPlan({ id: plan.id, kind: 'pw', name: plan.name, date: plan.date });
    mountHeader();
  } catch (err) {
    state.error = err.message;
  } finally {
    state.saving = false;
    renderHeader(compute());
  }
}

/** The lineup as it is on screen, unsaved changes included: the same plan the desktop prints, as the Print Lineup sheet. */
function currentLineup() {
  const items = praiseToItems(state, SEGMENTS);
  return printLineupFromPlan({ ...plan, name: state.name || plan.name, items, contentHubItems: state.contentHubItems }, songs, { church: parishLine() });
}

/** Fills the print-only sheet from what is on the page. Without a plan, the browser prints the page as it is. */
function prepareSetlist() {
  if (!plan) return;
  document.getElementById('setlist-print').innerHTML = sheetHtml(currentLineup());
  document.body.classList.add('is-printing-setlist');
  // The browser offers this as the name of the saved PDF.
  document.title = `Lineup - ${state.name || plan.name}`;
}

// The browser's own Print command gets the same sheet as the button.
window.addEventListener('beforeprint', prepareSetlist);
window.addEventListener('afterprint', () => {
  document.body.classList.remove('is-printing-setlist');
  document.title = `${state.name || plan?.name || 'Praise & Worship'} · APCCMMA Web Planner`;
  renderHeader(compute());
});

/** Deletes a segment from the lineup, after asking. A laptop segment taken out can be put back from + Add segment. */
function deleteSegment(id) {
  const row = rowOf(id);
  if (!row || !structure()) return;
  const holds = slotEntries(state.segments[id]).length > 0 || Boolean(state.notes[id]);
  if (!window.confirm(`Delete ${row.name}?${holds ? ' What it holds is taken out of this plan.' : ''}`)) return;
  const wasLaptop = !row.custom && praiseSegments(PRAISE_TEMPLATE).some((s) => s.id === id);
  if (wasLaptop && !REMOVED.some((s) => s.id === id)) REMOVED = [...REMOVED, praiseSegments(PRAISE_TEMPLATE).find((s) => s.id === id)];
  setSegments(withoutSegment(SEGMENTS, id));
  delete state.segments[id];
  delete state.notes[id];
  markEdited();
  render();
}

function moveSegment(id, delta) {
  if (!structure()) return;
  setSegments(withSegmentMoved(SEGMENTS, id, delta));
  markEdited();
  render();
  document.querySelector(`[data-seg-move="${CSS.escape(id)}"][data-delta="${delta}"]:not(:disabled), [data-seg-move="${CSS.escape(id)}"]:not(:disabled)`)?.focus();
}

document.querySelector('main').addEventListener('click', (event) => {
  const card = event.target.closest('[data-pw-pick]');
  const button = event.target.closest('button');
  // A click on a Library card (not its ADD button) highlights it for INSERT INTO SEGMENT and ADD SELECTED.
  if (card && !button) {
    state.pick = state.pick === card.dataset.pwPick ? '' : card.dataset.pwPick;
    refreshLibraryList();
    return;
  }
  if (!button || button.disabled) return;
  const d = button.dataset;
  if (d.libTab) {
    lib.tab = pwTabOf(d.libTab);
    lib.query = '';
    state.pick = '';
    renderLibrary();
    document.getElementById(`lib-tab-${lib.tab}`)?.focus();
  } else if (d.libService) {
    lib.service = d.libService;
    lib.category = ALL_CATEGORIES;
    renderLibrary();
  } else if (d.pwAddSong) {
    addSong(d.pwAddSong);
  } else if (d.pwAddPrayer) {
    addPrayer(d.pwAddPrayer);
  } else if (d.pwInsert !== undefined) {
    insertPicked();
  } else if (d.pwAddSelected !== undefined) {
    addSelected();
  } else if (d.sfVersion) {
    state.scripture.version = d.sfVersion;
    renderLibrary();
  } else if (d.addScripture !== undefined) {
    addScripture();
  } else if (d.addScriptureNew !== undefined) {
    addScriptureAsSegment();
  } else if (d.selectSeg) {
    targetSegment(d.selectSeg);
    render();
  } else if (d.segMove) {
    moveSegment(d.segMove, Number(d.delta));
  } else if (d.deleteSeg) {
    deleteSegment(d.deleteSeg);
  } else if (d.editSeg) {
    if (state.open === d.editSeg) applyOpenPanel();
    state.open = state.open === d.editSeg ? null : d.editSeg;
    targetSegment(d.editSeg);
    render();
  } else if (d.openAddSegment !== undefined) {
    state.addOpen = !state.addOpen;
    state.addError = '';
    render();
    if (state.addOpen) document.querySelector('[data-asf="name"]')?.focus();
  } else if (d.cancelSegment !== undefined) {
    state.addOpen = false;
    render();
  } else if (d.restoreSegment) {
    const back = REMOVED.find((s) => s.id === d.restoreSegment);
    if (back && structure()) {
      setSegments(withSegmentRestored(SEGMENTS, back.id));
      REMOVED = REMOVED.filter((s) => s.id !== back.id);
      state.present.add(back.id);
      state.sel = back.id;
      markEdited();
      render();
      showSegment(back.id);
    }
  } else if (d.hub) {
    openHub(d.hub);
  } else if (d.removeEntry !== undefined) {
    state.segments = withoutEntry(state.segments, d.for, Number(d.removeEntry));
    markEdited();
    render();
  } else if (d.moveEntry !== undefined) {
    const from = Number(d.moveEntry);
    const to = from + Number(d.delta);
    state.segments = withEntryMoved(state.segments, d.for, from, to);
    markEdited();
    render();
    document.querySelector(`[data-move-entry="${to}"][data-delta="${d.delta}"]:not(:disabled), [data-move-entry="${to}"]:not(:disabled)`)?.focus();
  } else if (d.clearSegment) {
    const id = d.clearSegment;
    if (!window.confirm(`Clear ${rowOf(id).name}? Its songs, text and note are taken out of this plan.`)) return;
    state.segments = withoutEntries(state.segments, id);
    delete state.notes[id];
    markEdited();
    render();
  } else if (d.useText || d.savePanel) {
    if (applyOpenPanel()) render();
  } else if (d.close) {
    applyOpenPanel();
    state.open = null;
    render();
  } else if (button.id === 'browse-library') {
    document.getElementById('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('[data-lib-search]')?.focus({ preventScroll: true });
  } else if (button.id === 'print') {
    if (plan) printSheet(currentLineup());
  } else if (button.id === 'discard') {
    if (!planId) return;
    if (state.dirty && !window.confirm('Discard your unsaved changes and go back to the saved plan?')) return;
    void load();
  } else if (button.id === 'save') {
    void save();
  } else if (button.id === 'duplicate') {
    void duplicate();
  } else if (button.id === 'delete') {
    askDelete();
  }
});

titleInput.addEventListener('input', () => {
  if (!plan || !canEdit) return;
  state.name = titleInput.value;
  markEdited();
  renderHeader(compute());
});
titleInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void save();
  } else if (event.key === 'Escape' && plan) {
    titleInput.value = plan.name;
    state.name = plan.name;
    markEdited();
    renderHeader(compute());
  }
});

// Leaving with unsaved changes asks first.
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

/** The Planner header, with Plan Editor on and this plan's title and date beneath "Planner". */
function mountHeader() {
  Object.assign(header, mountPlannerHeader(document.querySelector('[data-planner-header]'), {
    tab: 'editor',
    root: ROOT,
    editorPlan: plan ? { id: plan.id, kind: 'pw', name: plan.name, date: plan.date } : lastPlan(),
    canCreate: canEdit,
    newPlan: newPlanFlowHref({ kind: 'pw', date: plan?.date ?? '' }, ROOT),
  }));
  renderHeader(compute());
}

/** Duplicate Plan: a copy of the saved plan on the same day, opened in the editor. Unsaved changes here are not in the copy. */
async function duplicate() {
  if (!plan || !canEdit || state.saving) return;
  if (state.dirty && !window.confirm('Your unsaved changes are not in the copy. Duplicate the last saved version?')) return;
  const button = document.getElementById('duplicate');
  button.disabled = true;
  button.textContent = 'Copying…';
  try {
    const { created } = await duplicatePlanById(plan.id);
    state.dirty = false;
    location.assign(`${ROOT}${editorPathFor(created)}`);
  } catch (err) {
    state.error = err.message;
    button.textContent = 'Duplicate Plan';
    renderHeader(compute());
  }
}

const deleteDialog = document.getElementById('delete-dialog');
const deleteConfirm = document.getElementById('delete-confirm');
const deleteError = document.getElementById('delete-error');

function askDelete() {
  if (!plan || !canEdit) return;
  document.getElementById('delete-text').textContent = deleteWarning(state.name || plan.name);
  deleteError.textContent = '';
  deleteDialog.showModal();
}

document.getElementById('delete-cancel').addEventListener('click', () => deleteDialog.close());
deleteDialog.addEventListener('close', () => document.getElementById('delete')?.focus());
deleteConfirm.addEventListener('click', async () => {
  if (!plan || deleteConfirm.disabled) return;
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Deleting…';
  deleteError.textContent = '';
  try {
    await deletePlanById(plan.id);
    state.dirty = false;
    // Back to the Praise & Worship Calendar, on the month the plan was in.
    location.assign(calendarHref('pw', ROOT, plan.date.slice(0, 7)));
  } catch (err) {
    deleteError.textContent = err.message;
    deleteConfirm.disabled = false;
    deleteConfirm.textContent = 'Delete plan';
  }
});

// Typing in the Library's search or the Scripture builder redraws only the cards and the preview line, so what is being typed is never interrupted.
document.querySelector('main').addEventListener('input', (event) => {
  const el = event.target;
  if (el.dataset?.libSearch !== undefined) {
    lib.query = el.value;
    refreshLibraryList();
  } else if (el.dataset?.sf !== undefined) {
    state.scripture[el.dataset.sf] = el.value;
    const text = scripturePreview(state.scripture);
    for (const p of document.querySelectorAll('[data-sf-preview]')) {
      p.hidden = !text;
      p.innerHTML = text ? `Adds <strong>${esc(text)}</strong>` : '';
    }
    state.scriptureError = '';
    for (const p of document.querySelectorAll('[data-sf-error]')) p.textContent = '';
  } else if (el.dataset?.asf !== undefined) {
    state.addDraft[el.dataset.asf] = el.value;
    state.addError = '';
    for (const p of document.querySelectorAll('[data-asf-error]')) p.textContent = '';
  }
});

document.querySelector('main').addEventListener('change', (event) => {
  const el = event.target;
  if (el.dataset.role === 'entry-key') {
    state.segments = withEntryKey(state.segments, el.dataset.for, Number(el.dataset.index), el.value);
    markEdited();
    renderKeepingField();
  } else if (el.dataset.libCategory !== undefined) {
    lib.category = el.value;
    refreshLibraryList();
  } else if (el.dataset.role === 'panel-minutes' || el.dataset.role === 'panel-name') {
    if (applyOpenPanel()) renderKeepingField();
  }
});

// + Add segment: a title, what it holds, the section and the minutes.
document.querySelector('main').addEventListener('submit', (event) => {
  if (!event.target.matches('[data-add-segment-form]')) return;
  event.preventDefault();
  const draft = state.addDraft;
  const id = addSegmentWith({ name: draft.name, type: draft.type, group: draft.group, minutes: Number(draft.minutes) }, (message) => {
    state.addError = message;
    for (const p of document.querySelectorAll('[data-asf-error]')) p.textContent = message;
  });
  if (!id) return;
  state.addDraft = { name: '', type: draft.type, group: draft.group, minutes: draft.minutes };
  state.addOpen = false;
  render();
  showSegment(id);
});

// Drag a segment by its grip onto another segment to put it before or after that one.
let dragging = null;
const lineup = document.getElementById('segments');
lineup.addEventListener('dragstart', (event) => {
  const grip = event.target.closest?.('[data-drag-seg]');
  if (!grip || !structure()) return event.preventDefault();
  dragging = grip.dataset.dragSeg;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragging);
  const row = grip.closest('[data-seg]');
  if (row) event.dataTransfer.setDragImage(row, 16, 16);
  row?.classList.add('is-dragging');
});
lineup.addEventListener('dragover', (event) => {
  if (!dragging) return;
  const row = event.target.closest('[data-seg]');
  if (!row || row.dataset.seg === dragging) return;
  event.preventDefault();
  const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
  for (const el of lineup.querySelectorAll('.is-drop-before, .is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
  row.classList.add(after ? 'is-drop-after' : 'is-drop-before');
});
lineup.addEventListener('drop', (event) => {
  if (!dragging) return;
  const row = event.target.closest('[data-seg]');
  if (!row || row.dataset.seg === dragging) return;
  event.preventDefault();
  const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
  const moved = dragging;
  dragging = null;
  setSegments(withSegmentDropped(SEGMENTS, moved, row.dataset.seg, after));
  markEdited();
  render();
});
lineup.addEventListener('dragend', () => {
  dragging = null;
  for (const el of lineup.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after')) el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
});

// Ctrl + S, or Cmd + S on a Mac, from anywhere on the page. The browser's own Save page is always held back here. A plan with nothing new is not
// saved again, so a habitual press does not make a new version for the laptops to pull.
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key?.toLowerCase() !== 's') return;
  event.preventDefault();
  if (!event.repeat) void save({ onlyIfChanged: true });
});

// Plan Appearance: the button in the header opens the drawer; an applied look is a change like any other (Save plan, Ctrl+S, Discard changes).
const look = mountAppearanceButton(document.getElementById('plan-appearance'), {
  get: () => state.appearance,
  set: (next) => {
    if (samePlanAppearance(next, state.appearance)) return;
    state.appearance = next;
    markEdited();
    renderHeader(compute());
  },
  canEdit: () => canEdit,
});

const user = await guard();
if (user) {
  mountHeader();
  if (planId) await load();
  else render();
}
