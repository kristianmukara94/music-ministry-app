// Holy Mass plan editor: the 17 numbered slots of the Holy Mass in five collapsible sections, then the other steps of each section, and the
// drawer that fills the selected row. The structure comes from the template and mass-slots.js. What
// is chosen, typed and noted comes from the saved plan on the server, and Save sends the whole plan in one request. Any row can hold any song
// from the church's list, typed text and Content Hub entries, and more than one of them. A rite also takes an optional note for the operator.
// Songs are chosen in the song picker, which opens on Holy Mass and on the row's own category. Every row also takes a note for the musicians and
// the operator (key, capo, choir cue), can be cleared in one press, and has its items put in order with Move up and Move down.
//
// The page is the Planner's Plan Editor tab: the Planner header sits above it, the title is edited in place, the badges show the date, the
// template and how many of the slots the day needs are filled, and Duplicate Plan and Delete Plan sit beside Save.
import { MASS_PLAN } from './sample-data.js';
import { SLOT_COUNT } from './mass-slots.js';
import { MASS_LANGUAGES, languageName, massLanguageOf, sectionName, slotName } from './mass-language.js';
import { isScheduleLanguage, normalizeMassLanguage, planLanguageForSchedule, scheduleLanguageForPlan, schedulesOn } from './holy-mass-schedule.js';
import { asSchedulePlan, conflictIn, mountScheduleFields, onOpenExisting, openExistingHref, showConflict, switcherHtml } from './schedule-ui.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { getPlan, listPlans, listSongs, savePlan, watchSongList } from './plan-api.js';
import { calendarHref, lastPlan, mountPlannerHeader, newPlanFlowHref, rememberPlan } from './planner-header.js';
import { massProgress } from './planner-calendar.js';
import { deletePlanById, deleteWarning, duplicatePlanById } from './plan-actions.js';
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
  withEntryMoved,
  withoutEntry,
  withoutEntries,
  editorPathFor,
  checkPlanName,
  shortDate,
} from './plan-model.js';

mountSidebar();

const ROOT = document.documentElement.dataset.base ?? '';
const header = { setSubtitle() {} };
const titleInput = document.getElementById('plan-title');
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
// The church's other Holy Mass plans on this plan's day (from the plan list), for the switcher and the taken-time warning.
let dayPlans = [];

// The Holy Mass time and language, as the laptop asks for them. English, Tagalog and Cebuano also set the readings and responses language,
// as they do on the laptop; another language leaves it as chosen.
const scheduleFields = mountScheduleFields(document.getElementById('schedule-fields'), {
  id: 'plan-schedule',
  disabled: true,
  onChange: ({ massTime, massLanguage }) => {
    if (!plan || !canEdit) return;
    const texts = planLanguageForSchedule(massLanguage);
    const relabel = texts && texts !== state.language;
    setDetail({ massTime, massLanguage, ...(relabel ? { language: texts } : {}) });
    if (relabel) renderKeepingDraft();
    else renderHeader();
  },
});

