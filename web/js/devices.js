// Devices & sync: the church's linked laptops, its recent sync activity, and the one-time code that links a new laptop. Everything
// comes from the server. Only an admin may make a code or unlink a laptop; the server refuses anyone else, and the page hides
// those controls when the server says this user cannot manage (canManage).
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { createLinkCode, listDevices, unlinkDevice } from './plan-api.js';

mountSidebar();

const TONE = {
  ok: { fg: '#8fd9ae', bg: '#12301f' },
  warn: { fg: '#f2bd6b', bg: '#33240c' },
  idle: { fg: '#dbb3bf', bg: '#2a1019' },
};
// A laptop that reached the server within this long is shown as connected.
const RECENT_MS = 24 * 60 * 60 * 1000;

const state = { canManage: false, devices: [], activity: [], code: null, expiresAt: null, busy: false, error: '' };
let countdown = null;

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** The status pill of one laptop, from when it last reached the server. */
function statusOf(device) {
  if (!device.lastSeenAt) return { text: 'Not connected yet', tone: 'idle' };
  const recent = Date.now() - new Date(device.lastSeenAt).getTime() < RECENT_MS;
  return recent ? { text: 'Connected', tone: 'ok' } : { text: 'Not seen lately', tone: 'warn' };
}

const message = (text, color = '#b48d99') => `<p style="margin: 0; padding: 16px 18px; font-size: 14px; color: ${color}">${esc(text)}</p>`;

function renderDevices() {
  const box = document.getElementById('devices');
  if (!state.devices.length) {
    box.innerHTML = message('No laptops are linked yet. Link one with a code from this page.');
    return;
  }
  box.innerHTML = state.devices.map((d) => {
    const status = statusOf(d);
    const meta = [d.adminName ? `Linked by ${d.adminName}` : 'Linked', d.linkedAt ? when(d.linkedAt) : '', d.lastSeenAt ? `last seen ${when(d.lastSeenAt)}` : '']
      .filter(Boolean)
      .join(' · ');
    return `
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px 18px; border-bottom: 1px solid #2b1019">
              <span style="flex: none; width: 44px; height: 44px; border-radius: 12px; background: #2a0c18; border: 1px solid #55202f; display: grid; place-items: center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ecc98a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>
              </span>
              <span style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
                <span style="font-size: 15px; font-weight: 700; overflow-wrap: anywhere">${esc(d.name)}</span>
                <span style="font-size: 12px; color: #b48d99">${esc(meta)}</span>
              </span>
              <span style="display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 99px; font-size: 12px; font-weight: 600; color:${TONE[status.tone].fg};background:${TONE[status.tone].bg}">${esc(status.text)}</span>
              ${state.canManage ? `<button type="button" data-unlink="${esc(d.id)}" data-name="${esc(d.name)}" ${state.busy ? 'disabled' : ''} style="height: 36px; padding: 0 14px; border-radius: 9px; border: 1px solid #6e2a3e; background: #2a0c18; color: #ff9a9a; font-size: 13px; font-weight: 700; cursor: pointer">Unlink</button>` : ''}
            </div>`;
  }).join('');
}

/** One line of sync activity in plain words. */
function activityText(a) {
  const who = a.actorName ?? 'An admin';
  const c = a.counts ?? {};
  switch (a.action) {
    case 'device.linked': return { text: `${who} linked a laptop`, tag: 'Linked', tone: 'ok' };
    case 'device.unlinked': return { text: 'A laptop was unlinked', tag: 'Unlinked', tone: 'idle' };
    case 'songs.synced': return { text: `Song list sent from a laptop: ${c.created ?? 0} new, ${c.updated ?? 0} changed, ${c.removed ?? 0} removed`, tag: 'Songs', tone: 'ok' };
    case 'plan.synced': return {
      text: `Plans sent from a laptop: ${c.accepted ?? 0} saved${c.conflict ? `, ${c.conflict} in conflict with a newer web edit` : ''}${c.error ? `, ${c.error} not saved` : ''}`,
      tag: c.conflict || c.error ? 'Check' : 'Plans',
      tone: c.conflict || c.error ? 'warn' : 'ok',
    };
    case 'plan.created': return { text: `${who} created a plan`, tag: 'Plan', tone: 'idle' };
    default: return { text: 'Sync activity', tag: '', tone: 'idle' };
  }
}

function renderActivity() {
  const box = document.getElementById('activity');
  if (!state.activity.length) {
    box.innerHTML = message('Nothing yet. Sync activity shows here once a laptop is linked.');
    return;
  }
  box.innerHTML = state.activity.map((a) => {
    const line = activityText(a);
    return `
            <div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; padding: 12px 18px; border-bottom: 1px solid #2b1019">
              <span style="flex: 0 0 150px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #b48d99">${esc(when(a.at))}</span>
              <span style="flex: 1 1 260px; min-width: 0; font-size: 14px; line-height: 1.4">${esc(line.text)}</span>
              <span style="font-size: 12px; font-weight: 600; color:${TONE[line.tone].fg}">${esc(line.tag)}</span>
            </div>`;
  }).join('');
}

function renderCode() {
  document.getElementById('link-admin').hidden = !state.canManage;
  document.getElementById('link-viewer').hidden = state.canManage;
  const left = state.expiresAt ? state.expiresAt - Date.now() : 0;
  const live = state.code && left > 0;
  document.getElementById('code').textContent = live ? state.code : '— — — —';
  const button = document.getElementById('new-code');
  button.textContent = live ? 'New code' : 'Create code';
  button.disabled = state.busy;
  let note = 'Valid for 10 minutes, one use';
  if (live) {
    const minutes = Math.floor(left / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    note = `Expires in ${minutes}:${String(seconds).padStart(2, '0')} · one use`;
  } else if (state.code) {
    note = 'This code has expired. Create a new one.';
  }
  document.getElementById('code-note').textContent = note;
  document.getElementById('devices-error').textContent = state.error;
}

function render() {
  renderDevices();
  renderActivity();
  renderCode();
}

async function load() {
  try {
    const data = await listDevices();
    state.canManage = Boolean(data.canManage);
    state.devices = Array.isArray(data.devices) ? data.devices : [];
    state.activity = Array.isArray(data.activity) ? data.activity : [];
    state.error = '';
  } catch (err) {
    state.error = err.message;
  }
  render();
}

document.getElementById('new-code').addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  state.error = '';
  renderCode();
  try {
    const { code, expiresAt } = await createLinkCode();
    state.code = code;
    state.expiresAt = new Date(expiresAt).getTime();
    clearInterval(countdown);
    countdown = setInterval(() => {
      renderCode();
      if (state.expiresAt <= Date.now()) clearInterval(countdown);
    }, 1000);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    renderCode();
  }
});

document.getElementById('devices').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-unlink]');
  if (!button || state.busy) return;
  if (!window.confirm(`Unlink "${button.dataset.name}"? It stops syncing until it is linked again with a new code.`)) return;
  state.busy = true;
  state.error = '';
  renderDevices();
  try {
    await unlinkDevice(button.dataset.unlink);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
  }
  await load();
});

// A laptop that syncs while the page is open shows up when the page is looked at again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void load();
});

if (await guard()) await load();
