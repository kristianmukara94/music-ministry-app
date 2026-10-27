// Praise & Worship editor: the segments with their minute steppers, and the readiness panel. Changing a segment's minutes updates
// the section totals, the total time, the time bars and the readiness checks. A segment takes a song from the church's list, typed
// text, or a note, through the panel that opens under it. The segments and the minutes come from the saved plan on the server.
import { LANGUAGE_CODE, PRAISE_PLAN } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { getPlan, listSongs, savePlan } from './plan-api.js';
import {
  MAX_MINUTES,
  MIN_MINUTES,
  NO_SONGS,
  VIEW_ONLY,
  dateLabel,
  payloadFor,
  praiseSegments,
  saveButton,
  savedState,
  songOptions,
  statusText,
  titleOf,
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
    ...savedState(saved),
    open: null,
    query: '',
    dirty: false,
    saving: false,
    error: '',
  };
}

const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`);
const DISABLED = (ok) => (ok ? '' : 'disabled');

/** One segment as the page shows it: its minutes, what is chosen for it, and its note. */
function viewOf(seg) {
  const s = state.segments[seg.id] ?? {};
  return {
    ...seg,
    minutes: s.minutes ?? seg.defaultMinutes,
    songId: s.songId ?? null,
    text: s.text ?? '',
    value: s.songId ? titleOf(songs, s.songId) : (s.text ?? ''),
    note: state.notes[seg.id] ?? '',
  };
}

/** Works out every number the page shows from the plan and the choices so far. */
function compute() {
  let total = 0;
  let songsTotal = 0;
  let songsDone = 0;
  const missing = [];
  const sections = PRAISE_PLAN.sections.map((section) => {
    let secMin = 0;
    const rows = section.rows.map(([id]) => {
      const seg = SEGMENTS.find((s) => s.id === id);
      const v = viewOf(seg);
      secMin += v.minutes;
      total += v.minutes;
      const needs = seg.kind === 'song' || seg.kind === 'reading';
      if (seg.kind === 'song') {
        songsTotal += 1;
        if (v.value) songsDone += 1;
      }
      if (needs && !v.value && !seg.optional) missing.push(seg.name);
      return v;
    });
    return { title: section.title, rows, secMin };
  });

  const over = total - PRAISE_PLAN.targetMinutes;
  const checks = [
    {
      ok: missing.length === 0,
      text: missing.length === 0 ? 'Every required song and reading is set' : `${missing.length} step${missing.length === 1 ? '' : 's'} still need a song or reading`,
      sub: missing.slice(0, 3).join(', '),
    },
    {
      ok: over <= 0,
      text: over <= 0 ? `Fits the ${PRAISE_PLAN.targetMinutes} minute slot (${fmt(total)})` : `Runs ${over} min over the ${PRAISE_PLAN.targetMinutes} minute slot`,
      sub: '',
    },
    ...PRAISE_PLAN.fixedChecks,
  ];
  return { sections, total, songsTotal, songsDone, checks };
}

function renderHeader(view) {
  document.getElementById('eyebrow').textContent = plan ? `PRAISE & WORSHIP · ${dateLabel(plan.date)}` : 'PRAISE & WORSHIP';
  document.getElementById('title').textContent = plan ? plan.name : 'No plan open';
  document.title = `${plan ? plan.name : 'Praise & Worship'} · APCCMMA Web Planner`;
  document.getElementById('status').textContent = plan ? statusText({ dirty: state.dirty, error: state.error }) : state.error || 'Not loaded';
  document.getElementById('songs-label').textContent = `${view.songsDone} of ${view.songsTotal} chosen`;
  document.getElementById('total-label').textContent = fmt(view.total);
  const segments = view.sections.reduce((n, s) => n + s.rows.length, 0);
  document.getElementById('segments-label').textContent = `${segments} segments`;
  const save = saveButton(state.saving);
  const saveEl = document.getElementById('save');
  saveEl.disabled = !plan || !canEdit || save.disabled;
  saveEl.textContent = save.label;
  document.getElementById('discard').disabled = !plan || state.saving;
  const note = document.getElementById('view-only');
  note.textContent = VIEW_ONLY;
  note.hidden = !plan || canEdit;
}

/** The panel that opens under a segment: the song picker, the reference box, or the operator note. */
function panelFor(row) {
  const close = `<button type="button" data-close="${esc(row.id)}" style="height:34px;padding:0 14px;border-radius:9px;border:1px solid #3a1523;background:transparent;color:#dbb3bf;font-size:13px;font-weight:600;cursor:pointer">Close</button>`;
  if (row.kind === 'song') {
    return `
          <div style="display:flex;flex-direction:column;gap:12px;padding:14px 18px;background:#150610;border-bottom:1px solid #2b1019">
            <label style="display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border:1px solid #55202f;border-radius:10px;background:#0f0407">
              <input data-role="panel-search" type="search" aria-label="Search songs" placeholder="Search songs" value="${esc(state.query)}" ${DISABLED(canEdit)} style="flex:1;min-width:0;border:0;outline:0;background:transparent;color:#f7eef0;font-size:14px">
            </label>
            <div data-role="panel-options" style="display:flex;flex-direction:column;border:1px solid #3a1523;border-radius:12px;overflow:hidden">${optionsFor(row)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" data-clear="${esc(row.id)}" ${DISABLED(canEdit)} style="height:34px;padding:0 14px;border-radius:9px;border:1px solid #3a1523;background:transparent;color:#ecc98a;font-size:13px;font-weight:600;cursor:pointer">Clear this song</button>
              ${close}
            </div>
          </div>`;
  }
  if (row.kind === 'reading') {
    return `
          <div style="display:flex;flex-direction:column;gap:12px;padding:14px 18px;background:#150610;border-bottom:1px solid #2b1019">
            <input data-role="panel-ref" aria-label="Reading reference" placeholder="e.g. Psalm 63:1-8" value="${esc(row.text)}" ${DISABLED(canEdit)} style="height:44px;padding:0 14px;border-radius:10px;border:1px solid #55202f;background:#0f0407;color:#f7eef0;font-size:14px;outline:0">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#b48d99">The web planner takes the reference as a note. To show the Bible text on the projector, pick the verses in the desktop app.</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" data-use-ref="${esc(row.id)}" ${DISABLED(canEdit)} style="height:40px;padding:0 16px;border-radius:10px;border:0;background:#ecc98a;color:#1c070d;font-size:14px;font-weight:700;cursor:pointer">Use this reference</button>
              ${close}
            </div>
          </div>`;
  }
  return `
          <div style="display:flex;flex-direction:column;gap:12px;padding:14px 18px;background:#150610;border-bottom:1px solid #2b1019">
            <textarea data-role="panel-note" aria-label="Operator note" rows="3" placeholder="e.g. Speaker to confirm" ${DISABLED(canEdit)} style="padding:12px 14px;border-radius:10px;border:1px solid #55202f;background:#0f0407;color:#f7eef0;font-size:14px;line-height:1.5;resize:vertical;outline:0">${esc(row.note)}</textarea>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" data-save-note="${esc(row.id)}" ${DISABLED(canEdit)} style="height:40px;padding:0 16px;border-radius:10px;border:1px solid #6e2a3e;background:#2a0c18;color:#f7eef0;font-size:14px;font-weight:600;cursor:pointer">Save note</button>
              ${close}
            </div>
          </div>`;
}

/** The songs offered in a segment's panel: the church's list, narrowed by the search box. */
function optionsFor(row) {
  if (songs.length === 0) return `<div style="padding:18px 14px;font-size:13px;color:#b48d99;background:#0f0407">${esc(NO_SONGS)}</div>`;
  const shown = songOptions(songs, { query: state.query });
  if (shown.length === 0) return `<div style="padding:18px 14px;font-size:13px;color:#b48d99;background:#0f0407">No songs match the search.</div>`;
  return shown.map((song) => {
    const chosen = row.songId === song.id;
    const key = song.key ? ` · Key ${esc(song.key)}` : '';
    return `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #2b1019;background:#0f0407">
              <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
                <span style="font-size:14px;font-weight:700">${esc(song.title)}</span>
                <span style="font-size:12px;color:#b48d99">${LANGUAGE_CODE[song.language] ?? esc(song.language)}${key}</span>
              </span>
              <button type="button" data-song="${esc(song.id)}" data-for="${esc(row.id)}" aria-pressed="${chosen}" ${DISABLED(canEdit)} style="height:34px;padding:0 14px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;${chosen ? 'border:1px solid #8fd9ae;background:#12301f;color:#8fd9ae' : 'border:1px solid #6e2a3e;background:#2a0c18;color:#f7eef0'}">${chosen ? 'Selected' : 'Select'}</button>
            </div>`;
  }).join('');
}

function renderSegments(view) {
  document.getElementById('segments').innerHTML = view.sections.map((section) => {
    const rows = section.rows.map((r) => {
      const sub = r.kind === 'song' ? 'Song · ' + r.hint : r.kind === 'reading' ? 'Reading · ' + r.hint : r.hint;
      const valueStyle = r.kind === 'rite' ? 'display:none' : r.value ? 'color:#f7eef0;font-weight:600' : 'color:#b48d99';
      const btnLabel = r.kind === 'rite' ? 'Add note' : r.value ? 'Change' : 'Choose';
      const needs = (r.kind === 'song' || r.kind === 'reading') && !r.value && !r.optional;
      const btnStyle = needs ? 'border:0;background:#ecc98a;color:#1c070d' : 'border:1px solid #6e2a3e;background:#2a0c18;color:#f7eef0';
      const open = state.open === r.id;
      return `
              <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 18px; border-bottom: 1px solid #2b1019">
                <span style="flex: none; width: 28px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #b48d99">${esc(r.id.padStart(2, '0'))}</span>
                <span style="flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size: 15px; font-weight: 700">${esc(r.name)}</span>
                  <span style="font-size: 12px; color: #b48d99">${esc(sub)}</span>
                </span>
                <span style="flex: 1 1 200px; min-width: 0; font-size: 14px; line-height: 1.4; ${valueStyle}">${r.kind === 'rite' ? '' : esc(r.value || 'Nothing chosen yet')}</span>
                <span style="flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 4px; border: 1px solid #55202f; border-radius: 9px; background: #150610">
                  <button type="button" data-step="${esc(r.id)}" data-delta="-1" aria-label="Fewer minutes for ${esc(r.name)}" ${r.minutes <= MIN_MINUTES || !canEdit ? 'disabled' : ''} style="width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: #ecc98a; font-size: 18px; font-weight: 700; cursor: pointer">−</button>
                  <span style="min-width: 46px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px">${r.minutes} min</span>
                  <button type="button" data-step="${esc(r.id)}" data-delta="1" aria-label="More minutes for ${esc(r.name)}" ${r.minutes >= MAX_MINUTES || !canEdit ? 'disabled' : ''} style="width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: #ecc98a; font-size: 18px; font-weight: 700; cursor: pointer">+</button>
                </span>
                <button type="button" data-open="${esc(r.id)}" aria-expanded="${open}" ${DISABLED(canEdit)} style="height: 36px; padding: 0 14px; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; ${btnStyle}">${btnLabel}</button>
              </div>${open ? panelFor(r) : ''}`;
    }).join('');
    return `
          <div style="border: 1px solid #3a1523; border-radius: 16px; background: #1b0a13; overflow: hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: #22101a; border-bottom: 1px solid #3a1523">
              <h2 style="margin: 0; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: #ecc98a">${esc(section.title)}</h2>
              <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #b48d99">${section.secMin} min</span>
            </div>${rows}
          </div>`;
  }).join('');
}

function renderReadiness(view) {
  const okCount = view.checks.filter((c) => c.ok).length;
  const left = view.checks.length - okCount;
  const headline = left === 0 ? 'Ready to sync' : `${left} thing${left === 1 ? '' : 's'} to finish`;
  const maxSec = Math.max(...view.sections.map((s) => s.secMin));
  const checks = view.checks.map((c) => `
            <li style="display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.4">
              <span aria-hidden="true" style="flex: none; margin-top: 2px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 800; ${c.ok ? 'background:#12301f;color:#8fd9ae' : 'background:#33240c;color:#f2bd6b'}">${c.ok ? '✓' : '!'}</span>
              <span style="${c.ok ? 'color:#dbb3bf' : 'color:#f7eef0'}"><span class="sr-only">${c.ok ? 'Done: ' : 'To do: '}</span>${esc(c.text + (c.sub ? ` (${c.sub})` : ''))}</span>
            </li>`).join('');
  const bars = view.sections.map((s, i) => `
            <div style="display: flex; align-items: center; gap: 10px">
              <span style="flex: 0 0 96px; font-size: 13px; color: #dbb3bf">${esc(PRAISE_PLAN.sectionLabels[i] ?? s.title)}</span>
              <span style="flex: 1; height: 8px; border-radius: 99px; background: #2b1019; overflow: hidden"><span style="display: block; height: 100%; border-radius: 99px; background: #6e2a3e; width: ${Math.round((s.secMin / maxSec) * 100)}%"></span></span>
              <span style="flex: 0 0 52px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #dbb3bf">${s.secMin} min</span>
            </div>`).join('');

  document.getElementById('readiness').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 6px">
          <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.12em; color: #ecc98a">READINESS</span>
          <h2 aria-live="polite" style="margin: 0; font-size: 24px; font-weight: 800; line-height: 1.15">${headline}</h2>
        </div>
        <div style="height: 8px; border-radius: 99px; background: #2b1019; overflow: hidden">
          <div style="height: 100%; border-radius: 99px; background: #ecc98a; width: ${Math.round((okCount / view.checks.length) * 100)}%"></div>
        </div>
        <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px">${checks}
        </ul>
        <div style="padding-top: 14px; border-top: 1px solid #3a1523; display: flex; flex-direction: column; gap: 6px">
          <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.1em; color: #b48d99">TIME BY SECTION</span>${bars}
        </div>
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #b48d99">Songs come from the church laptop. Lyrics and slides are prepared in the desktop app.</p>`;
}

