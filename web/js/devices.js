// Devices & sync: the linked laptops, the conflict that needs a decision, the sync activity, and the link code.
import { ACTIVITY, CONFLICT, DEVICES, LINK_CODE } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';

mountSidebar();

const TONE = {
  ok: { fg: '#8fd9ae', bg: '#12301f' },
  warn: { fg: '#f2bd6b', bg: '#33240c' },
  idle: { fg: '#dbb3bf', bg: '#2a1019' },
};

const state = { choice: '', done: false, code: LINK_CODE };

/**
 * A new link code in the same form as the sample: two groups of four. Letters and digits that are easy to misread
 * (0, O, 1, I) are left out. Phase 2 gets the code from the server instead, which also enforces the 10 minute limit.
 */
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function renderDevices() {
  document.getElementById('devices').innerHTML = DEVICES.map((d) => `
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px 18px; border-bottom: 1px solid #2b1019">
              <span style="flex: none; width: 44px; height: 44px; border-radius: 12px; background: #2a0c18; border: 1px solid #55202f; display: grid; place-items: center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ecc98a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>
              </span>
              <span style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                <span style="font-size: 15px; font-weight: 700">${esc(d.name)}</span>
                <span style="font-size: 12px; color: #b48d99">${esc(d.meta)}</span>
              </span>
              <span style="display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 99px; font-size: 12px; font-weight: 600; color:${TONE[d.tone].fg};background:${TONE[d.tone].bg}">${esc(d.status)}</span>
              <button type="button" style="height: 36px; padding: 0 14px; border-radius: 9px; border: 1px solid #6e2a3e; background: #2a0c18; color: #ff9a9a; font-size: 13px; font-weight: 700; cursor: pointer">Unlink</button>
            </div>`).join('');
}

const card = (on) =>
  `flex:1 1 240px;min-width:0;text-align:left;display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:12px;background:${on ? '#2a0c18' : '#150610'};border:1px solid ${on ? '#ecc98a' : '#3a1523'};color:#f7eef0;cursor:pointer;font-family:inherit`;

function versionButton(key, label, version) {
  const on = state.choice === key;
  return `
              <button type="button" data-choice="${key}" aria-pressed="${on}" style="${card(on)}">
                <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.1em; color: #b48d99">${label}</span>
                <span style="font-size: 14px; font-weight: 700">${esc(version.edited)}</span>
                <span style="font-size: 13px; color: #dbb3bf; line-height: 1.45">${version.lines.map(esc).join('<br>')}</span>
              </button>`;
}

function renderConflict() {
  const picked = !!state.choice;
  const label = state.choice === 'web' ? 'web' : 'laptop';
  let note = 'Pick a version to continue.';
  let color = '#b48d99';
  if (state.done) {
    note = `Resolved. The ${label} version is now the plan on both sides.`;
    color = '#8fd9ae';
  } else if (picked) {
    note = `The ${label} version will replace the other.`;
    color = '#dbb3bf';
  }
  const keepStyle = `height:44px;padding:0 20px;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;${picked && !state.done ? 'border:0;background:#ecc98a;color:#1c070d;cursor:pointer' : 'border:1px solid #3a1523;background:transparent;color:#b48d99;cursor:default'}`;

  document.getElementById('conflict').innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; background: #2a0c18; border-bottom: 1px solid #55202f">
            <h2 style="margin: 0; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: #ecc98a">NEEDS YOUR DECISION</h2>
            <span style="display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 99px; background: #33240c; color: #f2bd6b; font-size: 12px; font-weight: 600">${CONFLICT.count} conflict${CONFLICT.count === 1 ? '' : 's'}</span>
          </div>
          <div style="padding: 18px; display: flex; flex-direction: column; gap: 16px">
            <div style="display: flex; flex-direction: column; gap: 4px">
              <span style="font-size: 17px; font-weight: 800">${esc(CONFLICT.title)}</span>
              <span style="font-size: 13px; line-height: 1.5; color: #dbb3bf">${esc(CONFLICT.detail)}</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 14px">${versionButton('web', 'WEB VERSION', CONFLICT.web)}${versionButton('laptop', 'LAPTOP VERSION', CONFLICT.laptop)}
            </div>
            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px">
              <span aria-live="polite" style="font-size: 13px; color: ${color}">${note}</span>
              <button type="button" data-action="keep" ${picked && !state.done ? '' : 'aria-disabled="true"'} style="${keepStyle}">${state.done ? 'Resolved' : 'Keep this version'}</button>
            </div>
          </div>`;
}

function renderActivity() {
  document.getElementById('activity').innerHTML = ACTIVITY.map((a) => `
            <div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; padding: 12px 18px; border-bottom: 1px solid #2b1019">
              <span style="flex: 0 0 96px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #b48d99">${esc(a.time)}</span>
              <span style="flex: 1 1 260px; min-width: 0; font-size: 14px; line-height: 1.4">${esc(a.text)}</span>
              <span style="font-size: 12px; font-weight: 600; color:${TONE[a.tone].fg}">${esc(a.tag)}</span>
            </div>`).join('');
}

function renderCode() {
  document.getElementById('code').textContent = state.code;
}

document.getElementById('conflict').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.choice) {
    state.choice = button.dataset.choice;
    state.done = false;
  } else if (button.dataset.action === 'keep') {
    if (!state.choice) return;
    state.done = true;
  } else {
    return;
  }
  const focus = button.dataset.choice ? `[data-choice="${state.choice}"]` : '[data-action="keep"]';
  renderConflict();
  document.querySelector(focus)?.focus();
});

document.getElementById('new-code').addEventListener('click', () => {
  state.code = makeCode();
  renderCode();
});

renderDevices();
renderConflict();
renderActivity();
renderCode();
