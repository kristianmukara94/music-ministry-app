// Welcome screen settings, shared by the main process (saved to config.json) and the renderer (the projector and the
// settings page). Pure: no Electron imports.
//
// There are two backgrounds, saved separately. The Welcome background (the top-level background fields here) is used only by the Welcome
// screen. The Live slide background (`slideBackground`, the same fields) is used only by the Live set's slides. Each has its own type,
// colour, file, Loop, Fill or Show whole picture, and shade. The Welcome image has its own Fill or Show whole picture (`imageFit`).

export const WELCOME_TYPES = ['TEXT', 'IMAGE'];
/** How a picture is fitted to the output: 'FILL' covers the whole output and crops the edges; 'FIT' shows the whole picture in the output. */
export const IMAGE_FITS = ['FILL', 'FIT'];
/** What a background is: a solid colour (the default), a picture, or a video clip. */
export const BACKGROUND_TYPES = ['COLOR', 'IMAGE', 'VIDEO'];
/** The font size in pixels, measured on the 1920-wide reference screen, so it scales to any projector. */
export const WELCOME_FONT_MIN = 16;
export const WELCOME_FONT_MAX = 160;
export const WELCOME_MESSAGE_MAX = 500;

/** The kinds of slide in the welcome carousel: a message, a picture, or an announcement card (a heading over a body). */
export const WELCOME_SLIDE_TYPES = ['TEXT', 'IMAGE', 'ANNOUNCEMENT'];
/** How long a slide stays up before the next, in seconds. 0 is Manual Step: it stays until the operator moves on. */
export const WELCOME_DWELLS = [5, 10, 15, 0];
export const WELCOME_DWELL_DEFAULT = 10;
export const WELCOME_SLIDES_MAX = 20;
export const WELCOME_TITLE_MAX = 120;

/**
 * The welcome typefaces. INTER is the default for a new install; CLASSIC (Cormorant Garamond) is what the welcome screen used before the choice
 * existed, so a parish that already saved its welcome screen keeps that look.
 */
export const WELCOME_FONTS = ['INTER', 'CINZEL', 'ROBOTO', 'CLASSIC'];
export const WELCOME_FONT_STACKS = {
  INTER: '"Inter Variable", "Segoe UI", system-ui, sans-serif',
  CINZEL: 'Cinzel, "Cormorant Garamond", Georgia, serif',
  ROBOTO: '"Roboto Variable", Roboto, "Segoe UI", sans-serif',
  CLASSIC: '"Cormorant Garamond", Georgia, serif',
};
export const WELCOME_SHADOWS = ['NONE', 'SOFT', 'OUTLINE'];
/** The contrast scrim behind the text, in percent: 0 is none, 80 the darkest. */
export const WELCOME_SCRIM_MAX = 80;

export const COUNTDOWN_MODES = ['TARGET', 'DURATION'];
/** What the countdown does at zero: stay on 00:00, fade the screen to black, or take itself and the background media away. */
export const COUNTDOWN_ON_ZERO = ['HOLD', 'FADE', 'CLEAR'];
export const COUNTDOWN_DURATION_MIN = 10;
export const COUNTDOWN_DURATION_MAX = 4 * 60 * 60;
export const COUNTDOWN_LABEL_MAX = 60;
export const COUNTDOWN_DEFAULTS = {
  enabled: false,
  mode: 'DURATION',
  /** 24-hour "HH:MM", today, on this computer's clock. */
  targetTime: '08:00',
  durationSec: 600,
  onZero: 'HOLD',
  label: 'Holy Mass begins in',
};

/**
 * One background's settings. The Welcome background and the Live slide background both have these fields, and each is saved on its own.
 * The colour is unset by default, so each surface keeps its own dark colour (the slides' canvas, the Welcome screen's black).
 */
export const BACKGROUND_DEFAULTS = {
  backgroundType: 'COLOR',
  backgroundUrl: null,
  // The picture and the video each keep their own file, so switching between Colour, Image and Video brings back the file of that kind.
  imageFile: null,
  videoFile: null,
  videoLoop: true,
  backgroundFit: 'FILL',
  backgroundColor: null,
  // A dark shade behind the text, when a picture or video is behind it, so light media does not hide the words.
  textShade: true,
};

