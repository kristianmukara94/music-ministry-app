import type { CSSProperties } from 'react';

/**
 * Window-drag hit-testing for the frameless main window (titleBarStyle 'hidden' + titleBarOverlay in electron/main.js).
 *
 * Chromium turns every `-webkit-app-region: drag` box into a window-level hit-test rectangle. Those rectangles ignore z-index and
 * stacking: a modal painted on top of the top bar does NOT shield its buttons from a drag region underneath it. The top bar is a drag
 * region and wraps onto a second row on a narrow window, so it can reach well below the caption strip. The only thing that cancels a
 * drag rectangle is an element that says `no-drag` itself (later in the document wins), so every overlay that can sit over the top bar
 * marks its box and its controls `no-drag`. The `no-drag` / `app-drag` classes in src/styles.css do the same from a class name, and
 * every `[aria-modal="true"]` box gets `no-drag` there too.
 *
 * csstype has no `WebkitAppRegion` key, hence the casts; React writes it out as `-webkit-app-region`.
 */
export const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;
export const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;

/**
 * The height of the caption strip that holds the system's minimise / maximise / close buttons. Matches TITLE_BAR_HEIGHT in
 * shared/title-bar.js (checked by shared/print-lineup-dialog.test.js). Full-window studios start below it so none of their controls sit
 * under the caption buttons.
 */
export const TITLE_BAR_CLEARANCE = 48;
