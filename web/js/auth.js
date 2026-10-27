// Sign-in for the planner pages. Each page calls guard() before it shows anything. guard() asks the server who is signed in,
// sends the browser to the sign-in page if nobody is, and shows the change-password screen before anything else when the
// password is temporary. The session lives in an HttpOnly cookie that scripts cannot read. Nothing is kept in localStorage.
const API = '/.netlify/functions';
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

/** The screen a user with a temporary password sees before anything else. It resolves once the password is changed. */
function changePassword() {
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.className = 'change-password';
    screen.innerHTML = `
      <form class="change-password-form" novalidate>
        <h1>Choose your own password</h1>
        <p>Your admin gave you a temporary password. Choose a new one to continue. Use at least 10 characters.</p>
        <label>Current password
          <input name="currentPassword" type="password" required autocomplete="current-password">
        </label>
        <label>New password
          <input name="newPassword" type="password" required minlength="10" autocomplete="new-password">
        </label>
        <p class="change-password-error" role="alert"></p>
        <button type="submit">Save password and continue</button>
      </form>`;
    document.body.append(screen);
    const form = screen.querySelector('form');
    const error = screen.querySelector('.change-password-error');
    const button = form.querySelector('button');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const data = Object.fromEntries(new FormData(form));
      if (data.newPassword.length < 10) {
        error.textContent = 'Use at least 10 characters for the new password.';
        return;
      }
      button.disabled = true;
      try {
        const res = await fetch(`${API}/change-password`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
        });
        if (res.ok) {
          screen.remove();
          resolve();
          return;
        }
        const body = await res.json().catch(() => ({}));
        error.textContent = body.error || 'The password could not be changed. Try again.';
      } catch {
        error.textContent = 'Cannot reach the planner. Check your connection and try again.';
      } finally {
        button.disabled = false;
        form.reset();
      }
    });
    form.querySelector('input[name=currentPassword]').focus();
  });
}
