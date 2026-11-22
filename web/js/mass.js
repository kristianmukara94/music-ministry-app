// Holy Mass plan editor, laid out as the church laptop's SERVICE PLANNING → Liturgical Plan: the readiness banner under the header, the song
// and resource library on the left, and on the right the control strip above the four parts of the Holy Mass with their numbered slots. The
// markup and the rules are in mass-workspace.js; this file keeps the plan's state and wires the page.
//
// The structure comes from mass-slots.js. What is chosen, typed and noted comes from the saved plan on the server, and Save plan (or Ctrl + S)
// sends the whole plan in one request, exactly as before. Any slot can hold songs from the church's list, typed text and Content Hub entries,
// more than one of them, and a note for the musicians and the operator. A slot clicked becomes the active target: + on a library song puts the
// song there (with no target, in the slot of the song's own category). + ADD HYMN / ITEM opens the quick-assign panel inside the slot.
//
// The library shows song titles, categories, languages and keys. Lyrics, Bible text, announcements and media stay on the booth laptop.
import { MASS_PLAN } from './sample-data.js';
import { MASS_LANGUAGES, languageName, massLanguageOf, sectionName, slotName } from './mass-language.js';
import { isScheduleLanguage, normalizeMassLanguage, scheduleLanguageForPlan, schedulesOn } from './holy-mass-schedule.js';
import { asSchedulePlan, conflictIn, onOpenExisting, openExistingHref, showConflict } from './schedule-ui.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { getPlan, listPlans, listSongs, savePlan, watchSongList } from './plan-api.js';
import { calendarHref, lastPlan, mountPlannerHeader, newPlanFlowHref, rememberPlan } from './planner-header.js';
import { massProgress } from './planner-calendar.js';
import { deletePlanById, deleteWarning, duplicatePlanById } from './plan-actions.js';
import { usedHubIds } from './content-hub.js';
import { entryListHtml, hubButtonsHtml, openContentHub } from './slot-ui.js';
import { mountSongPicker, resetSongPickers } from './song-picker.js';
import { READING_SLOT_NUMBER, dayReadingsFor, readingStatus, withDayReadings, withReading } from './day-readings.js';
import {
  PAGE_SUBTITLE,
  PAGE_TITLE,
  collapseLabel,
  cuesPanelHtml,
  headerActionsHtml,
  itemCount,
  libraryTabOf,
  lectionaryPanelHtml,
  libraryTabsHtml,
  librarySongs,
  mdyDate,
  planSwitchOptionsHtml,
  printLineupHtml,
  readiness,
  readinessBannerHtml,
  rowFilled,
  scheduleRowHtml,
  sectionCardHtml,
  serviceFilterOf,
  slotForSong,
  slotRowHtml,
  songControlsHtml,
  songListHtml,
  stripSubtitle,
  targetLineHtml,
  templateState,
  templatesPanelHtml,
  timePopoverHtml,
  withCue,
  MASS_TEMPLATES,
} from './mass-workspace.js';
import {
  describeEntries,
  VIEW_ONLY,
  dateLabel,
  massSections,
  massFromItems,
  massToItems,
  savePayload,
  songsForEditor,
  saveButton,
  slotEntries,
  statusText,
  withEntry,
  withEntryKey,
  withEntryMoved,
  withoutEntry,
  withoutEntries,
  editorPathFor,
  checkPlanName,
  shortDate,
} from './plan-model.js';

mountSidebar();

const ROOT = document.documentElement.dataset.base ?? '';
const titleInput = document.getElementById('plan-title');
const planId = new URLSearchParams(location.search).get('id');
const SECTIONS = massSections(MASS_PLAN);
const ROWS = SECTIONS.flatMap((section) => section.rows);
const WIDE = '(min-width: 1024px)';

// The sections the planner has closed, and the library tab, kept in this browser between visits. A blocked store starts with every section
// open and the Songs tab.
const COLLAPSED_KEY = 'apcc.web.holyMassCollapsed';
const LIBRARY_TAB_KEY = 'apcc.web.holyMassLibraryTab';
function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept.
  }
}
function readCollapsed() {
  const parsed = readStored(COLLAPSED_KEY, []);
  return Array.isArray(parsed) ? parsed.filter((g) => SECTIONS.some((section) => section.group === g)) : [];
}
function writeCollapsed(groups) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(groups));
  } catch {
    // Not kept.
  }
}

let plan = null;
let canEdit = false;
let songs = [];
// The church's song list as last read, and the songs the saved plan refers to (removed ones included), so a fresh list still names them.
let listed = [];
let planSongs = [];
// A song saved on the church laptop while this plan is open shows here when the page is next looked at, without a reload.
const songWatch = watchSongList((list) => {
  if (!plan) return;
  listed = list.songs;
  songs = songsForEditor(list.songs, planSongs);
  renderSteps();
  renderLibrary();
});
let collapsed = readCollapsed();
let state = fresh(null);
// The church's other Holy Mass plans on this plan's day (for the switcher and the taken-time warning), and all of its Holy Mass plans (for
// the plan switcher and Copy from another Holy Mass).
let dayPlans = [];
let massPlans = [];
// The library: its tab, the service filter, the song category and the search.
// `date` is the Lectionary tab's date (null: the plan's own) and `lq` its search.
const lib = { tab: libraryTabOf(readStored(LIBRARY_TAB_KEY, 'songs')), service: 'mass', category: 'all', query: '', date: null, lq: '' };

function fresh(saved) {
  return {
    // The active target slot (library songs and cues go here), and the slot whose quick-assign panel is open.
    sel: null,
    open: null,
    mode: 'list',
    flash: null,
    segments: saved?.segments ?? {},
    notes: saved?.notes ?? {},
    extra: saved?.extra ?? [],
    meta: saved?.meta ?? {},
    contentHubItems: structuredClone(plan?.contentHubItems ?? []),
    // The language its readings and responses are in (EN, TL, CEB), and its Holy Mass schedule as the laptop keeps it: the time as typed
    // ("6:00 AM") and the schedule language ('English', 'Cebuano', 'Tagalog' or the parish's own), '' for none.
    language: massLanguageOf(saved?.language),
    // The plan's title as it is being edited; saved with the plan.
    name: saved?.name ?? plan?.name ?? '',
    massTime: saved?.massTime ?? '',
    massLanguage: saved?.massLanguage ?? '',
    otherOpen: false,
    popover: { open: false, value: '' },
    dirty: false,
    noteSaved: false,
    saving: false,
    error: '',
  };
}

