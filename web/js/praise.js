// Praise & Worship editor: the segments with their minute steppers, the readiness panel, and the printed setlist. The segments are the church
// laptop's own lineup (lineup-templates.js): the same twelve slots, keys and groups, so a plan fills the same slots on both. A plan the website's
// earlier editor laid out keeps that layout. Changing a segment's minutes updates the section totals, the total time, the time bars and the
// readiness checks without redrawing the list, so what is being typed in an open panel stays. Any segment takes any song from the church's list,
// typed text and Content Hub entries, and more than one of them, through the panel that opens under it. Songs are chosen in the song picker, which
// opens on Praise & Worship and on the segment's own category. The minutes and what is chosen come from the saved plan on the server. Every value
// written into markup goes through esc().
import { PRAISE_PLAN } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { getPlan, listSongs, savePlan, watchSongList } from './plan-api.js';
import { usedHubIds } from './content-hub.js';
import { entryListHtml, entrySummaryHtml, hubButtonsHtml, openContentHub } from './slot-ui.js';
import { mountSongPicker, resetSongPickers } from './song-picker.js';
import {
  CONTENT_TYPES,
  MAX_MINUTES,
  MIN_MINUTES,
  PRAISE_TEMPLATE,
  VIEW_ONLY,
  dateLabel,
  durationLabel,
  praiseBreakdown,
  praiseFromItems,
  praiseRow,
  praiseTemplateFor,
  praiseToItems,
  savePayload,
  setlistEntries,
  songsForEditor,
  praiseSegments,
  saveButton,
  slotEntries,
  statusText,
  withChoice,
  withEntry,
  withEntryKey,
  withoutEntry,
} from './plan-model.js';

mountSidebar();

const planId = new URLSearchParams(location.search).get('id');
// The laptop's lineup, until a plan the earlier editor laid out is loaded (see load).
let TEMPLATE = PRAISE_TEMPLATE;
let SEGMENTS = praiseSegments(TEMPLATE);

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
let state = fresh(null);

function fresh(saved) {
  return {
    segments: saved?.segments ?? {},
    notes: saved?.notes ?? {},
    extra: saved?.extra ?? [],
    // The segments the saved plan has an item for, so a card taken out on the laptop is not put back by a save here.
    present: saved?.present ?? new Set(),
    contentHubItems: structuredClone(plan?.contentHubItems ?? []),
    open: null,
    // 'list' or 'text': which way of adding the open panel shows.
    panelMode: 'list',
    dirty: false,
    // Counts the changes made, so a change made while a save is running is not marked as saved.
    edits: 0,
    saving: false,
    error: '',
  };
}

const DISABLED = (ok) => (ok ? '' : 'disabled');
const FIELD_LABEL = 'display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:var(--text)';
const FIELD_INPUT = 'height:44px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:14px;font-weight:400;outline:0';

const rowOf = (id) => praiseRow(SEGMENTS.find((s) => s.id === id), state, songs);
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

function renderHeader(view) {
  document.getElementById('eyebrow').textContent = plan ? `PRAISE & WORSHIP · ${dateLabel(plan.date)}` : 'PRAISE & WORSHIP';
  document.getElementById('title').textContent = plan ? plan.name : 'No plan open';
  document.title = `${plan ? plan.name : 'Praise & Worship'} · APCCMMA Web Planner`;
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
  document.getElementById('print').disabled = !plan || setlist().length === 0;
  const note = document.getElementById('view-only');
  note.textContent = VIEW_ONLY;
  note.hidden = !plan || canEdit;
}

