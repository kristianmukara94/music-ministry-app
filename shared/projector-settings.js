// Projector output settings, shared by the main process (saved to config.json and used to place the window)
// and the renderer (sizes the stage, draws the idle screen, and animates changes). Pure: no Electron imports.
import { TEXT_FONTS } from './text-style.js';

export const PROJECTOR_ASPECTS = ['16:9', '4:3'];
export const PROJECTOR_FITS = ['contain', 'fill'];
/** The fonts an operator can pick for slide text. Georgia is left out: it is the system's own font, not one the app ships. */
export const SLIDE_FONTS = Object.keys(TEXT_FONTS).filter((key) => key !== 'georgia');
export const PROJECTOR_IDLE = ['black', 'crest', 'media'];
/** What the projector shows when its window first opens. "last" keeps whatever was live. */
export const PROJECTOR_STARTUP = ['welcome', 'black', 'last'];
/** How projected content changes. Each name maps to one entrance animation in the renderer. */
export const TRANSITION_STYLES = ['fade', 'slideLeft', 'slideRight', 'slideUp', 'zoomIn'];
/** The size scale for slide text: 70% to 150% in steps of 10%. 100% is the size each slide was laid out for. */
export const SLIDE_FONT_SCALES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
/** The first slide of a Praise & Worship item: its title card, or a solid black screen. */
export const INTRO_SLIDE_MODES = ['title', 'black'];
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
  /** The font for slide text on the projector and the TV. Null keeps each slide's own font, which is the look used so far. */
  slideFont: null,
  /** The intro slide's look when an item starts. The Live panel can change it for the item on air. */
  defaultIntroSlideMode: 'title',
  /** How large slide text is drawn, as a share of its normal size. 1 is the normal size. */
  slideFontScale: 1,
};

/** The scale step a value rounds to, or 1 when it is not a scale step at all. */
function nearestScale(value) {
  const step = Math.round(Number(value) * 10) / 10;
  return SLIDE_FONT_SCALES.includes(step) ? step : 1;
}

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
    slideFont: SLIDE_FONTS.includes(p.slideFont) ? p.slideFont : null,
    defaultIntroSlideMode: INTRO_SLIDE_MODES.includes(p.defaultIntroSlideMode) ? p.defaultIntroSlideMode : PROJECTOR_SETTINGS_DEFAULTS.defaultIntroSlideMode,
    slideFontScale: nearestScale(p.slideFontScale),
  };
}

/** The width and height ratio of a preset, for example 16/9. */
export function aspectRatioOf(aspect) {
  return aspect === '4:3' ? 4 / 3 : 16 / 9;
}
