// Holy Mass plan editor: the 17 numbered slots of the Holy Mass in five collapsible sections, then the other steps of each section, and the
// drawer that fills the selected row. The structure comes from the template and mass-slots.js. What
// is chosen, typed and noted comes from the saved plan on the server, and Save sends the whole plan in one request. Any row can hold any song
// from the church's list, typed text and Content Hub entries, and more than one of them. A rite also takes an optional note for the operator.
// Songs are chosen in the song picker, which opens on Holy Mass and on the row's own category.
import { MASS_PLAN } from './sample-data.js';
import { SLOT_COUNT } from './mass-slots.js';
import { MASS_LANGUAGES, languageName, massLanguageOf, sectionName, slotName } from './mass-language.js';
import { isMassTime, massTimesFor, timeLabel } from './mass-schedule.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { getPlan, listSongs, savePlan, watchSongList } from './plan-api.js';
import { usedHubIds } from './content-hub.js';
import { entryListHtml, entrySummaryHtml, hubButtonsHtml, openContentHub } from './slot-ui.js';
import { mountSongPicker, resetSongPickers } from './song-picker.js';
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
  withoutEntry,
} from './plan-model.js';

mountSidebar();

const planId = new URLSearchParams(location.search).get('id');
const SECTIONS = massSections(MASS_PLAN);
const ROWS = SECTIONS.flatMap((section) => section.rows);
const OTHER = ROWS.filter((r) => !r.slot).length;
const FIRST_ROW = 's1';

// The sections the planner has closed, kept in this browser between visits. A blocked store just starts with every section open.
const COLLAPSED_KEY = 'apcc.web.holyMassCollapsed';
function readCollapsed() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((g) => SECTIONS.some((section) => section.group === g)) : [];
  } catch {
    return [];
  }
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
// The songs the saved plan refers to, removed ones included, so a fresh song list still names them.
let planSongs = [];
// A song saved on the church laptop while this plan is open shows here when the page is next looked at, without a reload.
const songWatch = watchSongList((list) => {
  if (!plan) return;
  songs = songsForEditor(list.songs, planSongs);
  renderKeepingDraft();
});
let collapsed = readCollapsed();
let state = fresh(null);

