// Praise & Worship editor: the segments with their minute steppers, the readiness panel, and the printed setlist. Changing a segment's minutes
// updates the section totals, the total time, the time bars and the readiness checks without redrawing the list, so what is being typed in an open
// panel stays. A segment takes a song from the church's list, a short title for a reading, or a note, through the panel that opens under it. The
// segments and the minutes come from the saved plan on the server. Every value written into markup goes through esc().
import { LANGUAGE_CODE, PRAISE_PLAN } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { getPlan, listSongs, savePlan } from './plan-api.js';
import { keyChoices } from './song-keys.js';
import {
  CONTENT_TYPES,
  MAX_MINUTES,
  MIN_MINUTES,
  NO_SONGS,
  VIEW_ONLY,
  dateLabel,
  durationLabel,
  praiseBreakdown,
  praiseFromItems,
  praiseRow,
  praiseToItems,
  savePayload,
  setlistEntries,
  songsForEditor,
  praiseSegments,
  saveButton,
  songOptions,
  statusText,
  withChoice,
} from './plan-model.js';

mountSidebar();

const planId = new URLSearchParams(location.search).get('id');
const SEGMENTS = praiseSegments(PRAISE_PLAN);

let plan = null;
let canEdit = false;
let songs = [];
let state = fresh(null);

