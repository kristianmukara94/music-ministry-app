// Mass plan editor: the 31 steps of the Mass, and the drawer that fills the selected step. A song step takes a song
// from the list or a typed note; a reading takes a reference; a rite takes an optional note for the operator.
import { LANGUAGE_CODE, MASS_PLAN, SONGS } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';

mountSidebar();

const STEPS = MASS_PLAN.sections.flatMap((section) =>
  section.rows.map(([n, name, kind, cat, value, src, optional, hint]) => ({
    n, name, kind, cat: cat || '', value: value || '', src: src || '', optional: !!optional, hint: hint || '',
  })),
);
const TOTAL = STEPS.length;

const fresh = () => ({ sel: MASS_PLAN.firstSelected, mode: 'list', allSongs: false, query: '', values: {}, notes: {}, dirty: false, noteSaved: false });
let state = fresh();

/** A step with any change made in this session. */
function stepOf(n) {
  const base = STEPS.find((s) => s.n === n);
  const over = state.values[n];
  return over ? { ...base, value: over.value, src: over.src } : base;
}

const subOf = (r) => {
  const kind = r.kind === 'song' ? 'Song · ' + r.cat : r.kind === 'reading' ? 'Reading' : 'Rite';
  return r.hint ? kind + ' · ' + r.hint : kind;
};

const BTN_PRIMARY = 'border:0;background:#ecc98a;color:#1c070d';
const BTN_QUIET = 'border:1px solid #6e2a3e;background:#2a0c18;color:#f7eef0';
const TAB_ON = 'flex:1;height:40px;border-radius:10px;border:1px solid #ecc98a;background:#2a0c18;color:#ecc98a;font-size:14px;font-weight:700;cursor:pointer';
const TAB_OFF = 'flex:1;height:40px;border-radius:10px;border:1px solid #3a1523;background:transparent;color:#dbb3bf;font-size:14px;font-weight:600;cursor:pointer';

function renderHeader() {
  const steps = STEPS.map((s) => stepOf(s.n));
  const songs = steps.filter((s) => s.kind === 'song');
  const readings = steps.filter((s) => s.kind === 'reading');
  document.getElementById('eyebrow').textContent = MASS_PLAN.eyebrow;
  document.getElementById('title').textContent = MASS_PLAN.title;
  document.title = `${MASS_PLAN.title} · APCCMMA Web Planner`;
  document.getElementById('status').textContent = state.dirty ? 'Unsaved changes' : MASS_PLAN.status;
  document.getElementById('songs-label').textContent = `${songs.filter((s) => s.value).length} of ${songs.length} chosen`;
  document.getElementById('readings-label').textContent = `${readings.filter((s) => s.value).length} of ${readings.length} entered`;
  document.getElementById('steps-label').textContent = `${TOTAL} steps`;
}

function renderSteps() {
  document.getElementById('steps').innerHTML = MASS_PLAN.sections.map((section) => {
    const rows = section.rows.map(([n]) => {
      const r = stepOf(n);
      const selected = r.n === state.sel;
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
          label = r.kind === 'song' ? 'Needs a song' : 'Needs a reading'; fg = '#f2bd6b'; bg = '#33240c';
        }
        chip = `<span style="display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap;color:${fg};background:${bg}">${label}</span>`;
      }
      const filled = r.kind !== 'rite' && !!r.value;
      const needs = r.kind !== 'rite' && !r.value && !r.optional;
      const btnLabel = r.kind === 'rite' ? 'Add note' : r.value ? 'Change' : 'Choose';
      return `
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 18px;border-bottom:1px solid #2b1019;${selected ? 'background:#2a0c18;box-shadow:inset 0 0 0 1px #ecc98a' : 'background:transparent'}">
                <span style="flex: none; width: 28px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #b48d99">${String(r.n).padStart(2, '0')}</span>
                <span style="flex: 1 1 190px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size: 15px; font-weight: 700">${esc(r.name)}</span>
                  <span style="font-size: 12px; color: #b48d99">${esc(subOf(r))}</span>
                </span>
                <span style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size:14px;line-height:1.4;${filled ? 'color:#f7eef0;font-weight:600' : 'color:#b48d99'}">${r.kind === 'rite' ? '' : esc(r.value || 'Nothing chosen yet')}</span>
                </span>
                <span style="flex: 0 0 auto; display: inline-flex">${chip}</span>
                <button type="button" data-pick="${r.n}" aria-pressed="${selected}" style="height:36px;padding:0 14px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;${needs ? BTN_PRIMARY : BTN_QUIET}">${btnLabel}</button>
              </div>`;
    }).join('');
    return `
          <div style="border: 1px solid #3a1523; border-radius: 16px; background: #1b0a13; overflow: hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: #22101a; border-bottom: 1px solid #3a1523">
              <h2 style="margin: 0; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: #ecc98a">${esc(section.title)}</h2>
              <span style="font-size: 12px; color: #b48d99">${section.rows.length} steps</span>
            </div>${rows}
          </div>`;
  }).join('');
}