/** A row with what is chosen for it in the saved plan. Nothing comes from the template's sample values. */
function stepOf(id) {
  const base = ROWS.find((r) => r.id === id);
  const entries = describeEntries(state.segments[id], songs, state.contentHubItems);
  return {
    ...base,
    // The slot's name in the plan's language; `english` is its English name, shown beneath when the two differ.
    name: slotName(base, state.language),
    english: base.name,
    entries,
    value: entries.map((entry) => entry.title).join(' + '),
    src: entries[0]?.source ?? '',
  };
}

/** The rows a part shows: its numbered slots, then any step of the earlier web editor that still holds something (an older plan's). */
function visibleRows(section) {
  return section.rows.filter((r) => r.slot || rowFilled(r, state.segments, state.notes) || r.id === state.open);
}

/** The HTML lang of the plan's language, so a screen reader reads the Tagalog and Cebuano names in their own voice. */
const HTML_LANG = { EN: 'en', TL: 'tl', CEB: 'ceb' };

/** A schedule language the parish typed itself (not English, Tagalog or Cebuano), or Other opened to type one. */
const isCustomLanguage = () => state.otherOpen || (state.massLanguage.trim() !== '' && !isScheduleLanguage(normalizeMassLanguage(state.massLanguage)));

function renderHeader() {
  const when = plan ? [dateLabel(plan.date), state.massTime].filter(Boolean).join(' · ') : '';
  const languageLabel = (isCustomLanguage() && state.massLanguage.trim()) || languageName(state.language);
  document.getElementById('eyebrow').textContent = plan ? `HOLY MASS PLAN · ${when} · ${languageLabel.toUpperCase()}` : 'HOLY MASS PLAN';
  // The title is edited in place; it is not redrawn while it is being typed in.
  if (document.activeElement !== titleInput) titleInput.value = plan ? state.name : 'No plan open';
  titleInput.disabled = !plan || !canEdit;
  document.getElementById('date-badge').textContent = plan ? mdyDate(plan.date) : '';
  const progress = plan ? massProgress({ filledSlots: filledSlotNumbers() }, plan.date) : null;
  const fill = document.getElementById('fill-badge');
  fill.textContent = progress ? `${progress.done} / ${progress.total}` : '';
  fill.classList.toggle('is-ready', Boolean(progress?.ready));
  fill.title = 'The slots this day needs, as the laptop counts them: every slot that is not optional, and on a weekday not the parts said only on Sundays and solemnities.';
  document.getElementById('strip-subtitle').textContent = plan ? stripSubtitle(plan.date, itemCount(ROWS, state.segments)) : '';
  document.title = `${plan ? state.name || plan.name : 'Holy Mass plan'} · APCCMMA Web Planner`;

  const status = document.getElementById('status');
  if (status) {
    status.textContent = plan ? statusText({ dirty: state.dirty, error: state.error }) : state.error || 'Not loaded';
    status.parentElement.dataset.state = state.error ? 'error' : state.dirty ? 'dirty' : 'saved';
  }
  const duplicateEl = document.getElementById('duplicate');
  if (duplicateEl) duplicateEl.disabled = !plan || !canEdit || state.saving;
  document.getElementById('delete').disabled = !plan || !canEdit || state.saving;
  const save = saveButton(state.saving);
  const saveEl = document.getElementById('save');
  if (saveEl) {
    // A Holy Mass time another plan on the day already has is not saved: the warning beside the schedule offers Open Existing.
    saveEl.disabled = !plan || !canEdit || save.disabled || takenBy() !== null;
    saveEl.textContent = save.label;
  }
  const discard = document.getElementById('discard');
  discard.hidden = !plan || !state.dirty;
  discard.disabled = !plan || state.saving;
  document.getElementById('print-lineup').disabled = !plan;
  document.getElementById('open-templates').disabled = !plan;
  const note = document.getElementById('view-only');
  note.textContent = VIEW_ONLY;
  note.hidden = !plan || canEdit;
  const back = document.getElementById('back-to-calendar');
  back.href = calendarHref('mass', ROOT, plan?.date?.slice(0, 7) ?? '');
  const collapseAll = document.getElementById('collapse-all');
  collapseAll.textContent = collapseLabel(collapsed.length, SECTIONS.length);
  collapseAll.setAttribute('aria-expanded', String(collapsed.length < SECTIONS.length));
  renderBanner();
  renderDetails();
}

/** The readiness banner: songs and readings/notes chosen, and what the day still needs. */
function renderBanner() {
  const box = document.getElementById('readiness');
  box.hidden = !plan;
  if (!plan) return;
  const ready = readiness({ rows: ROWS, segments: state.segments, notes: state.notes, date: plan.date, nameOf: (row) => slotName(row, state.language) });
  box.classList.toggle('is-ready', ready.ready);
  // Offered while the day has readings that some reading slot does not hold yet (an older or an emptied plan).
  const status = readingStatus(state.segments, plan.date);
  box.innerHTML = readinessBannerHtml(ready, { dateText: shortDate(plan.date), populate: canEdit && status.empty > 0 });
}

/** The slot numbers this plan has an item in, as the server and the laptop count them: a slot with a song, text or a note. */
function filledSlotNumbers() {
  return ROWS.filter((r) => r.slot && (slotEntries(state.segments[r.id]).length || (state.notes[r.id] ?? '').trim())).map((r) => r.slot);
}

/** The Holy Mass already at this plan's typed time on its day, or null. */
function takenBy(massTime = state.massTime) {
  return plan ? conflictIn(dayPlans, plan.date, massTime, plan.id) : null;
}

/** This plan as the schedule rules and the plan switcher read it, with its title, time and language as being edited. */
const currentAsSchedule = () => asSchedulePlan({ ...plan, name: state.name || plan.name, massTime: state.massTime, massLanguage: state.massLanguage });

