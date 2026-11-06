// Holy Mass plan editor: the 17 numbered slots of the Holy Mass in five collapsible sections, then the other steps of each section, and the
// drawer that fills the selected row. The structure comes from the template and mass-slots.js. What
// is chosen, typed and noted comes from the saved plan on the server, and Save sends the whole plan in one request. A song step
// takes a song from the church's list or a typed note; a reading takes a reference; a rite takes an optional note for the operator.
import { LANGUAGE_CODE, MASS_PLAN } from './sample-data.js';
import { SLOT_COUNT } from './mass-slots.js';
import { MASS_LANGUAGES, languageName, massLanguageOf, sectionName, slotName } from './mass-language.js';
import { isMassTime, massTimesFor, timeLabel } from './mass-schedule.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { getPlan, listSongs, savePlan } from './plan-api.js';
import {
  NO_SONGS,
  VIEW_ONLY,
  dateLabel,
  massSections,
  massFromItems,
  massToItems,
  savePayload,
  songsForEditor,
  saveButton,
  songOptions,
  statusText,
  titleOf,
  withChoice,
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
let collapsed = readCollapsed();
let state = fresh(null);

function fresh(saved) {
  return {
    sel: FIRST_ROW,
    mode: 'list',
    allSongs: false,
    query: '',
    segments: saved?.segments ?? {},
    notes: saved?.notes ?? {},
    extra: saved?.extra ?? [],
    meta: saved?.meta ?? {},
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
  const seg = state.segments[id] ?? {};
  return {
    ...base,
    // The slot's name in the plan's language; `english` is its English name, shown beneath when the two differ.
    name: slotName(base, state.language),
    english: base.name,
    value: seg.songId ? titleOf(songs, seg.songId) : (seg.text ?? ''),
    src: seg.songId ? 'list' : seg.text ? 'text' : '',
  };
}

const subOf = (r) => {
  const kind = r.kind === 'song' ? 'Song · ' + r.category : r.kind === 'reading' ? 'Reading' : r.kind === 'slot-text' ? 'Text' : 'Rite';
  const withHint = r.hint ? kind + ' · ' + r.hint : kind;
  return r.english && r.english !== r.name ? r.english + ' · ' + withHint : withHint;
};

/** The HTML lang of the plan's language, so a screen reader reads the Tagalog and Cebuano names in their own voice. */
const HTML_LANG = { EN: 'en', TL: 'tl', CEB: 'ceb' };

const BTN_PRIMARY = 'border:0;background:#ecc98a;color:#1c070d';
const BTN_QUIET = 'border:1px solid #6e2a3e;background:#2a0c18;color:#f7eef0';
const TAB_ON = 'flex:1;height:40px;border-radius:10px;border:1px solid #ecc98a;background:#2a0c18;color:#ecc98a;font-size:14px;font-weight:700;cursor:pointer';
const TAB_OFF = 'flex:1;height:40px;border-radius:10px;border:1px solid #3a1523;background:transparent;color:#dbb3bf;font-size:14px;font-weight:600;cursor:pointer';
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
    return `<button type="button" role="radio" data-lang="${l.code}" aria-checked="${on}" tabindex="${on ? 0 : -1}" ${locked ? 'disabled' : ''} style="flex:1;min-width:0;height:40px;padding:0 10px;border-radius:9px;font-size:14px;cursor:pointer;${on ? 'border:1px solid #ecc98a;background:#2a0c18;color:#ecc98a;font-weight:700' : 'border:1px solid transparent;background:transparent;color:#dbb3bf;font-weight:600'}">${esc(l.name)}</button>`;
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
  if (r.kind !== 'rite') {
    let label; let fg; let bg;
    if (r.value) {
      label = r.src === 'list' ? 'From list' : 'Typed note';
      fg = r.src === 'list' ? '#8fd9ae' : '#ecc98a';
      bg = r.src === 'list' ? '#12301f' : '#2a1b0c';
    } else if (r.optional) {
      label = 'Optional'; fg = '#dbb3bf'; bg = '#2a1019';
    } else {
      label = r.kind === 'song' ? 'Needs a song' : isText ? 'Needs text' : 'Needs a reading'; fg = '#f2bd6b'; bg = '#33240c';
    }
    chip = `<span style="display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap;color:${fg};background:${bg}">${label}</span>`;
  }
  const filled = r.kind !== 'rite' && !!r.value;
  const needs = r.kind !== 'rite' && !r.value && !r.optional;
  const btnLabel = r.kind === 'rite' ? 'Add note' : r.value ? 'Change' : isText ? 'Type text' : 'Choose';
  const number = r.slot ? String(r.slot).padStart(2, '0') : '•';
  return `
              <div class="plan-row" data-row="${esc(r.id)}" ${r.slot ? `data-slot="${r.slot}"` : ''} style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 18px;border-bottom:1px solid #2b1019;${selected ? 'background:#2a0c18;box-shadow:inset 0 0 0 1px #ecc98a' : 'background:transparent'}">
                <span style="flex: none; width: 28px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: ${r.slot ? '#ecc98a' : '#b48d99'}"><span class="sr-only">${r.slot ? 'Slot ' : 'Step '}</span>${number}</span>
                <span style="flex: 1 1 190px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size: 15px; font-weight: 700">${esc(r.name)}</span>
                  <span style="font-size: 12px; color: #b48d99">${esc(subOf(r))}</span>
                </span>
                <span style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size:14px;line-height:1.4;${filled ? 'color:#f7eef0;font-weight:600' : 'color:#b48d99'}">${r.kind === 'rite' ? '' : esc(r.value || 'Nothing chosen yet')}</span>
                </span>
                <span style="flex: 0 0 auto; display: inline-flex">${chip}</span>
                <button type="button" data-pick="${esc(r.id)}" aria-pressed="${selected}" ${DISABLED(canEdit)} style="height:36px;padding:0 14px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;${needs ? BTN_PRIMARY : BTN_QUIET}">${btnLabel}</button>
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
          ? `<div style="padding: 10px 18px 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: #b48d99; background: #170811">OTHER STEPS</div>` + otherRows.map((r) => rowHtml(stepOf(r.id))).join('')
          : '')
      : '';
    return `
          <div data-section="${section.group}" style="border: 1px solid #3a1523; border-radius: 16px; background: #1b0a13; overflow: hidden">
            <h2 style="margin: 0; background: #22101a; border-bottom: ${open ? '1px solid #3a1523' : '0'}">
              <button type="button" data-toggle="${section.group}" aria-expanded="${open}" aria-controls="section-${section.group}" style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; border: 0; background: transparent; cursor: pointer; text-align: left">
                <span style="display: inline-flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: #ecc98a">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform: rotate(${open ? 90 : 0}deg)"><path d="m9 6 6 6-6 6"/></svg>
                  ${section.number} · ${esc(sectionName(section, state.language).toUpperCase())}
                </span>
                <span style="font-size: 12px; font-weight: 600; color: #b48d99">${filled} of ${slotRows.length} slots${otherRows.length ? ' · ' + otherRows.length + ' other' : ''}</span>
              </button>
            </h2>
            <div id="section-${section.group}" ${open ? '' : 'hidden'}>${body}</div>
          </div>`;
  }).join('');
}

function songBody() {
  const list = state.mode === 'list';
  const tabs = `
            <div role="tablist" aria-label="How to fill this row" style="display: flex; gap: 8px">
              <button type="button" role="tab" data-mode="list" aria-selected="${list}" style="${list ? TAB_ON : TAB_OFF}">Song list</button>
              <button type="button" role="tab" data-mode="text" aria-selected="${!list}" style="${list ? TAB_OFF : TAB_ON}">Type text</button>
            </div>`;
  if (list) {
    const cur = stepOf(state.sel);
    return `
          <div style="display: flex; flex-direction: column; gap: 14px">${tabs}
              <div style="display: flex; flex-direction: column; gap: 12px">
                <label style="display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; border: 1px solid #55202f; border-radius: 10px; background: #150610">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b48d99" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                  <input id="song-search" type="search" aria-label="Search songs" placeholder="Search songs" value="${esc(state.query)}" ${DISABLED(canEdit)} style="flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: #f7eef0; font-size: 14px">
                </label>
                <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px">
                  <span style="font-size: 13px; color: #dbb3bf">${state.allSongs ? 'All songs' : 'Category: ' + esc(cur.category)}</span>
                  <button type="button" data-action="toggle-all" style="height:32px;padding:0 12px;border-radius:9px;border:1px solid #3a1523;background:transparent;color:#ecc98a;font-size:13px;font-weight:600;cursor:pointer">${state.allSongs ? 'Show this category' : 'Show all songs'}</button>
                </div>
                <div id="song-options" style="display: flex; flex-direction: column; border: 1px solid #3a1523; border-radius: 12px; overflow: hidden"></div>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #b48d99">The list comes from the church laptop. Add or edit songs in the desktop app.</p>
              </div>
          </div>`;
  }
  return `
          <div style="display: flex; flex-direction: column; gap: 14px">${tabs}
              <div style="display: flex; flex-direction: column; gap: 12px">
                <label style="display: flex; flex-direction: column; gap: 8px">
                  <span style="font-size: 13px; font-weight: 600; color: #dbb3bf">Song title or a short note</span>
                  <textarea id="typed-text" rows="5" placeholder="e.g. Psalm 24 setting, sung by the cantor" ${DISABLED(canEdit)} style="padding: 12px 14px; border-radius: 10px; border: 1px solid #55202f; background: #150610; color: #f7eef0; font-size: 14px; line-height: 1.5; resize: vertical; outline: 0"></textarea>
                </label>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #b48d99">Typed text is a note for the operator on the laptop. It does not appear on the projector.</p>
                <button type="button" data-action="use-text" ${DISABLED(canEdit)} style="height: 44px; border-radius: 10px; border: 0; background: #ecc98a; color: #1c070d; font-size: 14px; font-weight: 700; cursor: pointer">Use this text</button>
              </div>
          </div>`;
}

function readingBody(cur) {
  return `
          <div style="display: flex; flex-direction: column; gap: 14px">
            <div style="display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 12px; background: #150610; border: 1px solid #3a1523">
              <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.1em; color: #b48d99">CURRENT</span>
              <span style="font-size: 15px; font-weight: 600">${esc(cur.value || 'Nothing entered yet')}</span>
            </div>
            <label style="display: flex; flex-direction: column; gap: 8px">
              <span style="font-size: 13px; font-weight: 600; color: #dbb3bf">Reading reference</span>
              <input id="reading-ref" placeholder="e.g. Matthew 5:1-12a" ${DISABLED(canEdit)} style="height: 46px; padding: 0 14px; border-radius: 10px; border: 1px solid #55202f; background: #150610; color: #f7eef0; font-size: 14px; outline: 0">
            </label>
            <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #b48d99">The web planner takes the reference as a note. To show the Bible text on the projector, pick the verses in the desktop app.</p>
            <button type="button" data-action="use-ref" ${DISABLED(canEdit)} style="height: 44px; border-radius: 10px; border: 0; background: #ecc98a; color: #1c070d; font-size: 14px; font-weight: 700; cursor: pointer">Use this reference</button>
          </div>`;
}

/** A spoken slot (I Confess, Prayer of the Faithful …): its words are typed. */
function slotTextBody(cur) {
  return `
          <div style="display: flex; flex-direction: column; gap: 14px">
            <label style="display: flex; flex-direction: column; gap: 8px">
              <span style="font-size: 13px; font-weight: 600; color: #dbb3bf">Words or a short note for this part</span>
              <textarea id="typed-text" rows="4" placeholder="e.g. Lord, hear our prayer" ${DISABLED(canEdit)} style="padding: 12px 14px; border-radius: 10px; border: 1px solid #55202f; background: #150610; color: #f7eef0; font-size: 14px; line-height: 1.5; resize: vertical; outline: 0">${esc(cur.value)}</textarea>
            </label>
            <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #b48d99">Typed text is a note for the operator on the church laptop. It does not appear on the projector.</p>
            <button type="button" data-action="use-text" ${DISABLED(canEdit)} style="height: 44px; border-radius: 10px; border: 0; background: #ecc98a; color: #1c070d; font-size: 14px; font-weight: 700; cursor: pointer">Use this text</button>
          </div>`;
}

function riteBody(cur) {
  return `
          <div style="display: flex; flex-direction: column; gap: 14px">
            <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #dbb3bf">This part of the Holy Mass needs no song or reading. You can leave a note for the operator.</p>
            <label style="display: flex; flex-direction: column; gap: 8px">
              <span style="font-size: 13px; font-weight: 600; color: #dbb3bf">Operator note (optional)</span>
              <textarea id="rite-note" rows="4" placeholder="e.g. Incense at the Gospel" ${DISABLED(canEdit)} style="padding: 12px 14px; border-radius: 10px; border: 1px solid #55202f; background: #150610; color: #f7eef0; font-size: 14px; line-height: 1.5; resize: vertical; outline: 0">${esc(state.notes[cur.id] ?? '')}</textarea>
            </label>
            <button type="button" data-action="save-note" ${DISABLED(canEdit)} style="height: 44px; border-radius: 10px; border: 1px solid #6e2a3e; background: #2a0c18; color: #f7eef0; font-size: 14px; font-weight: 600; cursor: pointer">${state.noteSaved ? 'Note saved' : 'Save note'}</button>
          </div>`;
}

function renderDrawer() {
  const drawer = document.getElementById('drawer');
  if (!plan) {
    drawer.innerHTML = `<p style="margin: 0; font-size: 14px; line-height: 1.5; color: #dbb3bf">${esc(state.error || 'Open a plan from your plan list to see its slots and steps.')}</p>`;
    return;
  }
  const cur = stepOf(state.sel);
  const body = cur.kind === 'song' ? songBody() : cur.kind === 'reading' ? readingBody(cur) : cur.kind === 'slot-text' ? slotTextBody(cur) : riteBody(cur);
  drawer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 6px">
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #b48d99">${cur.slot ? `SLOT ${cur.n} OF ${SLOT_COUNT}` : 'OTHER STEP'}</span>
          <h2 style="margin: 0; font-size: 24px; font-weight: 800; line-height: 1.15">${esc(cur.name)}</h2>
          <span style="font-size: 13px; color: #dbb3bf">${esc(subOf(cur))}</span>
        </div>${body}`;
  renderOptions();
}

/** The songs offered for the selected step: its category, or all songs, narrowed by the search box. */
function renderOptions() {
  const box = document.getElementById('song-options');
  if (!box) return;
  const picker = songs.filter((s) => !s.removed);
  if (picker.length === 0) {
    box.innerHTML = `<div style="padding: 18px 14px; font-size: 13px; color: #b48d99; background: #150610">${esc(NO_SONGS)}</div>`;
    return;
  }
  const cur = stepOf(state.sel);
  const shown = songOptions(picker, { category: cur.category, allSongs: state.allSongs, query: state.query });
  if (shown.length === 0) {
    const message = state.query.trim() ? 'No songs match the search. Clear it, show all songs, or type text.' : 'No songs in this category yet. Show all songs, or type text.';
    box.innerHTML = `<div style="padding: 18px 14px; font-size: 13px; color: #b48d99; background: #150610">${message}</div>`;
    return;
  }
  box.innerHTML = shown.map((song) => {
    const chosen = state.segments[cur.id]?.songId === song.id;
    const key = song.key ? ` · Key ${esc(song.key)}` : '';
    return `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #2b1019; background: #150610">
                      <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
                        <span style="font-size: 14px; font-weight: 700">${esc(song.title)}</span>
                        <span style="font-size: 12px; color: #b48d99">${state.allSongs ? esc(song.category) + ' · ' : ''}${LANGUAGE_CODE[song.language] ?? esc(song.language)}${key}</span>
                      </span>
                      <button type="button" data-song="${esc(song.id)}" aria-pressed="${chosen}" ${DISABLED(canEdit)} style="height:34px;padding:0 14px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;${chosen ? 'border:1px solid #8fd9ae;background:#12301f;color:#8fd9ae' : BTN_QUIET}">${chosen ? 'Selected' : 'Select'}</button>
                    </div>`;
  }).join('');
}

function render() {
  renderHeader();
  renderSteps();
  renderDrawer();
}

/** Changes the selected step's choice in this session. Nothing is saved until Save plan. */
function choose(patch) {
  state.segments = withChoice(state.segments, state.sel, patch);
  state.dirty = true;
  state.error = '';
  renderHeader();
  renderSteps();
}

/** Reads the saved plan and the song list from the server. A failure keeps what was on screen and shows the plain message. */
async function load() {
  try {
    const [saved, list] = await Promise.all([getPlan(planId), listSongs()]);
    plan = saved.plan;
    canEdit = saved.canEdit;
    songs = songsForEditor(list.songs, saved.songs);
    state = fresh({ ...massFromItems(plan.items, ROWS), language: plan.language, massTime: plan.massTime });
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
    const details = { language: state.language, massTime: state.massTime || null };
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
    state.query = '';
    state.noteSaved = false;
    renderSteps();
    renderDrawer();
    // On a phone the drawer sits below the steps, so bring it into view.
    if (window.matchMedia('(max-width: 820px)').matches) document.getElementById('drawer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (target.dataset.lang) {
    if (target.dataset.lang === state.language) return;
    setDetail({ language: target.dataset.lang });
    render();
    document.querySelector(`[data-lang="${target.dataset.lang}"]`)?.focus();
  } else if (target.dataset.toggle) {
    collapsed = collapsed.includes(target.dataset.toggle) ? collapsed.filter((g) => g !== target.dataset.toggle) : [...collapsed, target.dataset.toggle];
    writeCollapsed(collapsed);
    renderSteps();
  } else if (target.dataset.mode) {
    state.mode = target.dataset.mode;
    renderDrawer();
  } else if (target.dataset.song) {
    choose({ songId: target.dataset.song, text: null });
    renderOptions();
  } else if (target.dataset.action === 'toggle-all') {
    state.allSongs = !state.allSongs;
    renderDrawer();
  } else if (target.dataset.action === 'use-text') {
    const text = document.getElementById('typed-text').value.trim();
    if (text) choose({ text, songId: null });
  } else if (target.dataset.action === 'use-ref') {
    const ref = document.getElementById('reading-ref').value.trim();
    if (ref) {
      choose({ text: ref, songId: null });
      renderDrawer();
    }
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
  render();
  document.querySelector(`[data-lang="${next}"]`)?.focus();
});

document.getElementById('drawer').addEventListener('input', (event) => {
  if (event.target.id !== 'song-search') return;
  state.query = event.target.value;
  renderOptions();
});

const user = await guard();
if (user) {
  if (planId) await load();
  else render();
}