function songBody() {
  const list = state.mode === 'list';
  const tabs = `
            <div role="tablist" aria-label="How to fill this step" style="display: flex; gap: 8px">
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
                  <input id="song-search" type="search" aria-label="Search songs" placeholder="Search songs" value="${esc(state.query)}" style="flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: #f7eef0; font-size: 14px">
                </label>
                <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px">
                  <span style="font-size: 13px; color: #dbb3bf">${state.allSongs ? 'All songs' : 'Category: ' + esc(cur.cat)}</span>
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
                  <textarea id="typed-text" rows="5" placeholder="e.g. Psalm 24 setting, sung by the cantor" style="padding: 12px 14px; border-radius: 10px; border: 1px solid #55202f; background: #150610; color: #f7eef0; font-size: 14px; line-height: 1.5; resize: vertical; outline: 0"></textarea>
                </label>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #b48d99">Typed text is a note for the operator on the laptop. It does not appear on the projector.</p>
                <button type="button" data-action="use-text" style="height: 44px; border-radius: 10px; border: 0; background: #ecc98a; color: #1c070d; font-size: 14px; font-weight: 700; cursor: pointer">Use this text</button>
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
              <input id="reading-ref" placeholder="e.g. Matthew 5:1-12a" style="height: 46px; padding: 0 14px; border-radius: 10px; border: 1px solid #55202f; background: #150610; color: #f7eef0; font-size: 14px; outline: 0">
            </label>
            <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #b48d99">The web planner takes the reference as a note. To show the Bible text on the projector, pick the verses in the desktop app.</p>
            <button type="button" data-action="use-ref" style="height: 44px; border-radius: 10px; border: 0; background: #ecc98a; color: #1c070d; font-size: 14px; font-weight: 700; cursor: pointer">Use this reference</button>
          </div>`;
}

function riteBody(cur) {
  return `
          <div style="display: flex; flex-direction: column; gap: 14px">
            <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #dbb3bf">This part of the Mass needs no song or reading. You can leave a note for the operator.</p>
            <label style="display: flex; flex-direction: column; gap: 8px">
              <span style="font-size: 13px; font-weight: 600; color: #dbb3bf">Operator note (optional)</span>
              <textarea id="rite-note" rows="4" placeholder="e.g. Incense at the Gospel" style="padding: 12px 14px; border-radius: 10px; border: 1px solid #55202f; background: #150610; color: #f7eef0; font-size: 14px; line-height: 1.5; resize: vertical; outline: 0">${esc(state.notes[cur.n] ?? '')}</textarea>
            </label>
            <button type="button" data-action="save-note" style="height: 44px; border-radius: 10px; border: 1px solid #6e2a3e; background: #2a0c18; color: #f7eef0; font-size: 14px; font-weight: 600; cursor: pointer">${state.noteSaved ? 'Note saved' : 'Save note'}</button>
          </div>`;
}