/** HOLY MASSES ON THIS DAY: the day's Holy Masses in the order they are celebrated, this one a button for its time, then + Add Time. */
function renderSwitcher() {
  const nav = document.getElementById('schedule-switcher');
  if (!plan) {
    nav.innerHTML = '';
    return;
  }
  const others = dayPlans.filter((p) => p.id !== plan.id);
  const day = schedulesOn([...others, currentAsSchedule()], plan.date);
  nav.innerHTML = scheduleRowHtml(day, plan.id, {
    pathOf: (p) => `${ROOT}${editorPathFor({ id: p.id, kind: 'mass' })}`,
    addHref: canEdit ? newPlanFlowHref({ kind: 'mass', date: plan.date }, ROOT) : null,
    canEdit,
    popoverOpen: state.popover.open,
  });
}

/** The plan switcher, the EN / TL / CEB / Other pills, the taken-time warning and the day's Holy Masses. */
function renderDetails() {
  const locked = !plan || !canEdit;
  const select = document.getElementById('plan-switch');
  if (plan && document.activeElement !== select) {
    select.innerHTML = planSwitchOptionsHtml(massPlans, currentAsSchedule());
  }
  select.disabled = !plan;
  const custom = isCustomLanguage();
  document.getElementById('language').innerHTML = MASS_LANGUAGES.map((l) => {
    const on = l.code === state.language;
    return `<button type="button" class="lp-lang${on ? ' is-on' : ''}${on && custom ? ' is-texts' : ''}" role="radio" data-lang="${l.code}" aria-checked="${on}" tabindex="${on ? 0 : -1}" title="${esc(custom ? `Readings and responses in ${l.name}` : l.name)}" ${locked ? 'disabled' : ''}>${esc(l.code)}</button>`;
  }).join('');
  const other = document.getElementById('lang-other');
  other.setAttribute('aria-pressed', String(custom));
  other.classList.toggle('is-on', custom);
  other.disabled = locked;
  const otherInput = document.getElementById('lang-other-input');
  otherInput.hidden = !custom;
  otherInput.disabled = locked;
  if (document.activeElement !== otherInput) otherInput.value = custom ? state.massLanguage : '';
  showConflict(document.getElementById('schedule-conflict'), takenBy());
  renderSwitcher();
  document.getElementById('steps').setAttribute('lang', HTML_LANG[state.language]);
}

/**
 * Sets the readings and responses language. Unless the parish typed its own Holy Mass language, the schedule language follows, as on the
 * laptop (EN is an English Holy Mass).
 */
function chooseTextsLanguage(code) {
  setDetail(isCustomLanguage() ? { language: code } : { language: code, massLanguage: scheduleLanguageForPlan(code) });
  renderAll();
}

/** Changes a plan detail in this session. Nothing is saved until Save plan. */
function setDetail(patch) {
  Object.assign(state, patch);
  state.dirty = true;
  state.error = '';
}

// ---- The slots ----

/** The quick-assign panel inside an open slot: what it holds (with keys), the song list or typed text, the Hub, and its note. */
function panelHtml(cur) {
  return `
              <div class="lp-panel-head">
                <span class="lp-panel-title">${cur.slot ? `Slot ${cur.n}` : 'Step'} · ${esc(cur.name)}</span>
                <button type="button" class="lp-panel-close" data-open-row="${esc(cur.id)}" aria-label="Close ${esc(cur.name)}">×</button>
              </div>
              ${entryListHtml(cur.entries, cur.id, canEdit)}${addBody(cur)}${slotNoteBody(cur)}`;
}

/** Everything that adds to a row: the song list or typed text, and the two ways into the Content Hub. Any row takes any of them. */
function addBody(cur) {
  const list = state.mode === 'list';
  const reading = cur.kind === 'reading';
  const lock = canEdit ? '' : 'disabled';
  const tabs = `
            <div role="tablist" aria-label="How to fill this slot" class="lp-panel-tabs">
              <button type="button" role="tab" data-mode="list" aria-selected="${list}" class="${list ? 'is-on' : ''}">Song list</button>
              <button type="button" role="tab" data-mode="text" aria-selected="${!list}" class="${list ? '' : 'is-on'}">Type text</button>
            </div>`;
  const panel = list
    ? `
              <div data-inline-picker="${esc(cur.id)}"></div>`
    : `
              <div class="lp-panel-text">
                <label class="lp-field">
                  <span>${reading ? 'Reading reference' : 'Words or a short note'}</span>
                  <textarea id="typed-text" rows="3" maxlength="500" placeholder="${reading ? 'e.g. the reading reference' : 'e.g. sung by the cantor'}" ${lock}></textarea>
                </label>
                <p class="lp-lib-hint">Typed text is a note for the operator on the church laptop. It does not appear on the projector.${reading ? ' To show the Bible text, pick the verses in the desktop app.' : ''}</p>
                <button type="button" data-action="use-text" ${lock} class="btn-primary">Add this text</button>
              </div>`;
  return `<div class="lp-panel-add">${tabs}${panel}${hubButtonsHtml(canEdit)}</div>`;
}

/** The row's note for the musicians and the operator (key, capo, choir cue), then Clear slot when the row holds anything. */
function slotNoteBody(cur) {
  const holds = cur.entries.length > 0 || Boolean((state.notes[cur.id] ?? '').trim());
  const placeholder = cur.kind === 'song' ? 'e.g. Capo 2, choir sings the second verse' : 'e.g. Read by the youth lector';
  const lock = canEdit ? '' : 'disabled';
  return `
          <div class="lp-panel-note">
            <label class="lp-field">
              <span>Slot note / musician cue (optional)</span>
              <textarea id="rite-note" rows="2" maxlength="1000" placeholder="${esc(placeholder)}" ${lock}>${esc(state.notes[cur.id] ?? '')}</textarea>
            </label>
            <div class="lp-panel-actions">
              <button type="button" data-action="save-note" ${lock} class="btn-quiet">${state.noteSaved ? 'Note saved' : 'Save note'}</button>
              ${holds ? `<button type="button" data-action="clear-slot" ${lock} class="btn-quiet is-danger">${cur.slot ? 'Clear slot' : 'Clear step'}</button>` : ''}
            </div>
          </div>`;
}

/** A reading's title in the plan's language: the name of the slot it is read in (Unang Pagbasa, Unang Pagbasa …). The stored name stays English. */
function readingLabel(type) {
  const row = ROWS.find((r) => r.slot === READING_SLOT_NUMBER[type]);
  return row ? slotName(row, state.language) : type;
}