function fresh(saved) {
  return {
    sel: FIRST_ROW,
    mode: 'list',
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
  const when = plan ? [dateLabel(plan.date), state.massTime].filter(Boolean).join(' · ') : '';
  document.getElementById('eyebrow').textContent = plan ? `HOLY MASS PLAN · ${when} · ${languageName(state.language).toUpperCase()}` : 'HOLY MASS PLAN';
  // The title is edited in place; it is not redrawn while it is being typed in.
  if (document.activeElement !== titleInput) titleInput.value = plan ? state.name : 'No plan open';
  titleInput.disabled = !plan || !canEdit;
  document.getElementById('date-badge').textContent = plan ? shortDate(plan.date) : '';
  const progress = plan ? massProgress({ filledSlots: filledSlotNumbers() }, plan.date) : null;
  const fill = document.getElementById('fill-badge');
  fill.textContent = progress ? `${progress.done} / ${progress.total} slots filled` : '';
  fill.classList.toggle('is-ready', Boolean(progress?.ready));
  fill.title = 'The slots this day needs, as the laptop counts them: every slot that is not optional, and on a weekday not the parts said only on Sundays and solemnities.';
  document.getElementById('duplicate').disabled = !plan || !canEdit || state.saving;
  document.getElementById('delete').disabled = !plan || !canEdit || state.saving;
  header.setSubtitle(plan ? [state.name || plan.name, shortDate(plan.date), state.massTime].filter(Boolean).join(' · ') : 'Open a plan from a calendar to edit it.');
  document.title = `${plan ? state.name || plan.name : 'Holy Mass plan'} · APCCMMA Web Planner`;
  document.getElementById('status').textContent = plan ? statusText({ dirty: state.dirty, error: state.error }) : state.error || 'Not loaded';
  document.getElementById('songs-label').textContent = `${songSteps.filter((s) => s.value).length} of ${songSteps.length} chosen`;
  document.getElementById('readings-label').textContent = `${readings.filter((s) => s.value).length} of ${readings.length} entered`;
  const slotsFilled = steps.filter((r) => r.slot && (r.value || state.notes[r.id])).length;
  document.getElementById('steps-label').textContent = `${slotsFilled} of ${SLOT_COUNT} slots · ${OTHER} other steps`;
  const save = saveButton(state.saving);
  const saveEl = document.getElementById('save');
  // A Holy Mass time another plan on the day already has is not saved: the warning beside the schedule offers Open Existing.
  saveEl.disabled = !plan || !canEdit || save.disabled || takenBy() !== null;
  saveEl.textContent = save.label;
  document.getElementById('discard').disabled = !plan || state.saving;
  const note = document.getElementById('view-only');
  note.textContent = VIEW_ONLY;
  note.hidden = !plan || canEdit;
  renderDetails();
}

/** The slot numbers this plan has an item in, as the server and the laptop count them: a slot with a song, text or a note. */
function filledSlotNumbers() {
  return ROWS.filter((r) => r.slot && (slotEntries(state.segments[r.id]).length || (state.notes[r.id] ?? '').trim())).map((r) => r.slot);
}

/** The Holy Mass already at this plan's typed time on its day, or null. */
function takenBy() {
  return plan ? conflictIn(dayPlans, plan.date, state.massTime, plan.id) : null;
}

/** The header's switcher: the day's Holy Masses in the order they are celebrated, this one marked with its time as typed, then + Add Time. */
function renderSwitcher() {
  const nav = document.getElementById('schedule-switcher');
  if (!plan) {
    nav.innerHTML = '';
    return;
  }
  const others = dayPlans.filter((p) => p.id !== plan.id);
  const day = schedulesOn([...others, asSchedulePlan({ ...plan, massTime: state.massTime, massLanguage: state.massLanguage })], plan.date);
  const root = document.documentElement.dataset.base ?? '';
  nav.innerHTML = switcherHtml(day, plan.id, {
    pathOf: (p) => `${root}${editorPathFor({ id: p.id, kind: 'mass' })}`,
    addHref: canEdit ? newPlanFlowHref({ kind: 'mass', date: plan.date }, root) : null,
  });
}

/** The plan's details card: the schedule (time and language), the taken-time warning, and the readings language switch. */
function renderDetails() {
  const locked = !plan || !canEdit;
  document.getElementById('language').innerHTML = MASS_LANGUAGES.map((l) => {
    const on = l.code === state.language;
    return `<button type="button" role="radio" data-lang="${l.code}" aria-checked="${on}" tabindex="${on ? 0 : -1}" ${locked ? 'disabled' : ''} style="flex:1;min-width:0;height:40px;padding:0 10px;border-radius:8px;font-size:14px;cursor:pointer;${on ? 'border:1px solid var(--bc-gold);background:var(--bc-gold);color:var(--bc-on-gold);font-weight:800' : 'border:1px solid transparent;background:transparent;color:var(--bc-text);font-weight:600'}">${esc(l.name)}</button>`;
  }).join('');
  showConflict(document.getElementById('schedule-conflict'), takenBy());
  renderSwitcher();

  document.getElementById('details-note').textContent = plan
    ? `Slot names are shown in ${languageName(state.language)}${state.language === 'EN' ? '' : ', with the English name beneath'}. Song titles and typed text are not translated.`
    : '';
  document.getElementById('steps').setAttribute('lang', HTML_LANG[state.language]);
  document.getElementById('drawer').setAttribute('lang', HTML_LANG[state.language]);
}

/**
 * Sets the readings and responses language. A Holy Mass whose schedule language is English, Tagalog or Cebuano is relabelled to match, as on
 * the laptop; the parish's own language is left as typed.
 */
function chooseTextsLanguage(code) {
  const relabel = isScheduleLanguage(normalizeMassLanguage(state.massLanguage)) ? scheduleLanguageForPlan(code) : '';
  setDetail({ language: code, ...(relabel ? { massLanguage: relabel } : {}) });
  if (relabel) scheduleFields.set({ massTime: state.massTime, massLanguage: relabel });
  renderKeepingDraft();
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
                  ${state.notes[r.id] ? `<span class="slot-note-line"><span class="sr-only">Note: </span>${esc(state.notes[r.id])}</span>` : ''}
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

/** The row's note for the musicians and the operator (key, capo, choir cue), then Clear slot when the row holds anything. */
function slotNoteBody(cur) {
  const holds = cur.entries.length > 0 || Boolean((state.notes[cur.id] ?? '').trim());
  const placeholder = cur.kind === 'song' ? 'e.g. Capo 2, choir sings the second verse' : cur.kind === 'rite' ? 'e.g. Incense at the Gospel' : 'e.g. Read by the youth lector';
  return `
          <div style="display: flex; flex-direction: column; gap: 14px; padding-top: 14px; border-top: 1px solid var(--border)">
            <label style="display: flex; flex-direction: column; gap: 8px">
              <span style="font-size: 13px; font-weight: 600; color: var(--text)">Slot note / musician cue (optional)</span>
              <textarea id="rite-note" rows="3" maxlength="1000" placeholder="${esc(placeholder)}" ${DISABLED(canEdit)} style="padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); font-size: 14px; line-height: 1.5; resize: vertical; outline: 0">${esc(state.notes[cur.id] ?? '')}</textarea>
            </label>
            <div style="display: flex; flex-wrap: wrap; gap: 10px">
              <button type="button" data-action="save-note" ${DISABLED(canEdit)} class="btn-quiet" style="flex: 1 1 140px; height: 44px; font-size: 14px; font-weight: 600">${state.noteSaved ? 'Note saved' : 'Save note'}</button>
              ${holds ? `<button type="button" data-action="clear-slot" ${DISABLED(canEdit)} class="btn-quiet is-danger" style="flex: 1 1 140px; height: 44px; font-size: 14px; font-weight: 600">${cur.slot ? 'Clear slot' : 'Clear step'}</button>` : ''}
            </div>
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
        </div>${entryListHtml(cur.entries, cur.id, canEdit)}${addBody(cur)}${slotNoteBody(cur)}`;
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
    const [saved, list, all] = await Promise.all([getPlan(planId), listSongs(), listPlans().catch(() => null)]);
    // The other Holy Masses on this plan's day, for the switcher and the taken-time warning. Without the list, the server still checks.
    dayPlans = all ? all.plans.filter((p) => p.kind !== 'pw' && p.liturgical_date === saved.plan.date).map(asSchedulePlan) : [];
    plan = saved.plan;
    canEdit = saved.canEdit;
    songs = songsForEditor(list.songs, saved.songs);
    planSongs = saved.songs;
    songWatch.seen(list);
    state = fresh({ ...massFromItems(plan.items, ROWS), language: plan.language, massTime: plan.massTime, massLanguage: plan.massLanguage });
    rememberPlan({ id: plan.id, kind: 'mass', name: plan.name, date: plan.date });
    mountHeader();
    scheduleFields.set({ massTime: state.massTime, massLanguage: state.massLanguage });
    scheduleFields.setDisabled(!canEdit);
    resetSongPickers();
  } catch (err) {
    if (plan) state.error = err.message;
    else state = { ...fresh(null), error: err.message };
  }
  render();
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
    chooseTextsLanguage(target.dataset.lang);
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
  } else if (target.dataset.moveEntry !== undefined) {
    const from = Number(target.dataset.moveEntry);
    const to = from + Number(target.dataset.delta);
    changeSegments(withEntryMoved(state.segments, target.dataset.for, from, to));
    document.querySelector(`[data-move-entry="${to}"][data-delta="${target.dataset.delta}"]:not(:disabled), [data-move-entry="${to}"]:not(:disabled)`)?.focus();
  } else if (target.dataset.action === 'clear-slot') {
    const row = stepOf(state.sel);
    if (!window.confirm(`Clear ${row.name}? Its songs, text and note are taken out of this plan.`)) return;
    delete state.notes[state.sel];
    changeSegments(withoutEntries(state.segments, state.sel));
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
  } else if (target.id === 'duplicate') {
    void duplicate();
  } else if (target.id === 'delete') {
    askDelete();
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

// Ctrl + S (Cmd + S on a Mac) saves the plan, as on the laptop.
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
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
    editorPlan: plan ? { id: plan.id, kind: 'mass', name: plan.name, date: plan.date } : lastPlan(),
    canCreate: canEdit,
    newPlan: newPlanFlowHref({ kind: 'mass', date: plan?.date ?? '' }, ROOT),
  }));
  renderHeader();
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

// The key a song is sung in for this plan. The song in the church's list keeps its own key.
document.getElementById('drawer').addEventListener('change', (event) => {
  if (event.target.dataset.role !== 'entry-key') return;
  changeSegments(withEntryKey(state.segments, event.target.dataset.for, Number(event.target.dataset.index), event.target.value));
});

const user = await guard();
if (user) {
  mountHeader();
  if (planId) await load();
  else render();
}
