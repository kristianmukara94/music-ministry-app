// The window's title-bar buttons (minimise, maximise, close) take the colours of the active theme, so they match the top bar.
// The table must match the --color-canvas and --color-fg values in each [data-theme] block of src/styles.css. The test in
// shared/title-bar.test.mjs reads that file and checks it.

/** The canvas (the top bar's background) and the foreground (the symbols) for each theme. */
export const TITLE_BAR_COLOURS = {
  obsidian: { canvas: '#0c0d10', fg: '#f1f1f4' },
  default: { canvas: '#100306', fg: '#f7eef0' },
  light: { canvas: '#faf6f4', fg: '#2a0f17' },
  classic: { canvas: '#0d1b2e', fg: '#f2f5fa' },
  olive: { canvas: '#141a0c', fg: '#f3f6ea' },
  'black-gold': { canvas: '#0a0a0a', fg: '#f6f1e4' },
  'deep-teal': { canvas: '#031f1e', fg: '#eefaf8' },
  burgundy: { canvas: '#2a0610', fg: '#fbeef0' },
  wine: { canvas: '#15070f', fg: '#f6eef5' },
  slate: { canvas: '#111418', fg: '#eef1f5' },
  'ice-blue': { canvas: '#eef6fb', fg: '#0f1d28' },
  mint: { canvas: '#eefaf4', fg: '#0d2318' },
  sage: { canvas: '#f1f4ee', fg: '#1c2416' },
  linen: { canvas: '#f8f3ea', fg: '#2b2117' },
  shell: { canvas: '#f6f5f8', fg: '#1d1a24' },
};

/** The height of the title bar in CSS pixels. Matches the top bar. */
export const TITLE_BAR_HEIGHT = 48;

/** The overlay options for a theme. Unknown themes fall back to the default. */
export function titleBarOverlayFor(theme) {
  const colours = TITLE_BAR_COLOURS[theme] ?? TITLE_BAR_COLOURS.default;
  return { color: colours.canvas, symbolColor: colours.fg, height: TITLE_BAR_HEIGHT };
}
