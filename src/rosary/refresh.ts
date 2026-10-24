// The rosary text changes in Settings (a save or an import). The deck listens and reloads, so the
// next prayer on the projector comes from the new text without a restart.
const ROSARY_CHANGED = 'apcc:rosary-changed';

export function notifyRosaryChanged() {
  window.dispatchEvent(new Event(ROSARY_CHANGED));
}

/** Calls `onChange` on every change. Returns the function that stops listening. */
export function onRosaryChanged(onChange: () => void) {
  window.addEventListener(ROSARY_CHANGED, onChange);
  return () => window.removeEventListener(ROSARY_CHANGED, onChange);
}