/** The liturgical day and reference shown under a reading in its slot, from the plan's date. */
function referenceOf(type) {
  const { day, readings } = dayReadingsFor(plan?.date);
  const found = readings.find((r) => r.type === type);
  return found ? [day.name, found.citation].filter(Boolean).join(' · ') : '';
}

/** The four parts: each one's numbered slots, then any earlier-editor step that still holds something. */
function renderSteps() {
  const steps = document.getElementById('steps');
  if (!plan) {
    steps.innerHTML = `<p class="lp-empty">${esc(state.error || 'Open a plan from a calendar to see its slots.')}</p>`;
    return;
  }
  // A redraw keeps anything half-typed in the open panel.
  const typed = document.getElementById('typed-text')?.value;
  const note = document.getElementById('rite-note')?.value;
  steps.innerHTML = SECTIONS.map((section) => {
    const open = !collapsed.includes(section.group);
    const slotRows = section.rows.filter((r) => r.slot);
    const otherRows = visibleRows(section).filter((r) => !r.slot);
    const filled = slotRows.filter((r) => rowFilled(r, state.segments, state.notes)).length;
    const rowOf = (r) => {
      const cur = stepOf(r.id);
      return slotRowHtml(cur, {
        active: r.id === state.sel,
        open: r.id === state.open,
        flash: r.id === state.flash,
        canEdit,
        note: state.notes[r.id],
        readingLabel,
        referenceOf,
        panelHtml: r.id === state.open ? panelHtml(cur) : '',
      });
    };
    const rowsHtml = open
      ? slotRows.map(rowOf).join('') + (otherRows.length ? `<div class="lp-other-head">OTHER STEPS</div>${otherRows.map(rowOf).join('')}` : '')
      : '';
    return sectionCardHtml(section, { title: sectionName(section, state.language), open, filled, total: slotRows.length, rowsHtml });
  }).join('');
  const typedBox = document.getElementById('typed-text');
  if (typedBox && typed !== undefined) typedBox.value = typed;
  const noteBox = document.getElementById('rite-note');
  if (noteBox && note !== undefined) noteBox.value = note;
  mountPicker();
}

/**
 * Draws the song picker into the open slot's panel, on the Holy Mass tab and the slot's own category (the Kyrie opens on Kyrie). Add puts a
 * song at the end of the slot; pressing Added takes it out again.
 */
function mountPicker() {
  const id = state.open;
  const root = id ? document.querySelector(`[data-inline-picker="${CSS.escape(id)}"]`) : null;
  if (!root) return;
  const cur = stepOf(id);
  mountSongPicker(root, {
    key: `mass:${id}`,
    songs: songs.filter((s) => !s.removed),
    serviceType: 'mass',
    category: cur.pickerCategory || 'all',
    canEdit,
    chosenIds: () => new Set(slotEntries(state.segments[id]).map((entry) => entry.songId).filter(Boolean)),
    onToggle: (songId) => {
      const at = slotEntries(state.segments[id]).findIndex((entry) => entry.songId === songId);
      changeSegments(at >= 0 ? withoutEntry(state.segments, id, at) : withEntry(state.segments, id, { songId, contentType: 'song' }));
    },
  });
}

// ---- The library ----

/** The active target slot as the library names it, or null. */
function targetOf() {
  if (!state.sel) return null;
  const cur = stepOf(state.sel);
  return { id: cur.id, n: cur.slot ? cur.n : '•', name: cur.name };
}

function libStatus(text) {
  document.getElementById('lib-status').textContent = text;
}