function render() {
  const view = compute();
  renderHeader(view);
  renderSegments(view);
  renderReadiness(view);
}

/** Changes a segment's choice in this session. Nothing is saved until Save plan. */
function choose(id, patch) {
  state.segments = withChoice(state.segments, id, patch);
  state.dirty = true;
  state.error = '';
}

/** Reads the saved plan and the song list from the server. A failure keeps what was on screen and shows the plain message. */
async function load() {
  try {
    const [saved, list] = await Promise.all([getPlan(planId), listSongs()]);
    plan = saved.plan;
    canEdit = saved.canEdit;
    songs = list.songs;
    state = fresh(plan);
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
  renderHeader(compute());
  try {
    const defaults = Object.fromEntries(SEGMENTS.map((s) => [s.id, s.defaultMinutes]));
    await savePlan(payloadFor({ planId: plan.id, segments: state.segments, notes: state.notes }, SEGMENTS.map((s) => s.id), defaults));
    state.dirty = false;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.saving = false;
    render();
  }
}

document.querySelector('main').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.step) {
    const id = button.dataset.step;
    const delta = Number(button.dataset.delta);
    const seg = SEGMENTS.find((s) => s.id === id);
    const current = viewOf(seg).minutes;
    choose(id, { minutes: Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, current + delta)) });
    state.dirty = true;
    render();
    // The list is redrawn, so keep keyboard focus on the same stepper button (or its pair if this one is now disabled).
    const again = document.querySelector(`[data-step="${CSS.escape(id)}"][data-delta="${delta}"]`);
    (again && !again.disabled ? again : document.querySelector(`[data-step="${CSS.escape(id)}"][data-delta="${-delta}"]`))?.focus();
  } else if (button.dataset.open) {
    state.open = state.open === button.dataset.open ? null : button.dataset.open;
    state.query = '';
    render();
  } else if (button.dataset.close) {
    state.open = null;
    render();
  } else if (button.dataset.song) {
    choose(button.dataset.for, { songId: button.dataset.song, text: null });
    render();
  } else if (button.dataset.clear) {
    choose(button.dataset.clear, { songId: null, text: null });
    render();
  } else if (button.dataset.useRef) {
    const input = document.querySelector('[data-role="panel-ref"]');
    const ref = input.value.trim();
    if (ref) choose(button.dataset.useRef, { text: ref, songId: null });
    render();
  } else if (button.dataset.saveNote) {
    state.notes[button.dataset.saveNote] = document.querySelector('[data-role="panel-note"]').value.trim();
    state.dirty = true;
    render();
  } else if (button.id === 'discard') {
    if (planId) void load();
  } else if (button.id === 'save') {
    void save();
  }
});

document.querySelector('main').addEventListener('input', (event) => {
  if (event.target.dataset.role !== 'panel-search') return;
  state.query = event.target.value;
  const row = SEGMENTS.find((s) => s.id === state.open);
  const box = document.querySelector('[data-role="panel-options"]');
  if (row && box) box.innerHTML = optionsFor(viewOf(row));
});

const user = await guard();
if (user) {
  if (planId) await load();
  else render();
}