/** The panel that opens under a segment: what it holds, then a song, typed text or the Content Hub. Any segment takes any of them. */
function panelFor(row) {
  const close = `<button type="button" data-close="${esc(row.id)}" style="height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:600;cursor:pointer">Close</button>`;
  const list = state.panelMode === 'list';
  const tab = (mode, label, on) => `<button type="button" role="tab" data-panel-mode="${mode}" aria-selected="${on}" class="panel-tab${on ? ' is-on' : ''}">${label}</button>`;
  const adder = list
    ? `
            <div data-inline-picker="${esc(row.id)}"></div>`
    : row.kind === 'reading'
      ? `
            <label style="${FIELD_LABEL}">
              Type
              <select data-role="panel-type" ${DISABLED(canEdit)} style="${FIELD_INPUT}">${CONTENT_TYPES.map((type) => `<option value="${type.value}" ${type.value === row.contentType ? 'selected' : ''}>${type.icon} ${esc(type.label)}</option>`).join('')}</select>
            </label>
            <label style="${FIELD_LABEL}">
              Title or reference
              <input data-role="panel-ref" maxlength="200" placeholder="e.g. Psalm 100:1-5" value="${esc(row.text)}" ${DISABLED(canEdit)} style="${FIELD_INPUT}">
            </label>
            <p style="margin:0;font-size:12px;line-height:1.5;color:var(--muted)">This saves a short title. To keep the full words with the plan, use the Content Hub.</p>
            <div><button type="button" data-use-ref="${esc(row.id)}" ${DISABLED(canEdit)} class="btn-primary" style="height:40px;padding:0 16px;font-size:14px;font-weight:700">Use this title</button></div>`
      : `
            <label style="${FIELD_LABEL}">
              Words or a short note
              <textarea data-role="panel-text" rows="3" maxlength="500" placeholder="e.g. Sung by the youth choir" ${DISABLED(canEdit)} style="padding:12px 14px;border-radius:8px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:14px;line-height:1.5;resize:vertical;outline:0"></textarea>
            </label>
            <div><button type="button" data-use-text="${esc(row.id)}" ${DISABLED(canEdit)} class="btn-primary" style="height:40px;padding:0 16px;font-size:14px;font-weight:700">Add this text</button></div>`;
  const note = row.kind === 'rite'
    ? `
            <label style="${FIELD_LABEL}">
              Operator note
              <textarea data-role="panel-note" rows="3" maxlength="1000" placeholder="e.g. Speaker to confirm" ${DISABLED(canEdit)} style="padding:12px 14px;border-radius:8px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:14px;line-height:1.5;resize:vertical;outline:0">${esc(row.note)}</textarea>
            </label>
            <div><button type="button" data-save-note="${esc(row.id)}" ${DISABLED(canEdit)} class="btn-quiet" style="height:40px;padding:0 16px;font-size:14px;font-weight:600">Save note</button></div>`
    : '';
  return `
          <div style="display:flex;flex-direction:column;gap:12px;padding:14px 18px;background:var(--input-bg);border-bottom:1px solid var(--border)">
            ${entryListHtml(row.entries, row.id, canEdit)}
            <div role="tablist" aria-label="How to fill this segment" style="display:flex;gap:8px">${tab('list', 'Song list', list)}${tab('text', 'Type text', !list)}</div>
            ${adder}
            ${hubButtonsHtml(canEdit)}
            ${note}
            <div style="display:flex;justify-content:flex-end">${close}</div>
          </div>`;
}

/**
 * Draws the song picker into the open segment's panel, on the Praise & Worship tab and the segment's own category (Joyful Song opens on
 * Joyful / Fast Praise). Add puts a song at the end of the segment; pressing Added takes it out again. A key belongs to the song it was chosen for.
 */
function mountPicker() {
  const id = state.open;
  const root = id ? document.querySelector(`[data-inline-picker="${CSS.escape(id)}"]`) : null;
  if (!root) return;
  const row = rowOf(id);
  mountSongPicker(root, {
    key: `pw:${id}`,
    songs: songs.filter((s) => !s.removed),
    serviceType: 'praise_worship',
    category: row.pickerCategory || 'all',
    canEdit,
    chosenIds: () => new Set(slotEntries(state.segments[id]).map((entry) => entry.songId).filter(Boolean)),
    onToggle: (songId) => {
      const at = slotEntries(state.segments[id]).findIndex((entry) => entry.songId === songId);
      state.segments = at >= 0 ? withoutEntry(state.segments, id, at) : withEntry(state.segments, id, { songId, contentType: 'song' });
      markEdited();
      render();
    },
  });
}

/** What a step shows once it is filled: each song with its key badge, a reading's tag, or a Content Hub or typed item. */
function contentHtml(row) {
  if (!row.value) return row.kind === 'rite' ? '' : esc(row.emptyLabel ?? 'Nothing chosen yet');
  if (row.kind === 'reading' && row.entries.length === 1 && row.entries[0].source === 'text') return `<span class="content-tag">${esc(row.tag)}</span>`;
  return entrySummaryHtml(row.entries);
}

