// Users: the church's admins manage its accounts here. Every change goes to the server, which checks the role and the church again, so the
// guards on this page only stop accidents. Temporary credentials appear only in the modal that follows a create or a reset, and nowhere else.
// Names and usernames reach the page through text nodes, so nothing a person typed is ever read as markup.
import { mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { ROLES, ROLE_LABEL, STATUS, credentialsText, filterUsers, isPending, isSelf, teamSummary } from './user-list.js';

mountSidebar();

const API = '/api';
const SELF_NOTE = 'This is your account. Another admin must change its role or disable it.';

const $ = (id) => document.getElementById(id);
const setError = (id, text) => {
  $(id).textContent = text;
};

let currentSessionUser = null;
// Set when an admin resets their own password. The server has ended this session, so the page stops asking it for anything.
let sessionEnded = false;
let refreshTicket = 0;
// Which control had focus when the list was redrawn, so a keyboard user keeps their place.
let focusKey = null;

const state = { users: [], list: 'loading', q: '', role: 'All', busy: new Set() };

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

/** One element. Strings among `children` become text nodes. An attribute set to false or null is left off. */
function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

const lastSignIn = (iso) => (iso ? new Date(iso).toLocaleString() : 'Never');
const message = (text) => h('li', { class: 'users-message' }, text);

function actionButton(action, label, user, spoken, { disabled = false, extra = {} } = {}) {
  return h(
    'button',
    { type: 'button', class: 'quiet', 'data-action': action, 'data-id': user.id, 'data-focus': `${action}:${user.id}`, 'aria-label': `${spoken} ${user.displayName}`, disabled, ...extra },
    label,
  );
}

function userCard(user) {
  const self = isSelf(user, currentSessionUser);
  const busy = state.busy.has(user.id);
  const status = STATUS[user.status];
  const noteId = `self-note-${user.id}`;
  const describedBy = self ? noteId : null;
  const roleSelect = h(
    'select',
    { 'data-role': user.id, 'data-focus': `role:${user.id}`, 'aria-label': `Role for ${user.displayName}`, 'aria-describedby': describedBy, disabled: self || busy },
    ...ROLES.map((role) => h('option', { value: role, selected: role === user.role }, ROLE_LABEL[role])),
  );
  const isDisabled = user.status === 'disabled';

  return h(
    'li',
    { class: 'user-card', 'data-row': user.id },
    h(
      'div',
      { class: 'user-card-who' },
      h('div', { class: 'user-card-name' }, h('span', {}, user.displayName), self ? h('span', { class: 'badge-pill badge-you' }, 'You') : null),
      h('span', { class: 'user-card-meta' }, `${user.username} · last sign-in ${lastSignIn(user.lastSignInAt)}`),
      self ? h('span', { id: noteId, class: 'user-card-meta' }, SELF_NOTE) : null,
    ),
    h('label', { class: 'field small' }, 'Role', roleSelect),
    h(
      'div',
      { class: 'user-card-badges' },
      h('span', { class: `badge-pill badge-${status.tone}` }, status.label),
      isPending(user) ? h('span', { class: 'badge-pill badge-pending', title: 'Nobody has signed in to this account yet.' }, 'Pending') : null,
    ),
    h(
      'div',
      { class: 'user-card-actions' },
      user.status === 'locked' ? actionButton('unlock', 'Unlock', user, 'Unlock', { disabled: busy }) : null,
      actionButton('reset', 'Reset password', user, 'Reset password for', { disabled: busy }),
      actionButton('toggle', isDisabled ? 'Enable' : 'Disable', user, isDisabled ? 'Enable' : 'Disable', {
        disabled: self || busy,
        extra: { 'data-disabled': String(isDisabled), 'aria-describedby': describedBy },
      }),
    ),
  );
}

function restoreFocus() {
  if (!focusKey) return;
  const active = document.activeElement;
  if (active !== document.body && !$('users').contains(active)) return;
  const target = $('users').querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
  if (target && !target.disabled) {
    target.focus();
    focusKey = null;
  } else if (state.busy.size === 0) {
    focusKey = null;
  }
}

function renderSummary() {
  const summary = teamSummary(state.users);
  const ready = state.list === 'ready';
  for (const name of Object.keys(summary)) $(`stat-${name}`).textContent = ready ? String(summary[name]) : '–';
}

function render() {
  renderSummary();
  const focused = document.activeElement?.closest?.('#users [data-focus]');
  if (focused) focusKey = focused.dataset.focus;

  const list = $('users');
  list.setAttribute('aria-busy', String(state.list === 'loading'));
  if (state.list === 'loading') {
    list.replaceChildren(message('Loading users…'));
    return;
  }
  if (state.list === 'failed') {
    list.replaceChildren(message('The list could not be loaded. Reload this page to try again.'));
    $('users-count').textContent = '';
    return;
  }

  const shown = filterUsers(state.users, state);
  const filtering = state.q.trim() !== '' || state.role !== 'All';
  $('users-count').textContent = filtering ? `Showing ${shown.length} of ${state.users.length}` : `${state.users.length} ${state.users.length === 1 ? 'person' : 'people'}`;
  if (shown.length) list.replaceChildren(...shown.map(userCard));
  else list.replaceChildren(message(state.users.length ? 'Nobody matches this search and role.' : 'No users yet.'));
  restoreFocus();
}

async function refresh() {
  if (sessionEnded) return;
  // Two changes can overlap. Only the answer to the latest request is drawn, so an older list never overwrites a newer one.
  const ticket = ++refreshTicket;
  try {
    const { users } = await call('users-list', 'GET');
    if (ticket !== refreshTicket) return;
    state.users = users;
    state.list = 'ready';
  } catch (err) {
    if (ticket !== refreshTicket) return;
    if (state.list === 'loading') state.list = 'failed';
    setError('users-error', err.message);
  }
  render();
}

/** Shows temporary credentials once, in the modal. Nothing is stored, and closing the modal empties it. */
function showCredentials(who, username, password, ownAccount = false) {
  $('credentials-who').textContent = who;
  $('credentials-username').textContent = username;
  $('credentials-password').textContent = password;
  $('credentials-copy-label').textContent = 'Copy';
  $('credentials-copy-status').textContent = '';
  $('credentials-self-note').hidden = !ownAccount;
  $('credentials-modal').showModal();
}

/** Runs one change on one account: its controls wait for the answer, a refusal stays on screen, and the list is read again either way. */
async function changeUser(user, work) {
  setError('users-error', '');
  state.busy.add(user.id);
  render();
  try {
    await work();
  } catch (err) {
    setError('users-error', err.message);
  }
  state.busy.delete(user.id);
  await refresh();
}

const findUser = (id) => state.users.find((u) => u.id === id);

$('add-user').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('add-error', '');
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  try {
    const created = await call('users-create', 'POST', { username: data.username.trim(), displayName: data.displayName.trim(), role: data.role });
    form.reset();
    showCredentials(created.user.displayName, created.user.username, created.temporaryPassword);
    await refresh();
  } catch (err) {
    setError('add-error', err.message);
  } finally {
    submit.disabled = false;
  }
});

