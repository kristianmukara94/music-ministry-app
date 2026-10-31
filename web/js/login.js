// Sign in. The username, password and church code go to the sign-in function. The church code is the only thing this page
// keeps in localStorage: it is not a secret, and it saves typing it on every visit. The session lives in an HttpOnly cookie.
// On success the browser goes to Plans, where the change-password screen appears if the password is temporary.
const CODE_KEY = 'apccmma.churchCode';
const form = document.getElementById('sign-in');
const error = document.getElementById('sign-in-error');
const button = form.querySelector('button[type=submit]');

/** The church code remembered on this laptop, or an empty string. Reading it can fail in a private window. */
function rememberedCode() {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Keeps the church code, and nothing else. A failure to save is ignored: the page works without it. */
function remember(code) {
  try {
    if (typeof code === 'string' && /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) localStorage.setItem(CODE_KEY, code);
  } catch {
    // Storage is blocked. The code is typed again next time.
  }
}

form.elements.churchCode.value = rememberedCode();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  const body = { username: data.username.trim(), password: data.password };
  if (data.churchCode.trim()) body.churchCode = data.churchCode.trim();

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
      remember(reply.churchCode);
      window.location.href = 'index.html';
      return;
    }
    error.textContent = reply.error || 'Could not sign in. Try again.';
  } catch {
    error.textContent = 'Cannot reach the planner. Check your connection and try again.';
  } finally {
    button.disabled = false;
    form.elements.password.value = '';
  }
});