function renderSegments(view) {
  document.getElementById('segments').innerHTML = view.sections.map((section) => {
    const rows = section.rows.map((r) => {
      const sub = [r.kind === 'song' ? 'Song' : r.kind === 'reading' ? 'Reading' : '', r.hint].filter(Boolean).join(' · ');
      const valueStyle = r.kind === 'rite' && !r.value ? 'display:none' : r.value ? 'display:flex;flex-direction:column;align-items:flex-start;gap:6px;color:var(--text);font-weight:600' : 'color:var(--muted)';
      const btnLabel = r.value ? 'Change' : r.kind === 'rite' ? 'Add' : 'Choose';
      const needs = (r.kind === 'song' || r.kind === 'reading') && !r.value && !r.optional;
      const btnClass = needs ? 'btn-primary' : 'btn-quiet';
      const open = state.open === r.id;
      return `
              <div class="editor-row" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 18px; border-bottom: 1px solid var(--border)">
                <span style="flex: none; width: 28px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--muted)">${String(r.n).padStart(2, '0')}</span>
                <span style="flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size: 15px; font-weight: 700">${esc(r.name)}</span>
                  <span style="font-size: 12px; color: var(--muted)">${esc(sub)}</span>
                </span>
                <span style="flex: 1 1 200px; min-width: 0; font-size: 14px; line-height: 1.4; ${valueStyle}">${contentHtml(r)}</span>
                <span class="editor-item-actions" style="flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--input-bg)">
                  <button type="button" data-step="${esc(r.id)}" data-delta="-1" aria-label="Fewer minutes for ${esc(r.name)}" ${r.minutes <= MIN_MINUTES || !canEdit ? 'disabled' : ''} style="width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--focus); font-size: 18px; font-weight: 700; cursor: pointer">−</button>
                  <span data-minutes="${esc(r.id)}" style="min-width: 46px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px">${r.minutes} min</span>
                  <button type="button" data-step="${esc(r.id)}" data-delta="1" aria-label="More minutes for ${esc(r.name)}" ${r.minutes >= MAX_MINUTES || !canEdit ? 'disabled' : ''} style="width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--focus); font-size: 18px; font-weight: 700; cursor: pointer">+</button>
                </span>
                <button type="button" data-open="${esc(r.id)}" aria-expanded="${open}" ${DISABLED(canEdit)} class="btn-choose ${btnClass}" style="height: 36px; padding: 0 14px; font-size: 13px; font-weight: 700">${btnLabel}</button>
              </div>${open ? panelFor(r) : ''}`;
    }).join('');
    return `
          <div style="border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: var(--input-bg); border-bottom: 1px solid var(--border)">
              <h2 class="section-title${section.title === section.title.toUpperCase() ? ' sentence-case' : ''}">${esc(section.title)}</h2>
              <span data-section-minutes="${section.group}" style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted)">${section.minutes} min</span>
            </div>${rows}
          </div>`;
  }).join('');
  mountPicker();
}

/** The time bars, one for each section of the plan's template. Built once for a template, so the fills keep sliding when the minutes change. */
function renderBars(view) {
  const box = document.getElementById('section-bars');
  const layout = view.sections.map((section) => section.group).join('|');
  if (box.dataset.layout === layout) return;
  box.dataset.layout = layout;
  // The earlier editor's section titles are in capitals; here they read as a sentence.
  const titleOf = (title) => (title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLowerCase() : title);
  box.innerHTML = view.sections.map((section) => `
          <div style="display: flex; flex-direction: column; gap: 6px">
            <div style="display: flex; justify-content: space-between; gap: 10px; font-size: 13px"><span>${esc(titleOf(section.title))}</span><span id="bar-label-${esc(section.group)}" style="flex: none; font-family: 'JetBrains Mono', monospace; font-size: 12px"></span></div>
            <div style="height: 8px; border-radius: 99px; background: var(--border); overflow: hidden"><span id="bar-fill-${esc(section.group)}" class="time-bar-fill"></span></div>
          </div>`).join('');
}

