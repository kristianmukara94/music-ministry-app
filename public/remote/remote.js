// The phone page for Remote view. It only reads: the laptop sends the live screen, and this page shows it. The one thing
// it sends is the PIN, when the laptop asks for one. Text is written with textContent, never as HTML.
(function () {
  'use strict';

  const SCREEN_TEXT = {
    off: 'The projector is off',
    idle: 'Nothing is on screen',
    blackout: 'Screen is blacked out',
    live: 'On screen',
  };
  const RETRY_MS = 2000;
  const PIN_CHECK_MS = 3000;

  const el = (id) => document.getElementById(id);
  const pinSection = el('pin');
  const view = el('view');
  const connection = el('connection');
  const pinForm = el('pin-form');
  const pinInput = el('pin-input');
  const pinError = el('pin-error');

  let source = null;
  let retryTimer = null;
  let pinWatch = null;

  function showOnly(section) {
    pinSection.hidden = section !== 'pin';
    view.hidden = section !== 'view';
  }

  // While the laptop cannot be reached, the last text is dimmed, so it is not read as the live line.
  function setConnected(ok) {
    connection.hidden = ok;
    view.classList.toggle('stale', !ok);
  }

  function render(snapshot) {
    el('status').textContent = SCREEN_TEXT[snapshot.screen] ?? '';
    el('title').textContent = snapshot.title || '';
    el('position').textContent = snapshot.position || '';
    el('lines').replaceChildren(
      ...snapshot.lines.map((text) => {
        const line = document.createElement('p');
        line.textContent = text || ' ';
        return line;
      }),
    );
    el('next').textContent = snapshot.next || 'Nothing after this';
  }

  async function readStatus() {
    const response = await fetch('/api/remote/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return response.json();
  }

  // On the PIN screen, the laptop is checked every few seconds. If the PIN is removed or changed while the page waits,
  // this phone goes live (or asks for the new PIN) without a reload.
  function askForPin() {
    if (source) {
      source.close();
      source = null;
    }
    // The laptop answered, so the connection banner does not belong on the PIN screen.
    connection.hidden = true;
    showOnly('pin');
    pinInput.value = '';
    pinInput.focus();
    clearInterval(pinWatch);
    pinWatch = setInterval(async () => {
      try {
        const status = await readStatus();
        if (!status.pinRequired || status.unlocked) connect();
      } catch {
        // The laptop cannot be reached right now. Keep the PIN screen and check again.
      }
    }, PIN_CHECK_MS);
  }

  function connect() {
    clearTimeout(retryTimer);
    clearInterval(pinWatch);
    if (source) source.close();
    source = new EventSource('/api/remote/stream');
    source.onopen = () => {
      setConnected(true);
      showOnly('view');
    };
    source.onmessage = (event) => {
      setConnected(true);
      render(JSON.parse(event.data));
    };
    source.onerror = () => {
      source.close();
      source = null;
      setConnected(false);
      recover();
    };
  }

  // The stream dropped. If the laptop now wants a PIN, ask for it. Otherwise try the stream again shortly.
  async function recover() {
    try {
      const status = await readStatus();
      if (status.pinRequired && !status.unlocked) return askForPin();
    } catch {
      // The laptop cannot be reached yet. Try again below.
    }
    retryTimer = setTimeout(connect, RETRY_MS);
  }

  async function start() {
    try {
      const status = await readStatus();
      if (status.pinRequired && !status.unlocked) return askForPin();
      connect();
    } catch {
      setConnected(false);
      retryTimer = setTimeout(start, RETRY_MS);
    }
  }

  pinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    pinError.textContent = '';
    let response;
    try {
      response = await fetch('/api/remote/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput.value }),
        cache: 'no-store',
      });
    } catch {
      pinError.textContent = 'Cannot reach the laptop. Check that this phone is on the same WiFi.';
      return;
    }
    if (response.ok) {
      pinInput.value = '';
      showOnly('view');
      connect();
      return;
    }
    const body = await response.json().catch(() => ({}));
    pinError.textContent = body.error || 'That PIN is not right.';
    pinInput.select();
  });

  void start();
})();