/** The library: its tabs, who + adds to, and the open tab's panel. */
function renderLibrary() {
  document.getElementById('lib-tabs').innerHTML = libraryTabsHtml(lib.tab);
  const target = plan ? targetOf() : null;
  document.getElementById('lib-target').innerHTML = plan && lib.tab !== 'templates' && lib.tab !== 'lectionary' ? targetLineHtml(target) : '';
  const panel = document.getElementById('lib-panel');
  panel.setAttribute('aria-labelledby', `lib-tab-${lib.tab}`);
  if (!plan) {
    panel.innerHTML = '';
    return;
  }
  if (lib.tab === 'songs') {
    const search = document.activeElement?.dataset?.libSearch !== undefined;
    panel.innerHTML = `<div class="lp-lib-controls">${songControlsHtml(lib, songs.filter((s) => !s.removed))}</div><div data-lib-list class="lp-lib-list"></div>`;
    refreshSongList();
    if (search) {
      const box = panel.querySelector('[data-lib-search]');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  } else if (lib.tab === 'lectionary') {
    const focus = document.activeElement?.dataset?.lectSearch !== undefined;
    const date = lib.date ?? plan.date;
    const { day, readings } = dayReadingsFor(date);
    const own = dayReadingsFor(plan.date).readings;
    const held = new Set(own.filter((r) => slotEntries(state.segments[r.rowId]).some((e) => e.text === r.type && e.contentType === 'scripture')).map((r) => r.type));
    panel.innerHTML = lectionaryPanelHtml({ date, planDate: plan.date, dayName: day.name, readings, query: lib.lq, canEdit, titleOf: readingLabel, held, empty: readingStatus(state.segments, plan.date).empty });
    if (focus) {
      const box = panel.querySelector('[data-lect-search]');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  } else if (lib.tab === 'cues') {
    panel.innerHTML = cuesPanelHtml({ target, canEdit });
  } else {
    panel.innerHTML = templatesPanelHtml({ canEdit, otherPlans: massPlans.filter((p) => p.id !== plan.id) });
  }
}

/** Redraws only the song cards, so typing in Search is never interrupted. */
function refreshSongList() {
  const box = document.querySelector('[data-lib-list]');
  if (!box) return;
  const available = songs.filter((s) => !s.removed);
  const list = librarySongs(available, lib);
  const chosen = new Set(state.sel ? slotEntries(state.segments[state.sel]).map((entry) => entry.songId).filter(Boolean) : []);
  box.innerHTML = songListHtml(list, { chosen, canEdit, songs: available, hasTarget: Boolean(state.sel) });
  libStatus(available.length ? `${list.length} of ${available.length} song${available.length === 1 ? '' : 's'} shown` : '');
}

/** Opens the part a row is in, if it is closed. */
function openSectionOf(id) {
  const section = SECTIONS.find((s) => s.rows.some((r) => r.id === id));
  if (section && collapsed.includes(section.group)) {
    collapsed = collapsed.filter((g) => g !== section.group);
    writeCollapsed(collapsed);
  }
}

/** Brings a slot into view (on a phone, after a library add, the slots are below or above) and marks it for a moment. */
function showRow(id, { focus = false } = {}) {
  const el = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (!window.matchMedia(WIDE).matches || rect.top < 0 || rect.bottom > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (focus) el.querySelector('[data-select-row]')?.focus({ preventScroll: true });
}

function flashRow(id) {
  state.flash = id;
  setTimeout(() => {
    if (state.flash !== id) return;
    state.flash = null;
    document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.classList.remove('is-flash');
  }, 1800);
}

/** + on a library song: into the active target slot, or the slot of the song's category. On the target, ✓ takes it out again. */
function addFromLibrary(songId) {
  const song = songs.find((s) => s.id === songId);
  if (!song || !plan || !canEdit) return;
  const target = slotForSong(song, ROWS, state.segments, state.sel);
  if (!target) {
    libStatus(`Click a slot first: no slot takes ${song.category || 'this category'} on its own.`);
    return;
  }
  const name = stepOf(target).name;
  const at = slotEntries(state.segments[target]).findIndex((entry) => entry.songId === songId);
  if (at >= 0 && target !== state.sel) {
    libStatus(`${song.title} is already in ${name}.`);
    showRow(target);
    return;
  }
  openSectionOf(target);
  flashRow(target);
  changeSegments(at >= 0 ? withoutEntry(state.segments, target, at) : withEntry(state.segments, target, { songId, contentType: 'song' }));
  libStatus(at >= 0 ? `Took ${song.title} out of ${name}.` : `Added ${song.title} to ${name}.`);
  document.querySelector(`[data-lib-add="${CSS.escape(songId)}"]`)?.focus({ preventScroll: true });
  if (!window.matchMedia(WIDE).matches) showRow(target);
}

/** + on a Lectionary card: the reading goes in its own slot, in front, replacing a reading already there. */
function addReading(type) {
  if (!plan || !canEdit) return;
  const date = lib.date ?? plan.date;
  const reading = dayReadingsFor(date).readings.find((r) => r.type === type);
  if (!reading?.rowId) return;
  openSectionOf(reading.rowId);
  flashRow(reading.rowId);
  changeSegments(withReading(state.segments, reading, date, plan.date));
  libStatus(date === plan.date ? `${readingLabel(type)} is in its slot.` : `${readingLabel(type)} added as a typed reference.`);
  document.querySelector(`[data-lib-reading="${CSS.escape(type)}"]`)?.focus({ preventScroll: true });
  if (!window.matchMedia(WIDE).matches) showRow(reading.rowId);
}

/** Populate day's readings: the plan's date's readings in the reading slots that hold nothing. A slot that holds something is left as it is. */
function populateReadings() {
  if (!plan || !canEdit) return;
  const outcome = withDayReadings(state.segments, plan.date);
  if (outcome.filled.length === 0) {
    libStatus(outcome.kept.length ? 'The reading slots already hold something, so nothing was changed.' : outcome.current.length ? "The day's readings are already in the plan." : 'The Ordo has no readings for this date.');
    return;
  }
  for (const id of outcome.filled) openSectionOf(id);
  flashRow(outcome.filled[0]);
  changeSegments(outcome.segments);
  libStatus(`Filled ${outcome.filled.length} reading${outcome.filled.length === 1 ? '' : 's'}${outcome.kept.length ? `; ${outcome.kept.length} slot${outcome.kept.length === 1 ? ' already holds' : 's already hold'} something and ${outcome.kept.length === 1 ? 'was' : 'were'} left alone` : ''}. Save plan to keep it.`);
}

/** A cue from Notes & Cues, added to the target slot's note. */
function addCue(cue) {
  if (!state.sel || !canEdit) return;
  const next = withCue(state.notes[state.sel], cue);
  if (next === (state.notes[state.sel] ?? '').trim()) {
    libStatus('That cue is already on the slot note.');
    return;
  }
  state.notes = { ...state.notes, [state.sel]: next };
  state.dirty = true;
  state.error = '';
  flashRow(state.sel);
  libStatus(`Cue added to ${stepOf(state.sel).name}.`);
  renderAll();
}

/** Whether the plan holds anything a template would replace. */
const holdsAnything = () => ROWS.some((r) => rowFilled(r, state.segments, state.notes));

function applyTemplate(id) {
  const template = MASS_TEMPLATES.find((t) => t.id === id);
  if (!template || !canEdit) return;
  const question = id === 'clear'
    ? 'Clear all slots? Every song, text and note is taken out of this plan. Nothing is saved until Save plan.'
    : `Use ${template.label}? It replaces what this plan holds. Nothing is saved until Save plan.`;
  if ((id === 'clear' || holdsAnything()) && !window.confirm(question)) return;
  const next = templateState(id, ROWS, state.segments);
  // Standard and Weekday start from the day's readings, as the laptop's Planner does; Clear All Slots leaves everything empty.
  if (id !== 'clear') next.segments = withDayReadings(next.segments, plan.date).segments;
  state.segments = next.segments;
  state.notes = next.notes;
  state.open = null;
  state.dirty = true;
  state.error = '';
  libStatus(id === 'clear' ? 'Every slot is empty.' : `${template.label} applied.`);
  renderAll();
}

/** Copy from another Holy Mass: its songs, text and notes replace this plan's, with the Hub entries they use. */
async function copyFrom(id) {
  const source = massPlans.find((p) => p.id === id);
  if (!source || !canEdit) return;
  if (holdsAnything() && !window.confirm(`Copy ${source.name} into this plan? It replaces what this plan holds. Nothing is saved until Save plan.`)) return;
  libStatus(`Copying ${source.name}…`);
  try {
    const saved = await getPlan(id);
    const filled = massFromItems(saved.plan.items, ROWS);
    planSongs = [...planSongs, ...saved.songs.filter((s) => !planSongs.some((p) => p.id === s.id))];
    songs = songsForEditor(listed, planSongs);
    const have = new Set(state.contentHubItems.map((item) => item.id));
    state.contentHubItems = [...state.contentHubItems, ...(saved.plan.contentHubItems ?? []).filter((item) => !have.has(item.id))];
    state.segments = filled.segments;
    state.notes = filled.notes;
    state.open = null;
    state.dirty = true;
    state.error = '';
    libStatus(`Copied from ${source.name}. Save plan to keep it.`);
    renderAll();
  } catch (err) {
    libStatus(err.message);
  }
}

// ---- The time popover ----

function renderPopover() {
  const box = document.getElementById('time-popover');
  box.hidden = !state.popover.open;
  if (!state.popover.open) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = timePopoverHtml({ value: state.popover.value, conflict: takenBy(state.popover.value) });
}

/** Re-checks the typed time without redrawing the box, so the caret stays put. */
function checkPopover() {
  const box = document.getElementById('time-popover');
  const conflict = takenBy(state.popover.value);
  const fresh = document.createElement('div');
  fresh.innerHTML = timePopoverHtml({ value: state.popover.value, conflict });
  box.querySelector('[data-tp-error]').innerHTML = fresh.querySelector('[data-tp-error]').innerHTML;
  box.querySelector('[data-tp="apply"]').disabled = Boolean(conflict);
  for (const chip of box.querySelectorAll('[data-tp-preset]')) chip.setAttribute('aria-pressed', String(chip.dataset.tpPreset === state.popover.value.trim()));
}

function openPopover() {
  if (!plan || !canEdit) return;
  state.popover = { open: !state.popover.open, value: state.massTime };
  renderPopover();
  renderSwitcher();
  if (state.popover.open) document.getElementById('tp-time')?.focus();
}

function closePopover() {
  state.popover = { open: false, value: '' };
  renderPopover();
  renderSwitcher();
  document.querySelector('#schedule-switcher [data-edit-time]')?.focus();
}

function applyPopover() {
  const value = state.popover.value.trim();
  if (takenBy(value)) return;
  if (value !== state.massTime) setDetail({ massTime: value });
  closePopover();
  renderHeader();
}

// ---- Drawing ----

function renderAll() {
  renderHeader();
  renderSteps();
  renderLibrary();
  renderPopover();
}

/** Changes what the slots hold in this session. Nothing is saved until Save plan. */
function changeSegments(segments) {
  state.segments = segments;
  state.dirty = true;
  state.error = '';
  renderHeader();
  renderSteps();
  if (lib.tab === 'songs') {
    document.getElementById('lib-target').innerHTML = targetLineHtml(targetOf());
    refreshSongList();
  } else {
    renderLibrary();
  }
}

/** Makes a slot the active target, opening its part. */
function selectRow(id) {
  state.sel = id;
  state.noteSaved = false;
  openSectionOf(id);
  renderHeader();
  renderSteps();
  renderLibrary();
}

function openHub(mode) {
  const row = stepOf(state.open);
  openContentHub({
    items: state.contentHubItems,
    slotName: row.name,
    language: state.language,
    languageName: languageName(state.language),
    mode,
    usedIds: () => usedHubIds(state.segments),
    onChange: (items) => {
      state.contentHubItems = items;
      state.dirty = true;
      state.error = '';
      renderAll();
    },
    onUse: (entry) => changeSegments(withEntry(state.segments, row.id, { contentHubId: entry.id, text: entry.title, contentType: 'hub_item' })),
  });
}

/** PRINT LINEUP: the lineup as it is on screen, on white paper (or saved as a PDF). Titles, keys and cues only. */
function printLineup() {
  if (!plan) return;
  const sections = SECTIONS.map((section) => ({
    title: `${section.number}. ${sectionName(section, state.language)}`,
    rows: visibleRows(section).map((r) => {
      const cur = stepOf(r.id);
      return { n: r.slot ? r.n : '•', name: cur.name, entries: cur.entries, note: state.notes[r.id] ?? '' };
    }),
  }));
  const languageLabel = (isCustomLanguage() && state.massLanguage.trim()) || languageName(state.language);
  document.getElementById('setlist-print').innerHTML = printLineupHtml({
    eyebrow: 'Holy Mass lineup',
    name: state.name || plan.name,
    when: [shortDate(plan.date), state.massTime, languageLabel].filter(Boolean).join(' · '),
    sections,
  });
  document.body.classList.add('is-printing-setlist');
  const title = document.title;
  // The browser offers this as the name of the saved PDF.
  document.title = `Lineup - ${state.name || plan.name}`;
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('is-printing-setlist');
    document.title = title;
  }, { once: true });
  window.print();
}

/** Reads the saved plan and the song list from the server. A failure keeps what was on screen and shows the plain message. */
async function load() {
  try {
    const [saved, list, all] = await Promise.all([getPlan(planId), listSongs(), listPlans().catch(() => null)]);
    // The other Holy Masses on this plan's day, for the switcher and the taken-time warning. Without the list, the server still checks.
    massPlans = all ? all.plans.filter((p) => p.kind !== 'pw').map(asSchedulePlan) : [];
    dayPlans = massPlans.filter((p) => p.liturgical_date === saved.plan.date);
    plan = saved.plan;
    canEdit = saved.canEdit;
    listed = list.songs;
    songs = songsForEditor(list.songs, saved.songs);
    planSongs = saved.songs;
    songWatch.seen(list);
    state = fresh({ ...massFromItems(plan.items, ROWS), language: plan.language, massTime: plan.massTime, massLanguage: plan.massLanguage });
    rememberPlan({ id: plan.id, kind: 'mass', name: plan.name, date: plan.date });
    mountHeader();
    resetSongPickers();
    lib.date = null;
  } catch (err) {
    if (plan) state.error = err.message;
    else state = { ...fresh(null), error: err.message };
  }
  renderAll();
}

async function save() {
  if (!plan || !canEdit || state.saving) return;
  if (takenBy()) {
    document.querySelector('#schedule-conflict [data-open-existing]')?.focus();
    return;
  }
  const nameProblem = checkPlanName(state.name);
  if (nameProblem) {
    state.error = nameProblem;
    renderHeader();
    titleInput.focus();
    return;
  }
  state.saving = true;
  state.error = '';
  renderHeader();
  try {
    const details = { name: state.name, language: state.language, massTime: state.massTime.trim() || null, massLanguage: state.massLanguage.trim() || null, contentHubItems: state.contentHubItems };
    const response = await savePlan(savePayload(plan, massToItems(state, ROWS), details));
    Object.assign(plan, details, { massTime: details.massTime ?? '', massLanguage: details.massLanguage ?? '' });
    plan.name = response.name ?? state.name.trim();
    state.name = plan.name;
    plan.updatedAt = response.savedAt;
    state.dirty = false;
    state.otherOpen = false;
    massPlans = [...massPlans.filter((p) => p.id !== plan.id), currentAsSchedule()];
    rememberPlan({ id: plan.id, kind: 'mass', name: plan.name, date: plan.date });
    mountHeader();
  } catch (err) {
    if (err.conflict) {
      // Saved on another device since the list was read: the server names the Holy Mass already at that time.
      dayPlans = [...dayPlans.filter((p) => p.id !== err.conflict.id), asSchedulePlan({ ...err.conflict, kind: 'mass' })];
    } else {
      state.error = err.message;
    }
  } finally {
    state.saving = false;
    renderHeader();
  }
}

// ---- Events ----

document.querySelector('main').addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) {
    // A click anywhere on a slot row (not on its buttons, pills or panel) makes it the target.
    const row = event.target.closest('.lp-slot-main')?.closest('[data-row]');
    if (row && plan && row.dataset.row !== state.sel) selectRow(row.dataset.row);
    return;
  }
  if (target.disabled) return;
  const data = target.dataset;
  if (data.selectRow) {
    selectRow(data.selectRow);
  } else if (data.openRow) {
    const id = data.openRow;
    const closing = state.open === id;
    state.open = closing ? null : id;
    if (!closing) {
      state.sel = id;
      state.noteSaved = false;
      state.mode = stepOf(id).kind === 'song' ? 'list' : 'text';
      void songWatch.check();
    }
    renderSteps();
    renderLibrary();
    document.querySelector(`[data-row="${CSS.escape(id)}"] .lp-add`)?.focus({ preventScroll: true });
  } else if (data.jumpRow) {
    openSectionOf(data.jumpRow);
    selectRow(data.jumpRow);
    showRow(data.jumpRow, { focus: true });
  } else if (data.lang) {
    if (data.lang === state.language) return;
    chooseTextsLanguage(data.lang);
    document.querySelector(`[data-lang="${data.lang}"]`)?.focus();
  } else if (target.id === 'lang-other') {
    if (isCustomLanguage()) {
      state.otherOpen = false;
      setDetail({ massLanguage: scheduleLanguageForPlan(state.language) });
      renderHeader();
    } else {
      state.otherOpen = true;
      setDetail({ massLanguage: '' });
      renderHeader();
      document.getElementById('lang-other-input').focus();
    }
  } else if (data.toggle) {
    collapsed = collapsed.includes(data.toggle) ? collapsed.filter((g) => g !== data.toggle) : [...collapsed, data.toggle];
    writeCollapsed(collapsed);
    renderSteps();
    renderHeader();
    document.querySelector(`[data-toggle="${CSS.escape(data.toggle)}"]`)?.focus();
  } else if (target.id === 'collapse-all') {
    collapsed = collapsed.length >= SECTIONS.length ? [] : SECTIONS.map((s) => s.group);
    writeCollapsed(collapsed);
    renderSteps();
    renderHeader();
  } else if (data.mode) {
    state.mode = data.mode;
    renderSteps();
  } else if (data.removeEntry !== undefined) {
    changeSegments(withoutEntry(state.segments, data.for, Number(data.removeEntry)));
  } else if (data.moveEntry !== undefined) {
    const from = Number(data.moveEntry);
    const to = from + Number(data.delta);
    changeSegments(withEntryMoved(state.segments, data.for, from, to));
    document.querySelector(`[data-for="${CSS.escape(data.for)}"][data-move-entry="${to}"][data-delta="${data.delta}"]:not(:disabled), [data-for="${CSS.escape(data.for)}"][data-move-entry="${to}"]:not(:disabled)`)?.focus();
  } else if (data.action === 'clear-slot') {
    const row = stepOf(state.open);
    if (!window.confirm(`Clear ${row.name}? Its songs, text and note are taken out of this plan.`)) return;
    delete state.notes[state.open];
    changeSegments(withoutEntries(state.segments, state.open));
  } else if (data.hub) {
    openHub(data.hub);
  } else if (data.action === 'use-text') {
    const text = document.getElementById('typed-text').value.trim();
    if (!text) return;
    document.getElementById('typed-text').value = '';
    changeSegments(withEntry(state.segments, state.open, { text }));
  } else if (data.action === 'save-note') {
    state.notes[state.open] = document.getElementById('rite-note').value.trim();
    state.noteSaved = true;
    state.dirty = true;
    renderHeader();
    renderSteps();
  } else if (data.editTime !== undefined) {
    openPopover();
  } else if (data.tpPreset) {
    state.popover.value = data.tpPreset;
    renderPopover();
    document.querySelector(`[data-tp-preset="${CSS.escape(data.tpPreset)}"]`)?.focus();
  } else if (data.tp === 'apply') {
    applyPopover();
  } else if (data.tp === 'cancel') {
    closePopover();
  } else if (data.libTab) {
    lib.tab = libraryTabOf(data.libTab);
    writeStored(LIBRARY_TAB_KEY, lib.tab);
    renderLibrary();
    document.getElementById(`lib-tab-${lib.tab}`)?.focus();
  } else if (data.libService) {
    lib.service = serviceFilterOf(data.libService);
    lib.category = 'all';
    renderLibrary();
    document.querySelector(`[data-lib-service="${lib.service}"]`)?.focus();
  } else if (data.libAdd) {
    addFromLibrary(data.libAdd);
  } else if (data.libReading) {
    addReading(data.libReading);
  } else if (data.populateReadings !== undefined) {
    populateReadings();
  } else if (data.lectToday !== undefined) {
    lib.date = null;
    renderLibrary();
  } else if (data.clearTarget !== undefined) {
    state.sel = null;
    renderSteps();
    renderLibrary();
  } else if (data.cue) {
    addCue(data.cue);
  } else if (data.action === 'add-cue') {
    const box = document.getElementById('lib-cue');
    const cue = box?.value.trim();
    if (cue) addCue(cue);
  } else if (data.template) {
    applyTemplate(data.template);
  } else if (data.action === 'copy-plan') {
    void copyFrom(document.getElementById('copy-from')?.value);
  } else if (target.id === 'print-lineup') {
    printLineup();
  } else if (target.id === 'open-templates' || target.id === 'browse-songs') {
    lib.tab = target.id === 'open-templates' ? 'templates' : 'songs';
    writeStored(LIBRARY_TAB_KEY, lib.tab);
    renderLibrary();
    document.getElementById('library').scrollIntoView({ behavior: 'smooth', block: 'start' });
    (lib.tab === 'songs' ? document.querySelector('[data-lib-search]') : document.getElementById(`lib-tab-${lib.tab}`))?.focus({ preventScroll: true });
  } else if (target.id === 'discard') {
    if (planId && window.confirm('Discard your unsaved changes? The plan goes back to how it was last saved.')) void load();
  } else if (target.id === 'save') {
    void save();
  } else if (target.id === 'duplicate') {
    void duplicate();
  } else if (target.id === 'delete') {
    askDelete();
  }
});