$('users').addEventListener('change', async (event) => {
  const select = event.target.closest('select[data-role]');
  if (!select) return;
  const user = findUser(select.dataset.role);
  if (!user || isSelf(user, currentSessionUser)) return;
  const role = select.value;
  const previous = user.role;
  // The new role is drawn at once. If the server refuses, the select goes back to the saved role and the refusal stays on screen.
  user.role = role;
  await changeUser(user, async () => {
    try {
      await call('users-update', 'POST', { userId: user.id, role });
    } catch (err) {
      user.role = previous;
      throw err;
    }
  });
});

$('users').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const user = findUser(button.dataset.id);
  if (!user) return;
  const self = isSelf(user, currentSessionUser);

  if (button.dataset.action === 'unlock') {
    await changeUser(user, () => call('users-unlock', 'POST', { userId: user.id }));
  } else if (button.dataset.action === 'toggle') {
    if (self) return;
    const disable = button.dataset.disabled !== 'true';
    if (disable && !window.confirm('Disable this account? Their sessions end at once, and they cannot sign in until enabled.')) return;
    await changeUser(user, () => call('users-update', 'POST', { userId: user.id, disabled: disable }));
  } else if (button.dataset.action === 'reset') {
    // An admin may reset their own password, and it is how they replace one that still works. It ends this session, so they are told first.
    const question = self
      ? 'Reset your own password? You are signed out at once, and must sign in with the new temporary password shown next.'
      : 'Reset this password? A new temporary password is shown once, and their sessions end.';
    if (!window.confirm(question)) return;
    await changeUser(user, async () => {
      const reset = await call('users-reset-password', 'POST', { userId: user.id });
      sessionEnded = self;
      showCredentials(user.displayName, user.username, reset.temporaryPassword, self);
    });
  }
});

$('user-search-input').addEventListener('input', (event) => {
  state.q = event.target.value;
  render();
});

$('user-role-filter').addEventListener('change', (event) => {
  state.role = event.target.value;
  render();
});

$('credentials-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(credentialsText($('credentials-username').textContent, $('credentials-password').textContent));
    $('credentials-copy-label').textContent = 'Copied';
    $('credentials-copy-status').textContent = 'Copied to the clipboard.';
  } catch {
    $('credentials-copy-label').textContent = 'Copy';
    $('credentials-copy-status').textContent = 'This browser blocked the copy. Select the text above and copy it by hand.';
  }
});

$('credentials-close').addEventListener('click', () => $('credentials-modal').close());

// These credentials are shown once, so a stray Escape does not dismiss them. Done is the way out.
$('credentials-modal').addEventListener('cancel', (event) => event.preventDefault());

// Runs however the modal closes, so the credentials never stay in the page behind it.
$('credentials-modal').addEventListener('close', () => {
  $('credentials-username').textContent = '';
  $('credentials-password').textContent = '';
  if (sessionEnded) location.replace('login.html');
  else restoreFocus();
});

/** "/" jumps to the search, unless the person is typing somewhere or a modal is open. */
function onSearchHotkey(event) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  $('user-search-input').focus();
  $('user-search-input').select();
}

(async () => {
  const me = await guard();
  if (!me) return;
  // Planners and viewers are sent to Plans. The server refuses their requests anyway.
  if (me.role !== 'admin') {
    location.replace('index.html');
    return;
  }
  currentSessionUser = me;
  // Added only now, so the key cannot act behind the change-password screen.
  document.addEventListener('keydown', onSearchHotkey);
  await refresh();
})();
