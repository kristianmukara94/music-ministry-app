// Projector output settings, shared by the main process (saved to config.json and used to place the window)
// and the renderer (sizes the stage, draws the idle screen, and animates changes). Pure: no Electron imports.

export const PROJECTOR_ASPECTS = ['16:9', '4:3'];
export const PROJECTOR_FITS = ['contain', 'fill'];
export const PROJECTOR_IDLE = ['black', 'crest', 'media'];
/** What the projector shows when its window first opens. "last" keeps whatever was live. */
export const PROJECTOR_STARTUP = ['welcome', 'black', 'last'];
/** How projected content changes. Each name maps to one entrance animation in the renderer. */
export const TRANSITION_STYLES = ['fade', 'slideLeft', 'slideRight', 'slideUp', 'zoomIn'];
export const FADE_MIN_MS = 100;
export const FADE_MAX_MS = 1000;

export const PROJECTOR_SETTINGS_DEFAULTS = {
  /** The display the projector opens on. Null means the first external display, or the primary when there is none. */
  displayId: null,
  /** Fullscreen when the projector is on an external display. Off means a windowed preview of the output. */
  fullscreen: true,
  aspect: '16:9',
  fit: 'contain',
  /** What shows when nothing is live: black, the parish crest, or a static image from the Media Library. */
  idle: 'crest',
  idleMedia: null,
  /** What the projector shows when its window first opens. A visible screen, so the window never opens blank. */
  startupScreen: 'welcome',
  /** Whether changes animate. Off means they switch at once. */
  transitionsOn: true,
  transitionStyle: 'fade',
  /** Duration of the transition, in milliseconds. */
  fadeMs: 500,
};

/** Keeps only known keys with valid values. Anything else falls back to the default. */
export function sanitizeProjectorSettings(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const fade = Number(p.fadeMs);
  return {
    displayId: Number.isInteger(p.displayId) ? p.displayId : null,
    fullscreen: typeof p.fullscreen === 'boolean' ? p.fullscreen : PROJECTOR_SETTINGS_DEFAULTS.fullscreen,
    aspect: PROJECTOR_ASPECTS.includes(p.aspect) ? p.aspect : PROJECTOR_SETTINGS_DEFAULTS.aspect,
    fit: PROJECTOR_FITS.includes(p.fit) ? p.fit : PROJECTOR_SETTINGS_DEFAULTS.fit,
    idle: PROJECTOR_IDLE.includes(p.idle) ? p.idle : PROJECTOR_SETTINGS_DEFAULTS.idle,
    idleMedia: typeof p.idleMedia === 'string' && p.idleMedia.startsWith('apcc-media://') ? p.idleMedia : null,
    startupScreen: PROJECTOR_STARTUP.includes(p.startupScreen) ? p.startupScreen : PROJECTOR_SETTINGS_DEFAULTS.startupScreen,
    transitionsOn: typeof p.transitionsOn === 'boolean' ? p.transitionsOn : PROJECTOR_SETTINGS_DEFAULTS.transitionsOn,
    transitionStyle: TRANSITION_STYLES.includes(p.transitionStyle) ? p.transitionStyle : PROJECTOR_SETTINGS_DEFAULTS.transitionStyle,
    fadeMs: Number.isFinite(fade) ? Math.min(FADE_MAX_MS, Math.max(FADE_MIN_MS, Math.round(fade))) : PROJECTOR_SETTINGS_DEFAULTS.fadeMs,
  };
}

/** The width and height ratio of a preset, for example 16/9. */
export function aspectRatioOf(aspect) {
  return aspect === '4:3' ? 4 / 3 : 16 / 9;
}
