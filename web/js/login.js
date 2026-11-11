// Sign in. The username, password and church code go to the sign-in function. This page keeps three things in localStorage, none of
// them secret: the church code, the name of the church it belongs to, and which tab was last chosen. They save typing on every visit.
// The session lives in an HttpOnly cookie. On success the browser goes to Plans (Ministry Planner) or to Devices & sync (Booth Operator
// Sync); either page shows the change-password screen first if the password is temporary.
const CODE_KEY = 'apccmma.churchCode';
const CHURCH_KEY = 'apccmma.church'; // {"code": "K7QM-4XD2", "name": "Assumption Parish"}
const VIEW_KEY = 'apccmma.signInView';

/** A church code: two groups of four, from an alphabet with no I, O, 0 or 1. The server's schema checks the same pattern. */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const CODE_CHAR = /[A-HJ-NP-Z2-9]/;
const DESTINATIONS = { planner: 'index.html', booth: 'devices.html' };

const form = document.getElementById('sign-in');
const error = document.getElementById('sign-in-error');
const button = form.querySelector('button[type=submit]');

/** Reads localStorage, which can throw in a private window. */
function load(key) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Writes localStorage. A failure is ignored: the page works without it, and the value is typed again next time. */
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is blocked.
  }
}

/** The church this laptop signed in to last time, or null. */
function knownChurch() {
  try {
    const church = JSON.parse(load(CHURCH_KEY));
    return typeof church?.code === 'string' && typeof church?.name === 'string' && church.name.trim() ? church : null;
  } catch {
    return null;
  }
}

/** Keeps the church code and its name after a successful sign-in, and nothing else. */
function remember(code, name) {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return;
  save(CODE_KEY, code);
  if (typeof name === 'string' && name.trim()) save(CHURCH_KEY, JSON.stringify({ code, name: name.trim().slice(0, 120) }));
}

// The eyebrow names the church this browser signed in to last time. A first visit shows only the generic ministry line.
{
  const church = knownChurch();
  if (church) {
    document.querySelectorAll('[data-parish-line]').forEach((el) => {
      el.textContent = `${church.name} · Music Ministry`;
    });
  }
}

// ---- Tabs: Ministry Planner or Booth Operator Sync. They change only where the browser goes after signing in, and the wording. ----
const intro = document.getElementById('intro-text');
const roleNote = document.getElementById('role-note');
const tabs = form.elements.destination;

function showView(view) {
  for (const element of [intro, roleNote, button]) element.textContent = element.dataset[view];
}

const savedView = load(VIEW_KEY);
if (Object.hasOwn(DESTINATIONS, savedView)) tabs.value = savedView;
showView(tabs.value);
form.addEventListener('change', (event) => {
  if (event.target.name !== 'destination') return;
  showView(event.target.value);
  save(VIEW_KEY, event.target.value);
});

// ---- Church code: shaped as XXXX-XXXX while typing, with a status line under it. ----
const code = form.elements.churchCode;
const codeStatus = document.getElementById('code-status');

/** Upper case, letters and digits only, a dash after the fourth, at most eight. */
function formatCode(raw) {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

function setStatus(state, text) {
  codeStatus.dataset.state = state;
  code.dataset.state = state;
  codeStatus.textContent = text;
}

/** The status line. Only a code that signed in here before can show its church's name: the server never says which codes exist. */
function checkCode() {
  const value = code.value;
  const chars = value.replace('-', '');
  if (!chars) return setStatus('empty', 'Leave blank if your username is only used at one parish');
  if ([...chars].some((c) => !CODE_CHAR.test(c))) return setStatus('invalid', 'Church codes never use the letters I or O, or the digits 0 or 1');
  if (!CODE_PATTERN.test(value)) return setStatus('typing', `${8 - chars.length} more character${chars.length === 7 ? '' : 's'}`);
  const church = knownChurch();
  if (church && church.code === value) return setStatus('known', `✓ ${church.name}`);
  return setStatus('format', 'Code looks right. Your parish is checked when you sign in');
}

code.addEventListener('input', () => {
  // Keep the caret after the same letter it followed, even when a dash appears or disappears in front of it.
  const before = code.value.slice(0, code.selectionStart ?? code.value.length).replace(/[^A-Za-z0-9]/g, '').length;
  code.value = formatCode(code.value);
  let caret = 0;
  for (let seen = 0; caret < code.value.length && seen < before; caret += 1) if (code.value[caret] !== '-') seen += 1;
  try {
    code.setSelectionRange(caret, caret);
  } catch {
    // Not focused; nothing to place.
  }
  checkCode();
});

code.value = formatCode(load(CODE_KEY));
checkCode();

// ---- The eye button inside the password field shows or hides what was typed. The caret stays where it was. ----
const password = form.elements.password;
const eye = document.getElementById('password-toggle');
function showPassword(show) {
  password.type = show ? 'text' : 'password';
  eye.setAttribute('aria-pressed', String(show));
  eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}
eye.addEventListener('click', () => {
  const { selectionStart, selectionEnd } = password;
  showPassword(password.type === 'password');
  password.focus();
  try {
    password.setSelectionRange(selectionStart, selectionEnd);
  } catch {
    // Some browsers refuse a selection range on a password field. The caret then goes to the end, which is harmless.
  }
});

// "Forgot password?": a dialog with who to contact. Passwords are reset by the church's admin, never by email. Escape and the backdrop
// close it too, and focus goes back to the button that opened it.
const forgot = document.getElementById('forgot-dialog');
const forgotOpen = document.getElementById('forgot-open');
forgotOpen.addEventListener('click', () => {
  forgot.showModal();
  document.getElementById('forgot-close').focus();
});
document.getElementById('forgot-close').addEventListener('click', () => forgot.close());
forgot.addEventListener('click', (event) => {
  if (event.target === forgot) forgot.close();
});
forgot.addEventListener('close', () => forgotOpen.focus());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  const churchCode = formatCode(data.churchCode);
  if (churchCode && !CODE_PATTERN.test(churchCode)) {
    error.textContent = 'Check the church code. It looks like K7QM-4XD2, or leave it blank.';
    code.focus();
    return;
  }
  const body = { username: data.username.trim(), password: data.password };
  if (churchCode) body.churchCode = churchCode;

  button.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reply = await res.json().catch(() => ({}));
    if (res.ok) {
      remember(reply.churchCode, reply.churchName);
      window.location.href = DESTINATIONS[data.destination] ?? DESTINATIONS.planner;
      return;
    }
    error.textContent = reply.error || 'Could not sign in. Try again.';
  } catch {
    error.textContent = 'Cannot reach the planner. Check your connection and try again.';
  } finally {
    button.disabled = false;
    form.elements.password.value = '';
    showPassword(false);
  }
});