function fresh(saved) {
  return {
    sel: FIRST_ROW,
    mode: 'list',
    segments: saved?.segments ?? {},
    notes: saved?.notes ?? {},
    extra: saved?.extra ?? [],
    meta: saved?.meta ?? {},
    contentHubItems: structuredClone(plan?.contentHubItems ?? []),
    // The plan's language (EN, TL, CEB) and its Mass time ("HH:MM", or '' for none). `otherTime` shows the time box for a time not on the schedule.
    language: massLanguageOf(saved?.language),
    massTime: isMassTime(saved?.massTime) ? saved.massTime : '',
    otherTime: false,
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

const subOf = (r) => {
  const kind = r.kind === 'song' ? 'Song · ' + r.category : r.kind === 'reading' ? 'Reading' : r.kind === 'slot-text' ? 'Text' : 'Rite';
  const withHint = r.hint ? kind + ' · ' + r.hint : kind;
  return r.english && r.english !== r.name ? r.english + ' · ' + withHint : withHint;
};

/** The HTML lang of the plan's language, so a screen reader reads the Tagalog and Cebuano names in their own voice. */
const HTML_LANG = { EN: 'en', TL: 'tl', CEB: 'ceb' };

const BTN_PRIMARY = 'btn-primary';
const BTN_QUIET = 'btn-quiet';
const TAB_ON = 'flex:1;height:40px;border-radius:8px;border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-size:14px;font-weight:700;cursor:pointer';
const TAB_OFF = 'flex:1;height:40px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:14px;font-weight:600;cursor:pointer';
const DISABLED = canEditAttr => (canEditAttr ? '' : 'disabled');

function renderHeader() {
  const steps = ROWS.map((r) => stepOf(r.id));
  const songSteps = steps.filter((s) => s.kind === 'song');
  const readings = steps.filter((s) => s.kind === 'reading');
  const when = plan ? [dateLabel(plan.date), state.massTime ? timeLabel(state.massTime) : ''].filter(Boolean).join(' · ') : '';
  document.getElementById('eyebrow').textContent = plan ? `HOLY MASS PLAN · ${when} · ${languageName(state.language).toUpperCase()}` : 'HOLY MASS PLAN';
  document.getElementById('title').textContent = plan ? plan.name : 'No plan open';
  document.title = `${plan ? plan.name : 'Holy Mass plan'} · APCCMMA Web Planner`;
  document.getElementById('status').textContent = plan ? statusText({ dirty: state.dirty, error: state.error }) : state.error || 'Not loaded';
  document.getElementById('songs-label').textContent = `${songSteps.filter((s) => s.value).length} of ${songSteps.length} chosen`;
  document.getElementById('readings-label').textContent = `${readings.filter((s) => s.value).length} of ${readings.length} entered`;
  const slotsFilled = steps.filter((r) => r.slot && (r.value || state.notes[r.id])).length;
  document.getElementById('steps-label').textContent = `${slotsFilled} of ${SLOT_COUNT} slots · ${OTHER} other steps`;
  const save = saveButton(state.saving);
  const saveEl = document.getElementById('save');
  saveEl.disabled = !plan || !canEdit || save.disabled;
  saveEl.textContent = save.label;
  document.getElementById('discard').disabled = !plan || state.saving;
  const note = document.getElementById('view-only');
  note.textContent = VIEW_ONLY;
  note.hidden = !plan || canEdit;
  renderDetails();
}

/** The plan's details card: the language switch and the Mass time from the parish schedule (or another time). */
function renderDetails() {
  const locked = !plan || !canEdit;
  document.getElementById('language').innerHTML = MASS_LANGUAGES.map((l) => {
    const on = l.code === state.language;
    return `<button type="button" role="radio" data-lang="${l.code}" aria-checked="${on}" tabindex="${on ? 0 : -1}" ${locked ? 'disabled' : ''} style="flex:1;min-width:0;height:40px;padding:0 10px;border-radius:8px;font-size:14px;cursor:pointer;${on ? 'border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-weight:700' : 'border:1px solid transparent;background:transparent;color:var(--text);font-weight:600'}">${esc(l.name)}</button>`;
  }).join('');

  const select = document.getElementById('mass-time');
  const offered = plan ? massTimesFor(plan.date) : [];
  const listed = offered.some((t) => t.time === state.massTime);
  const options = [
    `<option value="">No Holy Mass time set</option>`,
    ...offered.map((t) => `<option value="${t.time}">${esc(t.label)}</option>`),
    ...(state.massTime && !listed ? [`<option value="${state.massTime}">${esc(timeLabel(state.massTime))} · not on the schedule</option>`] : []),
    `<option value="other">Other time…</option>`,
  ];
  select.innerHTML = options.join('');
  select.value = state.otherTime ? 'other' : state.massTime;
  select.disabled = locked;
  const other = document.getElementById('mass-time-other');
  other.hidden = !state.otherTime;
  other.disabled = locked;
  if (state.otherTime && !other.value) other.value = state.massTime;

  document.getElementById('details-note').textContent = plan
    ? `Slot names are shown in ${languageName(state.language)}${state.language === 'EN' ? '' : ', with the English name beneath'}. Song titles and typed text are not translated.`
    : '';
  document.getElementById('steps').setAttribute('lang', HTML_LANG[state.language]);
  document.getElementById('drawer').setAttribute('lang', HTML_LANG[state.language]);
}

/** Changes a plan detail in this session. Nothing is saved until Save plan. */
function setDetail(patch) {
  Object.assign(state, patch);
  state.dirty = true;
  state.error = '';
}

/** One row: its number (a slot's number, 1 to 17, or a dot for another step), its name, what is chosen, and the button that opens the drawer. */
function rowHtml(r) {
  const selected = r.id === state.sel;
  const isText = r.kind === 'slot-text';
  let chip = '';
  if (r.kind !== 'rite' || r.value) {
    let label; let fg; let bg; let edge = 'transparent';
    if (r.value) {
      label = r.entries.length > 1 ? `${r.entries.length} items` : r.src === 'list' ? 'From list' : r.src === 'hub' ? 'Content Hub' : 'Typed note';
      fg = r.src === 'list' ? 'var(--pill-text)' : 'var(--eyebrow)';
      bg = r.src === 'list' ? 'var(--pill-bg)' : 'var(--gold-wash)';
      if (r.src === 'list') edge = 'var(--pill-border)';
    } else if (r.optional) {
      label = 'Optional'; fg = 'var(--text)'; bg = 'var(--border)';
    } else {
      label = r.kind === 'song' ? 'Needs a song' : isText ? 'Needs text' : 'Needs a reading'; fg = 'var(--warn-text)'; bg = 'var(--warn-bg)';
    }
    chip = `<span style="display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid ${edge};color:${fg};background:${bg}">${label}</span>`;
  }
  const needs = r.kind !== 'rite' && !r.value && !r.optional;
  const btnLabel = r.value ? 'Change' : r.kind === 'rite' ? 'Add' : isText ? 'Type text' : 'Choose';
  const number = r.slot ? String(r.slot).padStart(2, '0') : '•';
  return `
              <div class="plan-row editor-row" data-row="${esc(r.id)}" ${r.slot ? `data-slot="${r.slot}"` : ''} style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 18px;border-bottom:1px solid var(--border);${selected ? 'background:var(--primary-wash);box-shadow:inset 0 0 0 1px var(--primary)' : 'background:transparent'}">
                <span style="flex: none; width: 28px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: ${r.slot ? 'var(--eyebrow)' : 'var(--muted)'}"><span class="sr-only">${r.slot ? 'Slot ' : 'Step '}</span>${number}</span>
                <span style="flex: 1 1 190px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size: 15px; font-weight: 700">${esc(r.name)}</span>
                  <span style="font-size: 12px; color: var(--muted)">${esc(subOf(r))}</span>
                </span>
                <span style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size:14px;line-height:1.4;${r.value ? 'color:var(--text);font-weight:600' : 'color:var(--muted)'}">${r.value ? entrySummaryHtml(r.entries, { tags: r.entries.length > 1 }) : r.kind === 'rite' ? '' : 'Nothing chosen yet'}</span>
                </span>
                <span class="editor-item-actions" style="flex: 0 0 auto; display: inline-flex">${chip}</span>
                <button type="button" data-pick="${esc(r.id)}" aria-pressed="${selected}" ${DISABLED(canEdit)} class="btn-choose ${needs ? BTN_PRIMARY : BTN_QUIET}" style="height:36px;padding:0 14px;font-size:13px;font-weight:700">${btnLabel}</button>
              </div>`;
}

/** The five collapsible sections: each one's slots in number order, then its other steps. */
function renderSteps() {
  document.getElementById('steps').innerHTML = SECTIONS.map((section) => {
    const open = !collapsed.includes(section.group);
    const slotRows = section.rows.filter((r) => r.slot);
    const otherRows = section.rows.filter((r) => !r.slot);
    const filled = slotRows.filter((r) => stepOf(r.id).value || state.notes[r.id]).length;
    const body = open
      ? slotRows.map((r) => rowHtml(stepOf(r.id))).join('') +
        (otherRows.length
          ? `<div class="eyebrow" style="padding: 10px 18px 6px; background: var(--input-bg)">OTHER STEPS</div>` + otherRows.map((r) => rowHtml(stepOf(r.id))).join('')
          : '')
      : '';
    return `
          <div data-section="${section.group}" style="border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden">
            <h2 style="margin: 0; background: var(--input-bg); border-bottom: ${open ? '1px solid var(--border)' : '0'}">
              <button type="button" data-toggle="${section.group}" aria-expanded="${open}" aria-controls="section-${section.group}" style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; border: 0; background: transparent; cursor: pointer; text-align: left">
                <span class="section-title" style="display: inline-flex; align-items: center; gap: 10px">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform: rotate(${open ? 90 : 0}deg)"><path d="m9 6 6 6-6 6"/></svg>
                  ${section.number} · ${esc(sectionName(section, state.language))}
                </span>
                <span style="font-size: 12px; font-weight: 600; color: var(--muted)">${filled} of ${slotRows.length} slots${otherRows.length ? ' · ' + otherRows.length + ' other' : ''}</span>
              </button>
            </h2>
            <div id="section-${section.group}" ${open ? '' : 'hidden'}>${body}</div>
          </div>`;
  }).join('');
}

/** Everything that adds to a row: the song list or typed text, and the two ways into the Content Hub. Any row takes any of them. */
function addBody(cur) {
  const list = state.mode === 'list';
  const reading = cur.kind === 'reading';
  const tabs = `
            <div role="tablist" aria-label="How to fill this row" style="display: flex; gap: 8px">
              <button type="button" role="tab" data-mode="list" aria-selected="${list}" style="${list ? TAB_ON : TAB_OFF}">Song list</button>
              <button type="button" role="tab" data-mode="text" aria-selected="${!list}" style="${list ? TAB_OFF : TAB_ON}">Type text</button>
            </div>`;
  const panel = list
    ? `
              <div data-inline-picker="${esc(cur.id)}"></div>`
    : `
              <div style="display: flex; flex-direction: column; gap: 12px">
                <label style="display: flex; flex-direction: column; gap: 8px">
                  <span style="font-size: 13px; font-weight: 600; color: var(--text)">${reading ? 'Reading reference' : 'Words or a short note'}</span>
                  <textarea id="typed-text" rows="4" maxlength="500" placeholder="${reading ? 'e.g. Matthew 5:1-12a' : 'e.g. Psalm 24 setting, sung by the cantor'}" ${DISABLED(canEdit)} style="padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); font-size: 14px; line-height: 1.5; resize: vertical; outline: 0"></textarea>
                </label>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted)">Typed text is a note for the operator on the church laptop. It does not appear on the projector.${reading ? ' To show the Bible text, pick the verses in the desktop app.' : ''}</p>
                <button type="button" data-action="use-text" ${DISABLED(canEdit)} class="btn-primary" style="height: 44px; font-size: 14px; font-weight: 700">Add this text</button>
              </div>`;
  return `<div style="display: flex; flex-direction: column; gap: 14px">${tabs}${panel}${hubButtonsHtml(canEdit)}</div>`;
}

function riteNoteBody(cur) {
  return `
          <div style="display: flex; flex-direction: column; gap: 14px; padding-top: 14px; border-top: 1px solid var(--border)">
            <label style="display: flex; flex-direction: column; gap: 8px">
              <span style="font-size: 13px; font-weight: 600; color: var(--text)">Operator note (optional)</span>
              <textarea id="rite-note" rows="3" maxlength="1000" placeholder="e.g. Incense at the Gospel" ${DISABLED(canEdit)} style="padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); font-size: 14px; line-height: 1.5; resize: vertical; outline: 0">${esc(state.notes[cur.id] ?? '')}</textarea>
            </label>
            <button type="button" data-action="save-note" ${DISABLED(canEdit)} class="btn-quiet" style="height: 44px; font-size: 14px; font-weight: 600">${state.noteSaved ? 'Note saved' : 'Save note'}</button>
          </div>`;
}

function renderDrawer() {
  const drawer = document.getElementById('drawer');
  if (!plan) {
    drawer.innerHTML = `<p style="margin: 0; font-size: 14px; line-height: 1.5; color: var(--text)">${esc(state.error || 'Open a plan from your plan list to see its slots and steps.')}</p>`;
    return;
  }
  const cur = stepOf(state.sel);
  drawer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 6px">
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted)">${cur.slot ? `SLOT ${cur.n} OF ${SLOT_COUNT}` : 'OTHER STEP'}</span>
          <h2 class="section-title" style="font-size: 24px">${esc(cur.name)}</h2>
          <span style="font-size: 13px; color: var(--text)">${esc(subOf(cur))}</span>
        </div>${entryListHtml(cur.entries, cur.id, canEdit)}${addBody(cur)}${cur.kind === 'rite' ? riteNoteBody(cur) : ''}`;
  mountPicker();
}

/**
 * Draws the song picker into the drawer for the selected row, on the Holy Mass tab and the row's own category (the Kyrie row opens on Kyrie).
 * Add puts a song at the end of the row; pressing Added takes it out again.
 */
function mountPicker() {
  const id = state.sel;
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

function render() {
  renderHeader();
  renderSteps();
  renderDrawer();
}

/** Changes what the selected row holds in this session. Nothing is saved until Save plan. */
function changeSegments(segments) {
  state.segments = segments;
  state.dirty = true;
  state.error = '';
  renderHeader();
  renderSteps();
  renderDrawer();
}

/** Redraws for a new language, keeping anything half-typed in the drawer. */
function renderKeepingDraft() {
  const typed = document.getElementById('typed-text')?.value;
  const note = document.getElementById('rite-note')?.value;
  render();
  const typedBox = document.getElementById('typed-text');
  if (typedBox && typed !== undefined) typedBox.value = typed;
  const noteBox = document.getElementById('rite-note');
  if (noteBox && note !== undefined) noteBox.value = note;
}

function openHub(mode) {
  const row = stepOf(state.sel);
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
      render();
    },
    onUse: (entry) => changeSegments(withEntry(state.segments, row.id, { contentHubId: entry.id, text: entry.title, contentType: 'hub_item' })),
  });
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
    state = fresh({ ...massFromItems(plan.items, ROWS), language: plan.language, massTime: plan.massTime });
    resetSongPickers();
  } catch (err) {
    if (plan) state.error = err.message;
    else state = { ...fresh(null), error: err.message };
  }
  render();
}

async function save() {
  if (!plan || !canEdit || state.saving) return;
  state.saving = true;
  state.error = '';
  renderHeader();
  try {
    const details = { language: state.language, massTime: state.massTime || null, contentHubItems: state.contentHubItems };
    const response = await savePlan(savePayload(plan, massToItems(state, ROWS), details));
    Object.assign(plan, details);
    plan.updatedAt = response.savedAt;
    state.dirty = false;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.saving = false;
    renderHeader();
  }
}

document.querySelector('main').addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.dataset.pick) {
    state.sel = target.dataset.pick;
    state.noteSaved = false;
    const picked = stepOf(state.sel);
    state.mode = picked.kind === 'song' ? 'list' : 'text';
    renderSteps();
    renderDrawer();
    // On a phone the drawer sits below the steps, so bring it into view.
    if (window.matchMedia('(max-width: 820px)').matches) document.getElementById('drawer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    // A song row's drawer opens on its song list, already on the row's category (see mountPicker).
    void songWatch.check();
  } else if (target.dataset.lang) {
    if (target.dataset.lang === state.language) return;
    setDetail({ language: target.dataset.lang });
    renderKeepingDraft();
    document.querySelector(`[data-lang="${target.dataset.lang}"]`)?.focus();
  } else if (target.dataset.toggle) {
    collapsed = collapsed.includes(target.dataset.toggle) ? collapsed.filter((g) => g !== target.dataset.toggle) : [...collapsed, target.dataset.toggle];
    writeCollapsed(collapsed);
    renderSteps();
  } else if (target.dataset.mode) {
    state.mode = target.dataset.mode;
    renderDrawer();
  } else if (target.dataset.removeEntry !== undefined) {
    changeSegments(withoutEntry(state.segments, target.dataset.for, Number(target.dataset.removeEntry)));
  } else if (target.dataset.hub) {
    openHub(target.dataset.hub);
  } else if (target.dataset.action === 'use-text') {
    const text = document.getElementById('typed-text').value.trim();
    if (text) changeSegments(withEntry(state.segments, state.sel, { text }));
  } else if (target.dataset.action === 'save-note') {
    state.notes[state.sel] = document.getElementById('rite-note').value.trim();
    state.noteSaved = true;
    state.dirty = true;
    renderHeader();
    renderDrawer();
  } else if (target.id === 'discard') {
    if (planId) void load();
  } else if (target.id === 'save') {
    void save();
  }
});

// The Mass time: a time from the schedule, none, or "Other time…", which shows a time box for a time not on the schedule.
document.getElementById('mass-time').addEventListener('change', (event) => {
  const value = event.target.value;
  if (value === 'other') {
    state.otherTime = true;
    renderDetails();
    document.getElementById('mass-time-other').focus();
    return;
  }
  setDetail({ massTime: value, otherTime: false });
  document.getElementById('mass-time-other').value = '';
  renderHeader();
});

document.getElementById('mass-time-other').addEventListener('change', (event) => {
  const value = event.target.value;
  if (!isMassTime(value)) return;
  setDetail({ massTime: value, otherTime: false });
  event.target.value = '';
  renderHeader();
});

// Arrow keys move between the languages, as in any radio group.
document.getElementById('language').addEventListener('keydown', (event) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!step || !plan || !canEdit) return;
  event.preventDefault();
  const codes = MASS_LANGUAGES.map((l) => l.code);
  const next = codes[(codes.indexOf(state.language) + step + codes.length) % codes.length];
  setDetail({ language: next });
  renderKeepingDraft();
  document.querySelector(`[data-lang="${next}"]`)?.focus();
});

// The key a song is sung in for this plan. The song in the church's list keeps its own key.
document.getElementById('drawer').addEventListener('change', (event) => {
  if (event.target.dataset.role !== 'entry-key') return;
  changeSegments(withEntryKey(state.segments, event.target.dataset.for, Number(event.target.dataset.index), event.target.value));
});

const user = await guard();
if (user) {
  if (planId) await load();
  else render();
}