/** Updates the readiness panel in place, so the bars slide to their new length. */
function renderReadiness(view) {
  renderBars(view);
  const okCount = view.checks.filter((c) => c.ok).length;
  const left = view.checks.length - okCount;
  document.getElementById('readiness-headline').textContent = left === 0 ? 'Ready to sync' : `${left} thing${left === 1 ? '' : 's'} to finish`;
  document.getElementById('readiness-fill').style.width = `${Math.round((okCount / view.checks.length) * 100)}%`;
  document.getElementById('readiness-checks').innerHTML = view.checks.map((c) => `
            <li style="display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.4">
              <span aria-hidden="true" style="flex: none; margin-top: 2px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 800; ${c.ok ? 'background:var(--pill-bg);color:var(--pill-text)' : 'background:var(--warn-bg);color:var(--warn-text)'}">${c.ok ? '✓' : '!'}</span>
              <span style="color:var(--text)"><span class="sr-only">${c.ok ? 'Done: ' : 'To do: '}</span>${esc(c.text + (c.sub ? ` (${c.sub})` : ''))}</span>
            </li>`).join('');
  for (const section of view.sections) {
    document.getElementById(`bar-fill-${section.group}`).style.width = `${section.percent}%`;
    document.getElementById(`bar-label-${section.group}`).textContent = `${section.minutes} min`;
  }
}

function render() {
  const view = compute();
  renderHeader(view);
  renderSegments(view);
  renderReadiness(view);
}

/** After a stepper: the step's minutes and every total, leaving the list and any open panel as they are. */
function renderTimes(id) {
  const view = compute();
  renderHeader(view);
  renderReadiness(view);
  for (const section of view.sections) document.querySelector(`[data-section-minutes="${section.group}"]`).textContent = `${section.minutes} min`;
  const row = rowOf(id);
  const key = CSS.escape(id);
  document.querySelector(`[data-minutes="${key}"]`).textContent = `${row.minutes} min`;
  document.querySelector(`[data-step="${key}"][data-delta="-1"]`).disabled = row.minutes <= MIN_MINUTES || !canEdit;
  document.querySelector(`[data-step="${key}"][data-delta="1"]`).disabled = row.minutes >= MAX_MINUTES || !canEdit;
}

/** Changes a segment's choice in this session. Nothing is saved until Save plan. */
function choose(id, patch) {
  state.segments = withChoice(state.segments, id, patch);
  markEdited();
}

/** Takes in what is typed in the open panel but not yet applied, so a save never leaves it behind. Returns whether anything changed. */
function applyOpenPanel() {
  if (!state.open) return false;
  const row = rowOf(state.open);
  let changed = false;
  const ref = document.querySelector('[data-role="panel-ref"]');
  if (ref) {
    const text = ref.value.trim();
    const contentType = document.querySelector('[data-role="panel-type"]').value;
    if (text && (text !== row.text || contentType !== row.contentType)) {
      // Typed words are edited in place. A song or a Content Hub entry already there stays, and the title goes after it.
      if (row.value && !row.text) {
        state.segments = withEntry(state.segments, row.id, { text, contentType });
        markEdited();
        ref.value = '';
      } else choose(row.id, { text, contentType, songId: null });
      changed = true;
    }
  }
  const textBox = document.querySelector('[data-role="panel-text"]');
  if (textBox && textBox.value.trim()) {
    state.segments = withEntry(state.segments, row.id, { text: textBox.value.trim() });
    textBox.value = '';
    markEdited();
    changed = true;
  }
  const noteBox = document.querySelector('[data-role="panel-note"]');
  if (noteBox && noteBox.value.trim() !== row.note) {
    state.notes[row.id] = noteBox.value.trim();
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
      markEdited();
      render();
    },
  });
}

/** Redraws the list, keeping the cursor in the panel field it was in. */
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
    // A plan the earlier editor laid out opens in that layout; every other plan opens in the laptop's lineup.
    TEMPLATE = praiseTemplateFor(plan.items, PRAISE_PLAN);
    SEGMENTS = praiseSegments(TEMPLATE);
    state = fresh(praiseFromItems(plan.items, SEGMENTS));
    resetSongPickers();
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
  state.saving = true;
  state.error = '';
  const sent = state.edits;
  renderHeader(compute());
  try {
    const response = await savePlan(savePayload(plan, praiseToItems(state, SEGMENTS), { contentHubItems: state.contentHubItems }));
    plan.updatedAt = response.savedAt;
    if (state.edits === sent) state.dirty = false;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.saving = false;
    renderHeader(compute());
  }
}