function renderDrawer() {
  const cur = stepOf(state.sel);
  const body = cur.kind === 'song' ? songBody() : cur.kind === 'reading' ? readingBody(cur) : riteBody(cur);
  document.getElementById('drawer').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 6px">
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #b48d99">STEP ${cur.n} OF ${TOTAL}</span>
          <h2 style="margin: 0; font-size: 24px; font-weight: 800; line-height: 1.15">${esc(cur.name)}</h2>
          <span style="font-size: 13px; color: #dbb3bf">${esc(subOf(cur))}</span>
        </div>${body}`;
  renderOptions();
}

/** The songs offered for the selected step: its category, or all songs, narrowed by the search box. */
function renderOptions() {
  const box = document.getElementById('song-options');
  if (!box) return;
  const cur = stepOf(state.sel);
  const q = state.query.trim().toLowerCase();
  const shown = SONGS.map((song, index) => ({ song, index }))
    .filter(({ song }) => (state.allSongs || song[1] === cur.cat) && (!q || song[0].toLowerCase().includes(q)));
  if (shown.length === 0) {
    const message = q ? 'No songs match the search. Clear it, show all songs, or type text.' : 'No songs in this category yet. Show all songs, or type text.';
    box.innerHTML = `<div style="padding: 18px 14px; font-size: 13px; color: #b48d99; background: #150610">${message}</div>`;
    return;
  }
  box.innerHTML = shown.map(({ song, index }) => {
    const [title, cat, lang, key] = song;
    const chosen = cur.value === title;
    return `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #2b1019; background: #150610">
                      <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
                        <span style="font-size: 14px; font-weight: 700">${esc(title)}</span>
                        <span style="font-size: 12px; color: #b48d99">${state.allSongs ? esc(cat) + ' · ' : ''}${LANGUAGE_CODE[lang] ?? esc(lang)} · Key ${esc(key)}</span>
                      </span>
                      <button type="button" data-song="${index}" aria-pressed="${chosen}" style="height:34px;padding:0 14px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;${chosen ? 'border:1px solid #8fd9ae;background:#12301f;color:#8fd9ae' : BTN_QUIET}">${chosen ? 'Selected' : 'Select'}</button>
                    </div>`;
  }).join('');
}

function renderAll() {
  renderHeader();
  renderSteps();
  renderDrawer();
}

function setValue(value, src) {
  state.values[state.sel] = { value, src };
  state.dirty = true;
  renderHeader();
  renderSteps();
}

document.querySelector('main').addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.pick) {
    state.sel = Number(target.dataset.pick);
    state.query = '';
    state.noteSaved = false;
    renderSteps();
    renderDrawer();
    // On a phone the drawer sits below the steps, so bring it into view.
    if (window.matchMedia('(max-width: 820px)').matches) document.getElementById('drawer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (target.dataset.mode) {
    state.mode = target.dataset.mode;
    renderDrawer();
  } else if (target.dataset.song) {
    setValue(SONGS[Number(target.dataset.song)][0], 'list');
    renderOptions();
  } else if (target.dataset.action === 'toggle-all') {
    state.allSongs = !state.allSongs;
    renderDrawer();
  } else if (target.dataset.action === 'use-text') {
    const text = document.getElementById('typed-text').value.trim();
    if (text) setValue(text, 'text');
  } else if (target.dataset.action === 'use-ref') {
    const ref = document.getElementById('reading-ref').value.trim();
    if (ref) {
      setValue(ref, 'text');
      renderDrawer();
    }
  } else if (target.dataset.action === 'save-note') {
    state.notes[state.sel] = document.getElementById('rite-note').value.trim();
    state.noteSaved = true;
    state.dirty = true;
    renderHeader();
    renderDrawer();
  } else if (target.id === 'discard') {
    state = fresh();
    renderAll();
  } else if (target.id === 'save') {
    state.dirty = false;
    renderHeader();
  }
});

document.getElementById('drawer').addEventListener('input', (event) => {
  if (event.target.id !== 'song-search') return;
  state.query = event.target.value;
  renderOptions();
});

renderAll();
