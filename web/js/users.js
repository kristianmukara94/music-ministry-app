// Users: the church's admins manage its accounts here. Every change goes to the server, which checks the role and the
// church again. A temporary password appears only in the dialog that follows a create or a reset, and nowhere else.
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';

mountSidebar();

const API = '/api';
const ROLE_LABEL = { admin: 'Admin', planner: 'Planner', viewer: 'Viewer' };
const STATUS = {
  active: { label: 'Active', fg: 'var(--pill-text)', bg: 'var(--pill-bg)', edge: 'var(--pill-border)' },
  disabled: { label: 'Disabled', fg: 'var(--text)', bg: 'var(--border)', edge: 'transparent' },
  locked: { label: 'Locked', fg: 'var(--warn-text)', bg: 'var(--warn-bg)', edge: 'transparent' },
};

const $ = (id) => document.getElementById(id);
const setError = (id, text) => {
  $(id).textContent = text;
};

async function call(path, method, body) {
  let res;
  try {
    res = await fetch(`${API}/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the planner. Check your connection and try again.');
  }
  // A session that ended goes back to sign-in. Nothing typed here is worth keeping across it: a new user's form is short.
  if (res.status === 401) {
    location.replace('login.html');
    throw new Error('Your session has ended. Sign in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not do that (${res.status}).`);
  return data;
}

/** Shows a temporary password once, in the dialog. Nothing is stored. */
function showTemporary(who, password) {
  $('temp-who').textContent = who;
  $('temp-value').textContent = password;
  $('temp-dialog').showModal();
}

function lastSignIn(iso) {
  return iso ? new Date(iso).toLocaleString() : 'Never';
}

function rowHtml(u) {
  const s = STATUS[u.status];
  return `
    <div data-row="${esc(u.id)}" style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px 18px; border-bottom: 1px solid var(--border)">
      <span style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 3px">
        <span style="font-size: 15px; font-weight: 700">${esc(u.displayName)}</span>
        <span style="font-size: 12px; color: var(--muted)">${esc(u.username)} · last sign-in ${esc(lastSignIn(u.lastSignInAt))}</span>
      </span>
      <label class="field small">Role
        <select data-role="${esc(u.id)}">
          ${['admin', 'planner', 'viewer'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
        </select>
      </label>
      <span style="display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 99px; font-size: 12px; font-weight: 600; border: 1px solid ${s.edge}; color: ${s.fg}; background: ${s.bg}">${s.label}</span>
      <span style="display: inline-flex; flex-wrap: wrap; gap: 8px">
        ${u.status === 'locked' ? `<button type="button" class="quiet" data-action="unlock" data-id="${esc(u.id)}">Unlock</button>` : ''}
        <button type="button" class="quiet" data-action="reset" data-id="${esc(u.id)}">Reset password</button>
        <button type="button" class="quiet" data-action="toggle" data-id="${esc(u.id)}" data-disabled="${u.status === 'disabled'}">${u.status === 'disabled' ? 'Enable' : 'Disable'}</button>
      </span>
    </div>`;
}

async function refresh() {
  try {
    const { users } = await call('users-list', 'GET');
    $('users').innerHTML = users.length
      ? `<div class="eyebrow" style="padding: 14px 18px; background: var(--input-bg); border-bottom: 1px solid var(--border)">${users.length} PEOPLE IN THIS CHURCH</div>${users.map(rowHtml).join('')}`
      : '<p style="margin: 0; padding: 18px; font-size: 14px; color: var(--muted)">No users yet.</p>';
  } catch (err) {
    setError('users-error', err.message);
  }
}

$('add-user').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('add-error', '');
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const created = await call('users-create', 'POST', { username: data.username.trim(), displayName: data.displayName.trim(), role: data.role });
    form.reset();
    showTemporary(`${created.user.displayName} (${created.user.username})`, created.temporaryPassword);
    await refresh();
  } catch (err) {
    setError('add-error', err.message);
  }
});

$('users').addEventListener('change', async (event) => {
  const select = event.target.closest('select[data-role]');
  if (!select) return;
  setError('users-error', '');
  try {
    await call('users-update', 'POST', { userId: select.dataset.role, role: select.value });
    await refresh();
  } catch (err) {
    // The refusal stays on screen. The reload puts the select back on the saved role.
    setError('users-error', err.message);
    await refresh();
  }
});

$('users').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  const name = button.closest('[data-row]')?.querySelector('span span')?.textContent ?? 'this person';
  setError('users-error', '');
  try {
    if (button.dataset.action === 'unlock') {
      await call('users-unlock', 'POST', { userId: id });
    } else if (button.dataset.action === 'toggle') {
      const disable = button.dataset.disabled !== 'true';
      if (disable && !window.confirm('Disable this account? Their sessions end at once, and they cannot sign in until enabled.')) return;
      await call('users-update', 'POST', { userId: id, disabled: disable });
    } else if (button.dataset.action === 'reset') {
      if (!window.confirm('Reset this password? A new temporary password is shown once, and their sessions end.')) return;
      const reset = await call('users-reset-password', 'POST', { userId: id });
      showTemporary(name, reset.temporaryPassword);
    }
  } catch (err) {
    setError('users-error', err.message);
  }
  await refresh();
});

$('temp-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('temp-value').textContent);
    $('temp-copy').textContent = 'Copied';
  } catch {
    $('temp-copy').textContent = 'Select and copy';
  }
});
$('temp-close').addEventListener('click', () => {
  $('temp-value').textContent = '';
  $('temp-dialog').close();
  $('temp-copy').textContent = 'Copy';
});

(async () => {
  const me = await guard();
  if (!me) return;
  // Planners and viewers are sent to Plans. The server refuses their requests anyway.
  if (me.role !== 'admin') {
    location.replace('index.html');
    return;
  }
  await refresh();
})();