export const WELCOME_DEFAULTS = {
  welcomeType: 'TEXT',
  message: 'Welcome to Church',
  imageUrl: null,
  imageFit: 'FILL',
  ...BACKGROUND_DEFAULTS,
  textColor: '#FFFFFF',
  fontSize: 48,
  // The carousel. `welcomeType`, `message` and `imageUrl` above are what a config saved before the carousel holds; they become its first slide.
  slides: [{ id: 'welcome', type: 'TEXT', text: 'Welcome to Church', title: '', imageUrl: null, dwell: WELCOME_DWELL_DEFAULT }],
  fontFamily: 'INTER',
  textShadow: 'NONE',
  scrim: 0,
  countdown: COUNTDOWN_DEFAULTS,
  // The Live set's slide background: its own settings, starting at the defaults.
  slideBackground: BACKGROUND_DEFAULTS,
};

/** What "Reset content defaults" puts back: the type, the message and the image. */
export const WELCOME_CONTENT_DEFAULTS = {
  welcomeType: WELCOME_DEFAULTS.welcomeType,
  message: WELCOME_DEFAULTS.message,
  imageUrl: WELCOME_DEFAULTS.imageUrl,
  imageFit: WELCOME_DEFAULTS.imageFit,
};

/** What "Reset style defaults" puts back: the Welcome background's colour and type, and the text colour and size. */
export const WELCOME_STYLE_DEFAULTS = {
  backgroundType: WELCOME_DEFAULTS.backgroundType,
  backgroundColor: WELCOME_DEFAULTS.backgroundColor,
  textColor: WELCOME_DEFAULTS.textColor,
  fontSize: WELCOME_DEFAULTS.fontSize,
};

