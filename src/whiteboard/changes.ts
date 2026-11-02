import { bridge } from '../live/bridge';

// Tells the panels that the Whiteboard's slides changed, so a list of them (the Go Live card) can reload. A change made in this window is
// announced here directly; a change made in another window (the slide editor) arrives from the main process.
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

export function notifyWhiteboardChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` after each change, from this window or another. Returns the function that stops listening. */
export function onWhiteboardChanged(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopWatching) stopWatching = bridge.whiteboard.onChanged(notifyWhiteboardChanged);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}
