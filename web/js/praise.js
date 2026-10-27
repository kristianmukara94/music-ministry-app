// Praise & Worship editor: the segments with their minute steppers, and the readiness panel. Changing a segment's
// minutes updates the section totals, the total time, the time bars and the readiness checks.
import { PRAISE_PLAN } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';

mountSidebar();
void guard();

const MIN_MINUTES = 1;
const MAX_MINUTES = 60;
let state = { mins: {}, dirty: false };

const minutesOf = (id, def) => (state.mins[id] != null ? state.mins[id] : def);
const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`);

/** Works out every number the page shows from the plan and the minutes changed so far. */
function compute() {
  let total = 0;
  let songsTotal = 0;
  let songsDone = 0;
  const missing = [];
  const sections = PRAISE_PLAN.sections.map((section) => {
    let secMin = 0;
    const rows = section.rows.map(([id, name, kind, def, value, hint]) => {
      const m = minutesOf(id, def);
      secMin += m;
      total += m;
      const needs = kind === 'song' || kind === 'reading';
      const optional = hint === 'Optional';
      if (kind === 'song') {
        songsTotal += 1;
        if (value) songsDone += 1;
      }
      if (needs && !value && !optional) missing.push(name);
      return { id, name, kind, value, hint, m, needs, optional };
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
  document.getElementById('eyebrow').textContent = PRAISE_PLAN.eyebrow;
  document.getElementById('title').textContent = PRAISE_PLAN.title;
  document.title = `${PRAISE_PLAN.title} · APCCMMA Web Planner`;
  document.getElementById('status').textContent = state.dirty ? 'Unsaved changes' : PRAISE_PLAN.status;
  document.getElementById('songs-label').textContent = `${view.songsDone} of ${view.songsTotal} chosen`;
  document.getElementById('total-label').textContent = fmt(view.total);
  const segments = view.sections.reduce((n, s) => n + s.rows.length, 0);
  document.getElementById('segments-label').textContent = `${segments} segments`;
}

function renderSegments(view) {
  document.getElementById('segments').innerHTML = view.sections.map((section) => {
    const rows = section.rows.map((r) => {
      const sub = r.kind === 'song' ? 'Song · ' + r.hint : r.kind === 'reading' ? 'Reading · ' + r.hint : r.hint;
      const valueStyle = r.kind === 'rite' ? 'display:none' : r.value ? 'color:#f7eef0;font-weight:600' : 'color:#b48d99';
      const btnLabel = r.kind === 'rite' ? 'Add note' : r.value ? 'Change' : 'Choose';
      const btnStyle = r.needs && !r.value && !r.optional ? 'border:0;background:#ecc98a;color:#1c070d' : 'border:1px solid #6e2a3e;background:#2a0c18;color:#f7eef0';
      return `
              <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 18px; border-bottom: 1px solid #2b1019">
                <span style="flex: none; width: 28px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #b48d99">${esc(r.id.padStart(2, '0'))}</span>
                <span style="flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                  <span style="font-size: 15px; font-weight: 700">${esc(r.name)}</span>
                  <span style="font-size: 12px; color: #b48d99">${esc(sub)}</span>
                </span>
                <span style="flex: 1 1 200px; min-width: 0; font-size: 14px; line-height: 1.4; ${valueStyle}">${r.kind === 'rite' ? '' : esc(r.value || 'Nothing chosen yet')}</span>
                <span style="flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 4px; border: 1px solid #55202f; border-radius: 9px; background: #150610">
                  <button type="button" data-step="${esc(r.id)}" data-delta="-1" aria-label="Fewer minutes for ${esc(r.name)}" ${r.m <= MIN_MINUTES ? 'disabled' : ''} style="width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: #ecc98a; font-size: 18px; font-weight: 700; cursor: pointer">−</button>
                  <span style="min-width: 46px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px">${r.m} min</span>
                  <button type="button" data-step="${esc(r.id)}" data-delta="1" aria-label="More minutes for ${esc(r.name)}" ${r.m >= MAX_MINUTES ? 'disabled' : ''} style="width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: #ecc98a; font-size: 18px; font-weight: 700; cursor: pointer">+</button>
                </span>
                <button type="button" style="height: 36px; padding: 0 14px; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; ${btnStyle}">${btnLabel}</button>
              </div>`;
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

document.querySelector('main').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.step) {
    const id = button.dataset.step;
    const delta = Number(button.dataset.delta);
    const row = PRAISE_PLAN.sections.flatMap((s) => s.rows).find((r) => r[0] === id);
    state.mins[id] = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, minutesOf(id, row[3]) + delta));
    state.dirty = true;
    render();
    // The list is redrawn, so keep keyboard focus on the same stepper button (or its pair if this one is now disabled).
    const again = document.querySelector(`[data-step="${CSS.escape(id)}"][data-delta="${delta}"]`);
    (again && !again.disabled ? again : document.querySelector(`[data-step="${CSS.escape(id)}"][data-delta="${-delta}"]`))?.focus();
  } else if (button.id === 'discard') {
    state = { mins: {}, dirty: false };
    render();
  } else if (button.id === 'save') {
    state.dirty = false;
    render();
  }
});

render();