document.querySelector('main').addEventListener('input', (event) => {
  const el = event.target;
  if (el.dataset?.libSearch !== undefined) {
    lib.query = el.value;
    refreshSongList();
  } else if (el.dataset?.lectSearch !== undefined) {
    lib.lq = el.value;
    renderLibrary();
  } else if (el.dataset?.tpTime !== undefined) {
    state.popover.value = el.value;
    checkPopover();
  } else if (el.id === 'lang-other-input') {
    setDetail({ massLanguage: el.value });
    renderHeader();
  }
});

document.querySelector('main').addEventListener('change', (event) => {
  const el = event.target;
  if (el.dataset?.lectDate !== undefined) {
    lib.date = /^\d{4}-\d{2}-\d{2}$/.test(el.value) && el.value !== plan?.date ? el.value : null;
    renderLibrary();
  } else if (el.dataset?.libCategory !== undefined) {
    lib.category = el.value;
    refreshSongList();
  } else if (el.dataset?.role === 'entry-key') {
    // The key a song is sung in for this plan. The song in the church's list keeps its own key.
    changeSegments(withEntryKey(state.segments, el.dataset.for, Number(el.dataset.index), el.value));
  } else if (el.id === 'plan-switch') {
    if (!plan || el.value === plan.id) return;
    if (state.dirty && !window.confirm('Leave this plan? Your unsaved changes here will be lost.')) {
      el.value = plan.id;
      return;
    }
    state.dirty = false;
    location.assign(`${ROOT}${editorPathFor({ id: el.value, kind: 'mass' })}`);
  }
});

