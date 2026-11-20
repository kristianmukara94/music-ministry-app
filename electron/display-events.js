// Keeps what the projector shows apart from where its windows sit.
//
// Content (the welcome screen, a service slide, Blackout, the lower third) reaches the output windows as a live-state message only. Windows
// are opened, closed or moved for two reasons alone: an output switched on or off (outputsChanged), and the display layout really changing
// (createDisplayEventGate). A wireless display (Miracast / Wi-Fi Display) beside an HDMI one sends bursts of display-metrics-changed events
// while nothing has moved; the gate waits for a burst to settle and then acts only if a display's id, bounds, scale or rotation changed.

/** How long display-metrics-changed must be quiet before the layout is checked. */
export const METRICS_SETTLE_MS = 350;

/** The display layout as one string: each display's id, bounds, scale and rotation. The work area (the taskbar) is left out on purpose. */
export function displaySignature(displays) {
  return (displays ?? [])
    .map((d) => {
      const b = d.bounds ?? {};
      return `${d.id}:${b.x},${b.y},${b.width}x${b.height}@${d.scaleFactor ?? 1}r${d.rotation ?? 0}`;
    })
    .sort()
    .join('|');
}

/**
 * Takes the system's display events and calls `reconcile(event)` only when the layout needs a look.
 * - display-added and display-removed are acted on at once: an unplugged projector must be hidden before it shows on the operator's screen.
 *   A metrics check still waiting is dropped, as this one covers it.
 * - display-metrics-changed waits until the events stop for `settleMs`, then reconciles only if the layout differs from the last one acted on.
 */
export function createDisplayEventGate({ getDisplays, reconcile, settleMs = METRICS_SETTLE_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null;
  let last = displaySignature(getDisplays());

  const cancel = () => {
    if (pending !== null) clearTimer(pending);
    pending = null;
  };
  const run = (event) => {
    last = displaySignature(getDisplays());
    reconcile(event);
  };

  return {
    handle(event) {
      if (event !== 'display-metrics-changed') {
        cancel();
        run(event);
        return;
      }
      cancel();
      pending = setTimer(() => {
        pending = null;
        if (displaySignature(getDisplays()) === last) return;
        run(event);
      }, settleMs);
    },
    /** Drops a check still waiting (the app is quitting). */
    dispose: cancel,
  };
}

/** True when an output was switched on or off, the only live-state change that opens or closes an output window. */
export function outputsChanged(prev, next) {
  const a = prev?.outputs ?? {};
  const b = next?.outputs ?? {};
  if (a === b) return false;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((key) => a[key] !== b[key]);
}

/** True when two rectangles are the same, so a window already there is not moved again. */
export function sameBounds(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