function fresh(saved) {
  return {
    segments: saved?.segments ?? {},
    notes: saved?.notes ?? {},
    extra: saved?.extra ?? [],
    open: null,
    query: '',
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
const compute = () => praiseBreakdown(PRAISE_PLAN, SEGMENTS, state, songs);
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

/** The key a song is sung in for this plan. Choosing the song's own key clears the change; the song in the list is never touched. */
function keyField(row) {
  if (!row.songId) return '';
  const options = keyChoices(row.originalKey, row.keyTransposed)
    .map((choice) => `<option value="${esc(choice.value)}" ${choice.value === row.keyTransposed ? 'selected' : ''}>${esc(choice.label)}</option>`)
    .join('');
  return `
            <label style="${FIELD_LABEL}">
              Key for this plan
              <select data-role="panel-key" data-for="${esc(row.id)}" ${DISABLED(canEdit)} style="${FIELD_INPUT}">${options}</select>
              <span style="font-size:12px;font-weight:400;line-height:1.5;color:var(--muted)">This changes the lead sheet key for this plan only. The song in the list keeps its own key.</span>
            </label>`;
}

/** The panel that opens under a segment: the song picker, the title box, or the operator note. */
function panelFor(row) {
  const close = `<button type="button" data-close="${esc(row.id)}" style="height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:600;cursor:pointer">Close</button>`;
  if (row.kind === 'song') {
    return `
          <div style="display:flex;flex-direction:column;gap:12px;padding:14px 18px;background:var(--input-bg);border-bottom:1px solid var(--border)">${keyField(row)}
            <label style="display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border:1px solid var(--border);border-radius:8px;background:var(--input-bg)">
              <input data-role="panel-search" type="search" aria-label="Search songs" placeholder="Search songs" value="${esc(state.query)}" ${DISABLED(canEdit)} style="flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:14px">
            </label>
            <div data-role="panel-options" style="display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;overflow:hidden">${optionsFor(row)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" data-clear="${esc(row.id)}" ${DISABLED(canEdit)} style="height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--focus);font-size:13px;font-weight:600;cursor:pointer">Clear this song</button>
              ${close}
            </div>
          </div>`;
  }
  if (row.kind === 'reading') {
    const types = CONTENT_TYPES.map((type) => `<option value="${type.value}" ${type.value === row.contentType ? 'selected' : ''}>${type.icon} ${esc(type.label)}</option>`).join('');
    return `
          <div style="display:flex;flex-direction:column;gap:12px;padding:14px 18px;background:var(--input-bg);border-bottom:1px solid var(--border)">
            <label style="${FIELD_LABEL}">
              Type
              <select data-role="panel-type" ${DISABLED(canEdit)} style="${FIELD_INPUT}">${types}</select>
            </label>
            <label style="${FIELD_LABEL}">
              Title or reference
              <input data-role="panel-ref" maxlength="200" placeholder="e.g. Psalm 100:1-5" value="${esc(row.text)}" ${DISABLED(canEdit)} style="${FIELD_INPUT}">
            </label>
            <p style="margin:0;font-size:12px;line-height:1.5;color:var(--muted)">The web planner saves only this short title. The full text stays in the Content Hub on the church laptop, and is put on the projector from the desktop app.</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" data-use-ref="${esc(row.id)}" ${DISABLED(canEdit)} class="btn-primary" style="height:40px;padding:0 16px;font-size:14px;font-weight:700">Use this title</button>
              <button type="button" data-clear="${esc(row.id)}" ${DISABLED(canEdit)} style="height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--focus);font-size:13px;font-weight:600;cursor:pointer">Clear this reading</button>
              ${close}
            </div>
          </div>`;
  }
  return `
          <div style="display:flex;flex-direction:column;gap:12px;padding:14px 18px;background:var(--input-bg);border-bottom:1px solid var(--border)">
            <textarea data-role="panel-note" aria-label="Operator note" rows="3" maxlength="1000" placeholder="e.g. Speaker to confirm" ${DISABLED(canEdit)} style="padding:12px 14px;border-radius:8px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:14px;line-height:1.5;resize:vertical;outline:0">${esc(row.note)}</textarea>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" data-save-note="${esc(row.id)}" ${DISABLED(canEdit)} class="btn-quiet" style="height:40px;padding:0 16px;font-size:14px;font-weight:600">Save note</button>
              ${close}
            </div>
          </div>`;
}

/** The songs offered in a segment's panel: the church's list, narrowed by the search box. */
function optionsFor(row) {
  const picker = songs.filter((s) => !s.removed);
  if (picker.length === 0) return `<div style="padding:18px 14px;font-size:13px;color:var(--muted);background:var(--input-bg)">${esc(NO_SONGS)}</div>`;
  const shown = songOptions(picker, { query: state.query });
  if (shown.length === 0) return `<div style="padding:18px 14px;font-size:13px;color:var(--muted);background:var(--input-bg)">No songs match the search.</div>`;
  return shown.map((song) => {
    const chosen = row.songId === song.id;
    const key = song.key ? ` · Key ${esc(song.key)}` : '';
    return `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--input-bg)">
              <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
                <span style="font-size:14px;font-weight:700">${esc(song.title)}</span>
                <span style="font-size:12px;color:var(--muted)">${esc(LANGUAGE_CODE[song.language] ?? song.language)}${key}</span>
              </span>
              <button type="button" data-song="${esc(song.id)}" data-for="${esc(row.id)}" aria-pressed="${chosen}" ${DISABLED(canEdit)} class="${chosen ? 'btn-chosen' : 'btn-quiet'}" style="height:34px;padding:0 14px;font-size:13px;font-weight:700">${chosen ? 'Selected' : 'Select'}</button>
            </div>`;
  }).join('');
}

/** What a step shows once it is filled: the song with its key badge, or the reading's tag. */
function contentHtml(row) {
  if (row.kind === 'rite') return '';
  if (!row.value) return 'Nothing chosen yet';
  if (row.kind === 'reading') return `<span class="content-tag">${esc(row.tag)}</span>`;
  const badge = row.key ? `<span class="key-badge${row.keyTransposed ? ' is-transposed' : ''}">Key: ${esc(row.key)}</span>` : '';
  const original = row.keyTransposed && row.originalKey ? `<span style="font-size:12px;font-weight:400;color:var(--muted)">Original: ${esc(row.originalKey)}</span>` : '';
  return `<span>${esc(row.value)}</span>${badge}${original}`;
}

function renderSegments(view) {
  document.getElementById('segments').innerHTML = view.sections.map((section) => {
    const rows = section.rows.map((r) => {
      const sub = r.kind === 'song' ? 'Song · ' + r.hint : r.kind === 'reading' ? 'Reading · ' + r.hint : r.hint;
      const valueStyle = r.kind === 'rite' ? 'display:none' : r.value ? 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;color:var(--text);font-weight:600' : 'color:var(--muted)';
      const btnLabel = r.kind === 'rite' ? 'Add note' : r.value ? 'Change' : 'Choose';
      const needs = (r.kind === 'song' || r.kind === 'reading') && !r.value && !r.optional;
      const btnClass = needs ? 'btn-primary' : 'btn-quiet';
      const open = state.open === r.id;
      return `
              <div class="editor-row" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 18px; border-bottom: 1px solid var(--border)">
                <span style="flex: none; width: 28px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--muted)">${esc(r.id.padStart(2, '0'))}</span>
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
              <h2 class="section-title sentence-case">${esc(section.title)}</h2>
              <span data-section-minutes="${section.group}" style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted)">${section.minutes} min</span>
            </div>${rows}
          </div>`;
  }).join('');
}

/** Updates the readiness panel in place, so the bars slide to their new length. */
function renderReadiness(view) {
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
  const ref = document.querySelector('[data-role="panel-ref"]');
  if (ref) {
    const text = ref.value.trim();
    const contentType = document.querySelector('[data-role="panel-type"]').value;
    if (!text || (text === row.text && contentType === row.contentType)) return false;
    choose(row.id, { text, contentType, songId: null });
    return true;
  }
  const noteBox = document.querySelector('[data-role="panel-note"]');
  if (noteBox && noteBox.value.trim() !== row.note) {
    state.notes[row.id] = noteBox.value.trim();
    markEdited();
    return true;
  }
  return false;
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
    state = fresh(praiseFromItems(plan.items, SEGMENTS));
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
    const response = await savePlan(savePayload(plan, praiseToItems(state, SEGMENTS)));
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
    state.query = '';
    render();
  } else if (button.dataset.close) {
    state.open = null;
    render();
  } else if (button.dataset.song) {
    // A key belongs to the song it was chosen for, so a different song starts in its own key.
    const sameSong = rowOf(button.dataset.for).songId === button.dataset.song;
    choose(button.dataset.for, { songId: button.dataset.song, text: null, ...(sameSong ? {} : { keyTransposed: null }) });
    render();
  } else if (button.dataset.clear) {
    choose(button.dataset.clear, { songId: null, text: null, keyTransposed: null, contentType: null });
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

document.querySelector('main').addEventListener('input', (event) => {
  if (event.target.dataset.role !== 'panel-search') return;
  state.query = event.target.value;
  const box = document.querySelector('[data-role="panel-options"]');
  if (state.open && box) box.innerHTML = optionsFor(rowOf(state.open));
});

document.querySelector('main').addEventListener('change', (event) => {
  if (event.target.dataset.role !== 'panel-key') return;
  choose(event.target.dataset.for, { keyTransposed: event.target.value || null });
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
