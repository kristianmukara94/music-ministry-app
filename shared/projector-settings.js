// Projector output settings, shared by the main process (saved to config.json and used to place the window)
// and the renderer (sizes the stage, draws the idle screen, and animates changes). Pure: no Electron imports.
import { TEXT_FONTS, normalizeHex } from './text-style.js';
import { TEXT_CASES } from './text-fit.js';

export const PROJECTOR_ASPECTS = ['16:9', '4:3'];
export const PROJECTOR_FITS = ['contain', 'fill'];
/** The fonts an operator can pick for slide text. Georgia is left out: it is the system's own font, not one the app ships. */
export const SLIDE_FONTS = Object.keys(TEXT_FONTS).filter((key) => key !== 'georgia');
export const PROJECTOR_IDLE = ['black', 'crest', 'media'];
/** What the projector shows when its window first opens. "last" keeps whatever was live. */
export const PROJECTOR_STARTUP = ['welcome', 'black', 'last'];
/**
 * How projected content changes. Each name maps to one entrance animation in the renderer. Dissolve and push also animate the slide that
 * leaves, at the same time as the one that arrives: dissolve crossfades the two, push moves the old one out as the new one comes in.
 */
export const TRANSITION_STYLES = ['fade', 'dissolve', 'push', 'slideLeft', 'slideRight', 'slideUp', 'zoomIn'];
/** The transitions that keep the leaving slide on screen while it animates out. */
export const OVERLAP_TRANSITIONS = ['dissolve', 'push'];
/**
 * The size scale for slide text: 50% to 250% in steps of 10%, so lyrics can be read from the back of a large church. 100% is the size each
 * slide was laid out for. A long stanza still shrinks to fit at any step (see useTextAutoFit), so a large step never clips.
 */
export const SLIDE_FONT_SCALES = Array.from({ length: 21 }, (_, i) => Math.round((0.5 + i * 0.1) * 10) / 10);
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
  /**
   * Edge-to-edge (the Go Live MAX pill): song lyrics take almost the whole slide, with a thin clearance at the edges instead of the usual
   * inset, and are drawn at the largest size at which the stanza still fits (see EDGE_TO_EDGE in text-fit.js). A short chorus becomes very
   * large; a long verse still fits whole. Off by default.
   */
  edgeToEdge: false,
  /**
   * Whether a lyric or prayer line too long for the slide is broken into even lines at natural phrase breaks (see balanceProjectorLines in
   * text-fit.js), rather than filled to the edge with a word left alone on the next line. Off draws the browser's own wrap.
   */
  balanceLines: true,
  /**
   * The case slide text is drawn in on the projector, the TV, the previews and the lower third: 'original' (as typed), 'uppercase' or
   * 'lowercase' (see applyFrameTextCase in text-fit.js). It never changes the song, prayer or reading in its library.
   */
  textCase: 'original',
  /**
   * The alignment of slide text on the projector, the TV and the previews: 'left', 'center' or 'right' for every slide, or null to keep each
   * slide's own (centred unless its style says otherwise). The Go Live console's Text Alignment sets it.
   */
  slideAlign: null,
  /**
   * Whether a slide shows the small banner naming its Holy Mass slot or reading ("FIRST READING", "CONGREGATION RESPONSE") above its text.
   * A Holy Mass plan can override it for its own Mass (see slotTitleShown in live.js).
   */
  showSlotTitle: true,
  /**
   * The Media Library's background behind every slide, the Live set's slides included, in place of their own Live slide background. A
   * background staged while this is on goes on screen at once. A slide with its own picture still shows its picture.
   */
  backgroundEverywhere: false,
  /** Advanced output: the text colour, shadow and outline below are drawn over every slide's own look. Off, they are kept but not used. */
  advancedOutput: false,
  /** Advanced output: one colour for all slide text, or null to keep each slide's colours. */
  textColor: null,
  /** Advanced output: the strength of the shadow behind slide text, 0 (none) to 1. */
  textShadow: 0.6,
  /** Advanced output: the opacity of a thin dark outline around slide text, 0 (none) to 1. */
  textOutline: 0,
  /**
   * Auto-legibility: the shade over a background picture or video, and the shadow under slide text, follow how bright and busy the picture
   * is behind each text zone, so text stays readable (WCAG 4.5:1 and APCA Lc 60; see contrast.js). Off, the shade is manualShade and the
   * shadow is the fixed one. Advanced mode's shadow and outline, when on, are drawn over either.
   */
  autoLegibility: true,
  /** The shade over a background picture or video when auto-legibility is off, 0 (none) to 1. */
  manualShade: 0.4,
};

/** A number from 0 to 1, in steps of 0.05, or the fallback when it is not a number. */
function unit(value, fallback) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 20) / 20 : fallback;
}

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
    edgeToEdge: typeof p.edgeToEdge === 'boolean' ? p.edgeToEdge : PROJECTOR_SETTINGS_DEFAULTS.edgeToEdge,
    balanceLines: typeof p.balanceLines === 'boolean' ? p.balanceLines : PROJECTOR_SETTINGS_DEFAULTS.balanceLines,
    textCase: TEXT_CASES.includes(p.textCase) ? p.textCase : PROJECTOR_SETTINGS_DEFAULTS.textCase,
    slideAlign: ['left', 'center', 'right'].includes(p.slideAlign) ? p.slideAlign : null,
    showSlotTitle: typeof p.showSlotTitle === 'boolean' ? p.showSlotTitle : PROJECTOR_SETTINGS_DEFAULTS.showSlotTitle,
    backgroundEverywhere: typeof p.backgroundEverywhere === 'boolean' ? p.backgroundEverywhere : PROJECTOR_SETTINGS_DEFAULTS.backgroundEverywhere,
    advancedOutput: typeof p.advancedOutput === 'boolean' ? p.advancedOutput : PROJECTOR_SETTINGS_DEFAULTS.advancedOutput,
    textColor: normalizeHex(p.textColor),
    textShadow: unit(p.textShadow, PROJECTOR_SETTINGS_DEFAULTS.textShadow),
    textOutline: unit(p.textOutline, PROJECTOR_SETTINGS_DEFAULTS.textOutline),
    autoLegibility: typeof p.autoLegibility === 'boolean' ? p.autoLegibility : PROJECTOR_SETTINGS_DEFAULTS.autoLegibility,
    manualShade: unit(p.manualShade, PROJECTOR_SETTINGS_DEFAULTS.manualShade),
  };
}

/** The width and height ratio of a preset, for example 16/9. */
export function aspectRatioOf(aspect) {
  return aspect === '4:3' ? 4 / 3 : 16 / 9;
}
