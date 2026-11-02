// A writer that gathers quick changes into one write. Each change is merged into the pending patch, and the patch is written once no change
// has come for `delay` milliseconds. `flush` writes what is pending at once (for closing a page), and `cancel` drops it.
// Pure: the timer functions are passed in, so the tests drive time themselves.

/**
 * @param {{ delay: number, write: (patch: object) => unknown, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} options
 */
export function createDebouncedWriter({ delay, write, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null;
  let timer = null;

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  /** Writes the pending patch now, if there is one. Returns what `write` returned, or undefined when nothing was pending. */
  const flush = () => {
    stopTimer();
    if (pending === null) return undefined;
    const patch = pending;
    pending = null;
    return write(patch);
  };

  return {
    /** Adds a change. The write waits until `delay` has passed with no further change. */
    push(patch) {
      pending = { ...(pending ?? {}), ...patch };
      stopTimer();
      timer = setTimer(() => {
        timer = null;
        flush();
      }, delay);
    },
    flush,
    /** Drops the pending change without writing it. */
    cancel() {
      stopTimer();
      pending = null;
    },
    /** True while a change is waiting to be written. */
    hasPending: () => pending !== null,
  };
}
