// One timer for every readout that shows the time to the second (the booth clock, the countdowns, the elapsed times), so they change
// together, in one redraw, however many there are.

/** `read` answers the time of the last tick; with nobody listening, the time now, steady within a second. */
export function createSecondClock({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const listeners = new Set();
  let timer = null;
  let value = now();

  // Each tick is aimed at the next whole second, so the clock never drifts.
  const arm = () => {
    timer = setTimer(() => {
      value = now();
      arm();
      for (const listener of listeners) listener();
    }, 1000 - (now() % 1000));
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === null) {
        value = now();
        arm();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || timer === null) return;
        clearTimer(timer);
        timer = null;
      };
    },
    read() {
      if (timer === null && Math.abs(now() - value) >= 1000) value = now();
      return value;
    },
  };
}