/** Fills the print-only setlist from what is on the page, unsaved changes included. Without a setlist, the browser prints the page as it is. */
function prepareSetlist() {
  const entries = setlist();
  if (!plan || entries.length === 0) return;
  const hasKeys = entries.some((entry) => entry.key);
  document.getElementById('setlist-print').innerHTML = `
    <p class="setlist-eyebrow">Assumption Parish · Music Ministry</p>
    <h1>${esc(plan.name)}</h1>
    <p class="setlist-when">${esc(`${dateLabel(plan.date)} · ${durationLabel(compute().total)}`)}</p>
    <table>
      <thead><tr><th scope="col">#</th><th scope="col">Part</th><th scope="col">Song or text</th>${hasKeys ? '<th scope="col">Key</th>' : ''}</tr></thead>
      <tbody>${entries.map((entry, index) => `<tr><td>${index + 1}</td><td>${esc(entry.label)}</td><td>${esc(entry.title)}</td>${hasKeys ? `<td>${esc(entry.key)}</td>` : ''}</tr>`).join('')}</tbody>
    </table>`;
  document.body.classList.add('is-printing-setlist');
  // The browser offers this as the name of the saved PDF.
  document.title = `Setlist - ${plan.name}`;
}

// The browser's own Print command gets the same clean setlist as the button.
window.addEventListener('beforeprint', prepareSetlist);
window.addEventListener('afterprint', () => {
  document.body.classList.remove('is-printing-setlist');
  renderHeader(compute());
});

document.querySelector('main').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.step) {
    const id = button.dataset.step;
    const delta = Number(button.dataset.delta);
    const current = rowOf(id).minutes;
    choose(id, { minutes: Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, current + delta)) });
    renderTimes(id);
    // A stepper at its limit is now disabled, so keyboard focus moves to its pair.
    if (button.disabled) document.querySelector(`[data-step="${CSS.escape(id)}"][data-delta="${-delta}"]`)?.focus();
  } else if (button.dataset.open) {
    state.open = state.open === button.dataset.open ? null : button.dataset.open;
    const opened = state.open ? rowOf(state.open) : null;
    if (opened) state.panelMode = opened.kind === 'song' ? 'list' : 'text';
    // A song segment opens on its song list, already on the segment's category (see mountPicker).
    render();
    if (opened) void songWatch.check();
  } else if (button.dataset.panelMode) {
    state.panelMode = button.dataset.panelMode;
    render();
  } else if (button.dataset.hub) {
    openHub(button.dataset.hub);
  } else if (button.dataset.removeEntry !== undefined) {
    state.segments = withoutEntry(state.segments, button.dataset.for, Number(button.dataset.removeEntry));
    markEdited();
    render();
  } else if (button.dataset.useText) {
    if (applyOpenPanel()) render();
  } else if (button.dataset.close) {
    state.open = null;
    render();
  } else if (button.dataset.useRef) {
    if (applyOpenPanel()) render();
  } else if (button.dataset.saveNote) {
    if (applyOpenPanel()) render();
  } else if (button.id === 'print') {
    prepareSetlist();
    window.print();
  } else if (button.id === 'discard') {
    if (planId) void load();
  } else if (button.id === 'save') {
    void save();
  }
});

document.querySelector('main').addEventListener('change', (event) => {
  if (event.target.dataset.role !== 'entry-key') return;
  state.segments = withEntryKey(state.segments, event.target.dataset.for, Number(event.target.dataset.index), event.target.value);
  markEdited();
  renderKeepingField();
});

// Ctrl + S, or Cmd + S on a Mac, from anywhere on the page. The browser's own Save page is always held back here. A plan with nothing new is not
// saved again, so a habitual press does not make a new version for the laptops to pull.
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key?.toLowerCase() !== 's') return;
  event.preventDefault();
  if (!event.repeat) void save({ onlyIfChanged: true });
});

const user = await guard();
if (user) {
  if (planId) await load();
  else render();
}