titleInput.addEventListener('input', () => {
  if (!plan || !canEdit) return;
  setDetail({ name: titleInput.value });
  renderHeader();
});
titleInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void save();
  } else if (event.key === 'Escape' && plan) {
    titleInput.value = plan.name;
    setDetail({ name: plan.name });
    renderHeader();
  }
});

// Enter in the time box sets it.
document.getElementById('time-popover').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.dataset?.tpTime !== undefined) {
    event.preventDefault();
    applyPopover();
  }
});

document.addEventListener('keydown', (event) => {
  // Ctrl + S (Cmd + S on a Mac) saves the plan, as on the laptop.
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
    return;
  }
  // Escape closes the time popover, then the open slot panel, then clears the target slot.
  if (event.key !== 'Escape' || document.querySelector('dialog[open]') || event.target === titleInput) return;
  if (state.popover.open) closePopover();
  else if (state.open) {
    const id = state.open;
    state.open = null;
    renderSteps();
    document.querySelector(`[data-row="${CSS.escape(id)}"] .lp-add`)?.focus();
  } else if (state.sel) {
    state.sel = null;
    renderSteps();
    renderLibrary();
  }
});

// Leaving with unsaved changes asks first.
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

/** The header: SERVICE PLANNING → Liturgical Plan, Plan Editor on, and Duplicate and Save plan on the right. */
function mountHeader() {
  mountPlannerHeader(document.querySelector('[data-planner-header]'), {
    tab: 'editor',
    root: ROOT,
    title: PAGE_TITLE,
    subtitle: PAGE_SUBTITLE,
    editorPlan: plan ? { id: plan.id, kind: 'mass', name: plan.name, date: plan.date } : lastPlan(),
    actions: headerActionsHtml(),
  });
  renderHeader();
}

