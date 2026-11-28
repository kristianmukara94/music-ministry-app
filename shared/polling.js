// Status reads on a timer. Two kinds: one that rests while nobody can see the window, and one shared by several readers so the main
// process is asked once however many parts of the screen show the answer.
//
// Neither is for a live output. A read that makes the main process do something the outputs depend on must not rest while hidden.

/**
 * Runs `run` now and every `ms` while the document is visible. Hidden (minimised or covered), nothing runs; on return it runs at once.
 * Returns the function that stops it.
 */
export function pollWhileVisible(run, ms, { doc = globalThis.document, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let timer = null;
  const rest = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const wake = () => {
    rest();
    if (doc.hidden) return;
    run();
    timer = setTimer(run, ms);
  };
  doc.addEventListener('visibilitychange', wake);
  wake();
  return () => {
    rest();
    doc.removeEventListener('visibilitychange', wake);
  };
}

/**
 * One timer for any number of readers. It runs while there is at least one, reads at once for the first, and hands a later reader the
 * latest answer straight away. A failed read answers null. A reply that arrives after a newer one is dropped.
 */
export function createSharedPoll({ read, intervalMs, setTimer = setInterval, clearTimer = clearInterval }) {
  const listeners = new Set();
  let timer = null;
  let latest;
  let known = false;
  let asked = 0;
  let answered = 0;

  const publish = (ticket, value) => {
    if (ticket <= answered || listeners.size === 0) return;
    answered = ticket;
    latest = value;
    known = true;
    for (const listener of listeners) listener(value);
  };

  const refresh = () => {
    const ticket = (asked += 1);
    return new Promise((resolve) => resolve(read())).then(
      (value) => publish(ticket, value),
      () => publish(ticket, null),
    );
  };

  return {
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      if (known) listener(latest);
      if (timer === null) {
        timer = setTimer(refresh, intervalMs);
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        clearTimer(timer);
        timer = null;
        known = false;
      };
    },
  };
}