/** What the Typography card's reset puts back. */
export const WELCOME_TYPOGRAPHY_DEFAULTS = {
  fontFamily: WELCOME_DEFAULTS.fontFamily,
  textShadow: WELCOME_DEFAULTS.textShadow,
  scrim: WELCOME_DEFAULTS.scrim,
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const MEDIA = (v) => (typeof v === 'string' && v.startsWith('apcc-media://') ? v : null);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The Welcome screen's colour when none is set. */
export const WELCOME_CANVAS_COLOR = '#000000';
/**
 * The Live slides' own colour when none is set: the design canvas (the `--color-canvas` of the default theme, see src/styles.css). The Live slide
 * panel's swatch shows this, so it matches what the slides show.
 */
export const SLIDE_CANVAS_COLOR = '#100306';
/** How dark the shade behind the text is, from 0 (none) to 1 (black). */
export const TEXT_SHADE_OPACITY = 0.45;

/**
 * Keeps only known background keys with valid values. `fitFallback` is the fit used when none is saved: the Welcome background starts from
 * the Welcome image's fit (its fit before the two were split), and the Live slide background starts at Fill.
 */
function sanitizeBackground(w, fitFallback) {
  return {
    backgroundType: BACKGROUND_TYPES.includes(w.backgroundType) ? w.backgroundType : BACKGROUND_DEFAULTS.backgroundType,
    backgroundUrl: typeof w.backgroundUrl === 'string' && w.backgroundUrl.startsWith('apcc-media://') ? w.backgroundUrl : null,
    imageFile: typeof w.imageFile === 'string' && w.imageFile.startsWith('apcc-media://') ? w.imageFile : null,
    videoFile: typeof w.videoFile === 'string' && w.videoFile.startsWith('apcc-media://') ? w.videoFile : null,
    videoLoop: typeof w.videoLoop === 'boolean' ? w.videoLoop : BACKGROUND_DEFAULTS.videoLoop,
    backgroundFit: IMAGE_FITS.includes(w.backgroundFit) ? w.backgroundFit : fitFallback,
    backgroundColor: typeof w.backgroundColor === 'string' && HEX.test(w.backgroundColor) ? w.backgroundColor.toUpperCase() : BACKGROUND_DEFAULTS.backgroundColor,
    textShade: typeof w.textShade === 'boolean' ? w.textShade : BACKGROUND_DEFAULTS.textShade,
  };
}

/** Keeps only known keys with valid values. Anything else falls back to the default. */
export function sanitizeWelcomeSettings(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const size = Number(w.fontSize);
  const slide = w.slideBackground && typeof w.slideBackground === 'object' ? w.slideBackground : {};
  // Migration: a config saved before the split has one background, which was drawn on the Welcome screen and the slides alike. Its fit was
  // the picture fit, `imageFit`, so the Welcome background takes that fit and the Welcome screen looks the same. The Live slide background has
  // no saved value yet, so it starts at its defaults.
  const legacyFit = IMAGE_FITS.includes(w.imageFit) ? w.imageFit : WELCOME_DEFAULTS.imageFit;
  return {
    welcomeType: WELCOME_TYPES.includes(w.welcomeType) ? w.welcomeType : WELCOME_DEFAULTS.welcomeType,
    message: typeof w.message === 'string' ? w.message.slice(0, WELCOME_MESSAGE_MAX) : WELCOME_DEFAULTS.message,
    imageUrl: typeof w.imageUrl === 'string' && w.imageUrl.startsWith('apcc-media://') ? w.imageUrl : null,
    imageFit: IMAGE_FITS.includes(w.imageFit) ? w.imageFit : WELCOME_DEFAULTS.imageFit,
    ...sanitizeBackground(w, legacyFit),
    textColor: typeof w.textColor === 'string' && HEX.test(w.textColor) ? w.textColor.toUpperCase() : WELCOME_DEFAULTS.textColor,
    fontSize: Number.isFinite(size) ? Math.min(WELCOME_FONT_MAX, Math.max(WELCOME_FONT_MIN, Math.round(size))) : WELCOME_DEFAULTS.fontSize,
    slideBackground: sanitizeBackground(slide, BACKGROUND_DEFAULTS.backgroundFit),
    slides: Array.isArray(w.slides) ? sanitizeSlides(w.slides) : [legacySlide(w)],
    // A welcome screen saved before the typeface choice keeps the serif it was drawn in. Nothing saved at all is a new install: Inter.
    fontFamily: WELCOME_FONTS.includes(w.fontFamily) ? w.fontFamily : Object.keys(w).length > 0 ? 'CLASSIC' : WELCOME_DEFAULTS.fontFamily,
    textShadow: WELCOME_SHADOWS.includes(w.textShadow) ? w.textShadow : WELCOME_DEFAULTS.textShadow,
    scrim: clampInt(w.scrim, 0, WELCOME_SCRIM_MAX, WELCOME_DEFAULTS.scrim),
    countdown: sanitizeCountdown(w.countdown),
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** The single welcome message or picture a config saved before the carousel, as its one slide. */
function legacySlide(w) {
  return {
    id: 'welcome',
    type: w.welcomeType === 'IMAGE' ? 'IMAGE' : 'TEXT',
    text: typeof w.message === 'string' ? w.message.slice(0, WELCOME_MESSAGE_MAX) : WELCOME_DEFAULTS.message,
    title: '',
    imageUrl: MEDIA(w.imageUrl),
    dwell: WELCOME_DWELL_DEFAULT,
  };
}

/** Keeps known slide kinds with valid fields, at most `WELCOME_SLIDES_MAX`, each with its own id. */
function sanitizeSlides(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (out.length >= WELCOME_SLIDES_MAX) break;
    if (!raw || typeof raw !== 'object' || !WELCOME_SLIDE_TYPES.includes(raw.type)) continue;
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 40) : `slide-${out.length + 1}`;
    while (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);
    out.push({
      id,
      type: raw.type,
      text: typeof raw.text === 'string' ? raw.text.slice(0, WELCOME_MESSAGE_MAX) : '',
      title: typeof raw.title === 'string' ? raw.title.slice(0, WELCOME_TITLE_MAX) : '',
      imageUrl: MEDIA(raw.imageUrl),
      dwell: WELCOME_DWELLS.includes(raw.dwell) ? raw.dwell : WELCOME_DWELL_DEFAULT,
    });
  }
  return out;
}

function sanitizeCountdown(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: c.enabled === true,
    mode: COUNTDOWN_MODES.includes(c.mode) ? c.mode : COUNTDOWN_DEFAULTS.mode,
    targetTime: typeof c.targetTime === 'string' && TIME.test(c.targetTime) ? c.targetTime : COUNTDOWN_DEFAULTS.targetTime,
    durationSec: clampInt(c.durationSec, COUNTDOWN_DURATION_MIN, COUNTDOWN_DURATION_MAX, COUNTDOWN_DEFAULTS.durationSec),
    onZero: COUNTDOWN_ON_ZERO.includes(c.onZero) ? c.onZero : COUNTDOWN_DEFAULTS.onZero,
    label: typeof c.label === 'string' ? c.label.slice(0, COUNTDOWN_LABEL_MAX) : COUNTDOWN_DEFAULTS.label,
  };
}

