// Loads things one at a time while the page is idle: first the wait before starting, then one load per idle moment, so reading a page's
// code never lands in the middle of the operator's click.

/**
 * `loaders` are functions returning promises, in order of need. `idle(callback)` runs the callback at an idle moment and returns a handle
 * for `cancelIdle`. A loader that fails is skipped: it is tried again when its page is opened. Returns a function that stops the rest.
 */
export function prefetchWhenIdle(loaders, { delayMs = 0, idle, cancelIdle, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let stopped = false;
  let handle = null;
  let timer = null;
  const next = (index) => {
    if (stopped || index >= loaders.length) return;
    handle = idle(() => {
      handle = null;
      Promise.resolve()
        .then(loaders[index])
        .catch(() => undefined)
        .then(() => next(index + 1));
    });
  };
  timer = setTimer(() => next(0), delayMs);
  return () => {
    stopped = true;
    clearTimer(timer);
    if (handle !== null) cancelIdle?.(handle);
  };
}
