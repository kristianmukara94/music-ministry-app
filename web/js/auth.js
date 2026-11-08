// Sign-in for the planner pages. Each page calls guard() before it shows anything. guard() asks the server who is signed in,
// sends the browser to the sign-in page if nobody is, and shows the change-password screen before anything else when the
// password is temporary. The session lives in an HttpOnly cookie that scripts cannot read. Nothing is kept in localStorage.
import { passwordFormState } from './password-rules.js';

const API = '/api';
const pageRoot = () => document.documentElement.dataset.base ?? '';

/** The signed-in user, or null when nobody is signed in. Throws when the server cannot be reached. */
export async function currentUser() {
  const res = await fetch(`${API}/me`, { credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Sign-in check failed (${res.status}).`);
  return (await res.json()).user;
}

/** Ends the session on the server, then goes to the sign-in page. The cookie is cleared by the server response. */
export async function signOut() {
  try {
    await fetch(`${API}/logout`, { method: 'POST', credentials: 'same-origin' });
  } finally {
    location.replace(`${pageRoot()}login.html`);
  }
}

/** Shows the page only to a signed-in user. Returns the user, or null when the browser is being sent to sign in. */
export async function guard() {
  document.documentElement.classList.add('auth-pending');
  let user;
  try {
    user = await currentUser();
  } catch {
    showNotice('Cannot reach the planner. Check your connection, then reload this page.');
    return null;
  }
  if (!user) {
    location.replace(`${pageRoot()}login.html`);
    return null;
  }
  if (user.mustChangePassword) await changePassword();
  // Admin-only links appear only for an admin. The server still refuses the requests of anyone else.
  document.querySelectorAll('[data-admin-only]').forEach((link) => {
    link.hidden = user.role !== 'admin';
  });
  // The sidebar names who is signed in, from the server's answer. textContent, so a name is never read as markup.
  const ROLE_LABEL = { admin: 'Church admin', planner: 'Planner', viewer: 'Viewer' };
  document.querySelectorAll('[data-account-name]').forEach((el) => {
    el.textContent = user.displayName || user.username || '';
  });
  document.querySelectorAll('[data-account-role]').forEach((el) => {
    el.textContent = ROLE_LABEL[user.role] ?? '';
  });
  document.documentElement.classList.remove('auth-pending');
  return user;
}

function showNotice(text) {
  const box = document.createElement('p');
  box.setAttribute('role', 'alert');
  box.className = 'auth-notice';
  box.textContent = text;
  document.body.append(box);
}

// Lucide icons, inline because the site has no build step and loads no scripts from other sites.
const icon = (body, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON_SHIELD_CHECK = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>';
const ICON_EYE = '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>';
const ICON_EYE_OFF = '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>';
const ICON_CHECK_CIRCLE = '<circle cx="12" cy="12" r="10"/><path class="change-password-tick" d="m9 12 2 2 4-4"/>';
const ICON_KEY_ROUND = '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>';

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Strong'];
const SUBMIT_LABEL = 'Save Password and Continue';

/** One password box with its show/hide button. Called only with the fixed strings below, so nothing typed reaches this markup. */
function passwordField({ id, name, label, spoken, autocomplete, describedBy = '', after = '' }) {
  return `
    <div class="change-password-field">
      <label for="${id}" class="change-password-label">${label}</label>
      <div class="change-password-control">
        <input id="${id}" name="${name}" type="password" class="change-password-input" required aria-required="true" autocomplete="${autocomplete}" autocapitalize="off" autocorrect="off" spellcheck="false"${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
        <button type="button" class="change-password-toggle" aria-controls="${id}" data-spoken="${spoken}" aria-label="Show ${spoken}">
          <span class="change-password-eye">${icon(ICON_EYE, 18)}</span>
          <span class="change-password-eye-off">${icon(ICON_EYE_OFF, 18)}</span>
        </button>
      </div>
      ${after}
    </div>`;
}

const requirement = (key, text) => `
  <li class="change-password-requirement" data-requirement="${key}">
    ${icon(ICON_CHECK_CIRCLE, 16)}
    <span><span class="sr-only" data-requirement-status>Not met: </span>${text}</span>
  </li>`;

/** The page fonts are listed in each page's head; only this screen uses this one, so it is fetched when the screen opens. */
function loadScreenFont() {
  if (document.querySelector('link[data-change-password-font]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
  link.dataset.changePasswordFont = '';
  document.head.append(link);
}

/** The screen a user with a temporary password sees before anything else. It resolves once the password is changed. */
function changePassword() {
  loadScreenFont();
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.className = 'change-password';
    screen.innerHTML = `
      <form class="change-password-form" novalidate aria-labelledby="cp-title" aria-describedby="cp-intro">
        <span class="change-password-badge">${icon(ICON_SHIELD_CHECK, 14)} Secure account setup</span>
        <h1 id="cp-title">Choose your own password</h1>
        <p id="cp-intro" class="change-password-intro">Your admin gave you a temporary password. Replace it with one only you know.</p>
        ${passwordField({ id: 'cp-current', name: 'currentPassword', label: 'Current password', spoken: 'current password', autocomplete: 'current-password' })}
        <hr class="change-password-divider">
        ${passwordField({
          id: 'cp-new',
          name: 'newPassword',
          label: 'New password',
          spoken: 'new password',
          autocomplete: 'new-password',
          describedBy: 'cp-strength cp-requirements',
          after: `
            <div class="change-password-strength" data-level="0">
              <div class="change-password-bars" aria-hidden="true"><span></span><span></span><span></span></div>
              <p id="cp-strength" class="change-password-strength-label" aria-live="polite"></p>
            </div>
            <ul id="cp-requirements" class="change-password-requirements">
              ${requirement('length', 'At least 10 characters long')}
              ${requirement('numberOrSymbol', 'Contains a number or symbol')}
            </ul>`,
        })}
        ${passwordField({
          id: 'cp-confirm',
          name: 'confirmPassword',
          label: 'Confirm new password',
          spoken: 'password confirmation',
          autocomplete: 'new-password',
          describedBy: 'cp-mismatch',
          after: '<p id="cp-mismatch" class="change-password-mismatch" aria-live="polite"></p>',
        })}
        <p class="change-password-error" role="alert"></p>
        <button type="submit" class="change-password-submit" disabled>
          ${icon(ICON_KEY_ROUND, 18)}
          <span class="change-password-submit-label">${SUBMIT_LABEL}</span>
        </button>
      </form>`;
    document.body.append(screen);

    const form = screen.querySelector('form');
    const field = (name) => form.elements.namedItem(name);
    const current = field('currentPassword');
    const next = field('newPassword');
    const confirm = field('confirmPassword');
    const error = screen.querySelector('.change-password-error');
    const submit = screen.querySelector('.change-password-submit');
    const submitLabel = screen.querySelector('.change-password-submit-label');
    const strength = screen.querySelector('.change-password-strength');
    const strengthLabel = screen.querySelector('#cp-strength');
    const mismatch = screen.querySelector('#cp-mismatch');
    const toggles = [...screen.querySelectorAll('.change-password-toggle')];
    let busy = false;

    // Live regions are written only when their text changes, so a screen reader speaks once and not at every keystroke.
    const say = (element, text) => {
      if (element.textContent !== text) element.textContent = text;
    };

    const refresh = () => {
      const state = passwordFormState({ currentPassword: current.value, newPassword: next.value, confirmPassword: confirm.value });
      strength.dataset.level = String(state.strength);
      say(strengthLabel, state.strength ? `Strength: ${STRENGTH_LABEL[state.strength]}` : '');
      for (const row of screen.querySelectorAll('[data-requirement]')) {
        const met = state.checks[row.dataset.requirement];
        row.classList.toggle('is-met', met);
        row.querySelector('[data-requirement-status]').textContent = met ? 'Met: ' : 'Not met: ';
      }
      say(mismatch, state.mismatch ? 'Passwords do not match' : '');
      if (state.mismatch) confirm.setAttribute('aria-invalid', 'true');
      else confirm.removeAttribute('aria-invalid');
      submit.disabled = busy || !state.canSubmit;
    };

    const showPassword = (toggle, shown) => {
      form.querySelector(`#${toggle.getAttribute('aria-controls')}`).type = shown ? 'text' : 'password';
      toggle.classList.toggle('is-shown', shown);
      toggle.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} ${toggle.dataset.spoken}`);
    };
    for (const toggle of toggles) {
      toggle.addEventListener('click', () => showPassword(toggle, !toggle.classList.contains('is-shown')));
    }

    // Autofill can arrive as a change event alone.
    for (const type of ['input', 'change']) {
      form.addEventListener(type, () => {
        error.textContent = '';
        refresh();
      });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || submit.disabled) return;
      error.textContent = '';
      toggles.forEach((toggle) => showPassword(toggle, false));
      busy = true;
      submit.setAttribute('aria-busy', 'true');
      submitLabel.textContent = 'Saving…';
      refresh();
      // The focused button has just been disabled, so focus is put back on purpose once the answer is in.
      let focusAfter = submit;
      try {
        const res = await fetch(`${API}/change-password`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
        });
        if (res.ok) {
          screen.remove();
          resolve();
          return;
        }
        const body = await res.json().catch(() => ({}));
        error.textContent = body.error || 'The password could not be changed. Try again.';
        // Only the field the server refused is touched, so a wrong current password does not cost the new one.
        if (res.status === 401) {
          current.value = '';
          focusAfter = current;
        } else if (res.status === 400) {
          focusAfter = next;
        }
      } catch {
        error.textContent = 'Cannot reach the planner. Check your connection and try again.';
      } finally {
        busy = false;
        submit.removeAttribute('aria-busy');
        submitLabel.textContent = SUBMIT_LABEL;
        refresh();
        focusAfter.focus();
      }
    });

    refresh();
    current.focus();
  });
}