/** Duplicate: a copy of the saved plan on the same day, opened in the editor. Unsaved changes here are not in the copy. */
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
    button.textContent = 'Duplicate';
    renderHeader();
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
    // Back to the Liturgical Calendar, on the month the plan was in.
    location.assign(calendarHref('mass', ROOT, plan.date.slice(0, 7)));
  } catch (err) {
    deleteError.textContent = err.message;
    deleteConfirm.disabled = false;
    deleteConfirm.textContent = 'Delete plan';
  }
});

// Open Existing: the Holy Mass already at that time opens in this editor. Unsaved changes here are kept only if the planner says so.
onOpenExisting(document.getElementById('schedule-conflict'), (id) => {
  if (state.dirty && !window.confirm('Leave this plan? Your unsaved changes here will be lost.')) return;
  location.assign(openExistingHref(id, document.documentElement.dataset.base ?? ''));
});

// Arrow keys move between the languages, as in any radio group.
document.getElementById('language').addEventListener('keydown', (event) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!step || !plan || !canEdit) return;
  event.preventDefault();
  const codes = MASS_LANGUAGES.map((l) => l.code);
  const next = codes[(codes.indexOf(state.language) + step + codes.length) % codes.length];
  chooseTextsLanguage(next);
  document.querySelector(`[data-lang="${next}"]`)?.focus();
});

// Arrow keys move between the library tabs, as in any tab list.
document.getElementById('lib-tabs').addEventListener('keydown', (event) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const tabs = ['songs', 'lectionary', 'cues', 'templates'];
  document.querySelector(`[data-lib-tab="${tabs[(tabs.indexOf(lib.tab) + step + tabs.length) % tabs.length]}"]`)?.click();
});

const user = await guard();
if (user) {
  mountHeader();
  if (planId) await load();
  else renderAll();
}
