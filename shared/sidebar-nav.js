// The left sidebar's pure logic: which navigation item is current, the Alt+1…Alt+4 page keys, the lineup count on Go Live, and what each
// footer output pill shows and does. No imports, so it runs in Electron, the browser and Node alike.

/**
 * The one navigation item that is current for a view, so two can never be highlighted together. The Whiteboard lives in Announcements and a
 * Praise & Worship plan in the Planner. Null for Settings, which the gear in the icon row marks instead.
 */
export function activeNavKey(view) {
  if (view === 'whiteboard') return 'announcements';
  if (view === 'praiseWorship') return 'planner';
  if (view === 'settings' || !view) return null;
  return view;
}

/** The pages with a number key, in working order: Alt+1 Service Console, Alt+2 Go Live, Alt+3 Song Lyrics, Alt+4 Planner. */
export const NAV_HOTKEYS = Object.freeze({ dashboard: 1, goLive: 2, lyrics: 3, planner: 4 });

/** A page's key as it is printed and stored ("Alt+2"), or null for a page without one. */
export function navHotkeyCombo(view) {
  return Object.hasOwn(NAV_HOTKEYS, view) ? `Alt+${NAV_HOTKEYS[view]}` : null;
}

/** Where typed keys belong to the field. */
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function isTextEntryTarget(target) {
  return Boolean(target && typeof target.closest === 'function' && target.closest(TEXT_ENTRY));
}

/**
 * The page a key press asks for, or null. Only Alt with a top-row digit: AltGr (which arrives as Ctrl+Alt), Shift, Meta, a held key's
 * repeats and the number pad (Windows Alt codes) are left alone, and so is any key typed in a field. The physical key is read, so a
 * keyboard layout that prints other characters on the top row works too.
 */
export function navHotkeyView(e) {
  if (!e || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented) return null;
  if (isTextEntryTarget(e.target)) return null;
  const digit = /^Digit([1-9])$/.exec(e.code ?? '')?.[1];
  if (!digit) return null;
  return Object.keys(NAV_HOTKEYS).find((view) => NAV_HOTKEYS[view] === Number(digit)) ?? null;
}

/**
 * How many items the loaded lineup holds, shown on Go Live. The Praise & Worship segments while that session is on air; otherwise the Holy
 * Mass queue; otherwise the loaded Praise & Worship session's segments. 0 when nothing is loaded. A number, so a store subscription on it
 * redraws only when the count changes.
 */
export function lineupCount(state) {
  const queue = state?.queue?.length ?? 0;
  const segments = state?.pw ? (state.pwLineup?.length ?? 0) : 0;
  if (state?.pw?.onAir && segments > 0) return segments;
  return queue || segments;
}

/**
 * The three footer output pills. `on` is the output showing, `paused` a frozen one, and `disabled` the way on closed by an expired license
 * (a live output can always be taken down). `intent` is what a click does, the same as the top bar and the Service Console cards: dispatch a
 * live action, or open the Lower 3rd editor when there is no lower third to show yet. `preview` is the booth preview window.
 */
export function outputPills(state, locked = false) {
  const { outputs, projector, lowerThird } = state;
  const lowerLive = lowerThird.live !== null;
  const lowerReady = lowerLive || lowerThird.staged !== null;
  return [
    {
      key: 'projector',
      on: outputs.projector,
      paused: outputs.projector && Boolean(projector.paused),
      ready: true,
      disabled: locked && !outputs.projector,
      intent: { type: 'dispatch', action: { type: 'output/toggle', output: 'projector' } },
    },
    {
      key: 'lowerThird',
      on: lowerLive,
      paused: lowerLive && Boolean(lowerThird.paused),
      ready: lowerReady,
      disabled: locked && !lowerLive,
      intent: lowerReady ? { type: 'dispatch', action: { type: 'lowerThird/toggle' } } : { type: 'openLowerThird' },
    },
    {
      key: 'preview',
      on: outputs.preview,
      paused: false,
      ready: true,
      disabled: false,
      intent: { type: 'dispatch', action: { type: 'output/toggle', output: 'preview' } },
    },
  ];
}
