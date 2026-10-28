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

const HEX = /^#[0-9a-fA-F]{6}$/;

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
  };
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