/**
 * Where the carousel is, `elapsedMs` after it was started on slide `start`: the slide showing and how long it has left (null for a Manual
 * Step slide, which waits for the operator, or a lone slide). Timed slides follow each other in order and wrap round to the first; a Manual
 * Step slide holds the carousel until the operator moves it on, which starts it again from the next slide.
 */
export function carouselPosition(slides, start, elapsedMs) {
  const n = slides.length;
  if (n === 0) return { index: -1, remainingMs: null };
  let index = ((Math.trunc(Number(start) || 0) % n) + n) % n;
  if (n === 1) return { index, remainingMs: null };
  let t = Math.max(0, Number(elapsedMs) || 0);
  // With every slide timed, whole turns of the carousel are skipped at once, so a screen left up for hours costs nothing.
  if (slides.every((s) => s.dwell > 0)) t %= slides.reduce((sum, s) => sum + s.dwell * 1000, 0);
  for (let step = 0; step <= n; step += 1) {
    const dwell = slides[index].dwell * 1000;
    if (dwell <= 0) return { index, remainingMs: null };
    if (t < dwell) return { index, remainingMs: dwell - t };
    t -= dwell;
    index = (index + 1) % n;
  }
  return { index, remainingMs: null };
}

/**
 * The time left on the pre-service countdown, in milliseconds, or null when it is off. A duration counts down from `startedAt` (when the
 * welcome screen went up); a target time counts down to that time today on this computer's clock. It never goes below zero.
 */
export function countdownRemainingMs(countdown, now, startedAt) {
  if (!countdown?.enabled) return null;
  if (countdown.mode === 'TARGET') {
    const match = TIME.exec(countdown.targetTime ?? '');
    if (!match) return null;
    const target = new Date(now);
    target.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return Math.max(0, target.getTime() - now);
  }
  return Math.max(0, startedAt + countdown.durationSec * 1000 - now);
}

/** "MM:SS", or "H:MM:SS" from an hour up. Rounds up, so the screen reads 00:01 until the very last moment, and 00:00 only at zero. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Where a picture sits in the output: its scale against its own pixels, its size and its offset. A fill covers the whole output (the
 * picture's overflow is cropped equally at both ends, so the picture stays centred); a fit shows the whole picture (the space left over is the
 * background colour). Both the projector and the settings preview draw the picture this way.
 */
export function fittedPicture(imageFit, boxW, boxH, imgW, imgH) {
  const cover = imageFit !== 'FIT';
  const scale = cover ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return { scale, width, height, left: (boxW - width) / 2, top: (boxH - height) / 2 };
}

/**
 * What one background draws behind its text. A colour is always there, behind everything. A picture or a video covers it when the file is
 * chosen and present (`failed` is set when the file would not load, and then the colour shows instead). `backgroundFit` is Fill or Show whole
 * picture: Fill covers the output, Show whole picture leaves the colour in the bars. A video loops when `videoLoop` is on, and otherwise plays
 * once and holds its last frame. Audio is always off. `settings` is a Welcome background or a Live slide background: the same fields.
 */
export function welcomeBackground(settings, failed = false) {
  const color = settings.backgroundColor;
  const kind = settings.backgroundType === 'VIDEO' ? 'video' : settings.backgroundType === 'IMAGE' ? 'image' : null;
  if (!kind || !settings.backgroundUrl || failed) return { color, media: null, shade: false };
  return {
    color,
    media: { kind, src: settings.backgroundUrl, fit: settings.backgroundFit === 'FIT' ? 'contain' : 'cover', loop: settings.videoLoop },
    // The shade is only ever behind a picture or a video: a colour background keeps its look.
    shade: settings.textShade !== false,
  };
}

/**
 * Whether the chosen file of one background is missing: a picture or video is chosen, but it is not in the media library (for example, it was
 * removed). `library` is the list of media addresses in the library, or null while it is not known yet (then nothing is reported).
 */
export function backgroundMissing(settings, library) {
  if (settings.backgroundType === 'COLOR' || !settings.backgroundUrl || library === null) return false;
  return !library.includes(settings.backgroundUrl);
}
