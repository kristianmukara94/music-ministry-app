// Takes a timed Sanctuary Alert down when it runs out. The main process owns the live state, so the timer lives here: the projector clears
// on time even when the operator console is busy or reloading.

/**
 * Returns `watch(prev, next)`, to call after every live-state change. When a new timed alert goes up, it starts that alert's timer; when the
 * alert is cleared or replaced, the old timer stops. At expiry it calls `clear(id)`, which should dispatch `sanctuaryAlert/clear` with that
 * id, so a late timer can never take down a newer alert.
 */
export function createAlertExpiry({ clear, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let timedId = null;

  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    timedId = null;
  };

  function watch(prev, next) {
    const before = prev?.sanctuaryAlert ?? null;
    const alert = next?.sanctuaryAlert ?? null;
    if (before === alert) return;
    if (!alert || alert.id !== timedId) stop();
    if (!alert || alert.expiresAt === null || alert.id === timedId) return;
    const id = alert.id;
    timedId = id;
    timer = setTimer(() => {
      timer = null;
      timedId = null;
      clear(id);
    }, Math.max(0, alert.expiresAt - now()));
  }

  return { watch, stop };
}
