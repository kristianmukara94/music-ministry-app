// Welcome screen settings, shared by the main process (saved to config.json) and the renderer (the projector and the
// settings page). Pure: no Electron imports.

export const WELCOME_TYPES = ['TEXT', 'IMAGE'];
/** The font size in pixels, measured on the 1920-wide reference screen, so it scales to any projector. */
export const WELCOME_FONT_MIN = 16;
export const WELCOME_FONT_MAX = 160;
export const WELCOME_MESSAGE_MAX = 500;

export const WELCOME_DEFAULTS = {
  welcomeType: 'TEXT',
  message: 'Welcome to Church',
  imageUrl: null,
  backgroundColor: '#000000',
  textColor: '#FFFFFF',
  fontSize: 48,
};

/** What "Reset content defaults" puts back: the type, the message and the image. */
export const WELCOME_CONTENT_DEFAULTS = {
  welcomeType: WELCOME_DEFAULTS.welcomeType,
  message: WELCOME_DEFAULTS.message,
  imageUrl: WELCOME_DEFAULTS.imageUrl,
};

/** What "Reset style defaults" puts back: the colours and the font size. */
export const WELCOME_STYLE_DEFAULTS = {
  backgroundColor: WELCOME_DEFAULTS.backgroundColor,
  textColor: WELCOME_DEFAULTS.textColor,
  fontSize: WELCOME_DEFAULTS.fontSize,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Keeps only known keys with valid values. Anything else falls back to the default. */
export function sanitizeWelcomeSettings(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const size = Number(w.fontSize);
  return {
    welcomeType: WELCOME_TYPES.includes(w.welcomeType) ? w.welcomeType : WELCOME_DEFAULTS.welcomeType,
    message: typeof w.message === 'string' ? w.message.slice(0, WELCOME_MESSAGE_MAX) : WELCOME_DEFAULTS.message,
    imageUrl: typeof w.imageUrl === 'string' && w.imageUrl.startsWith('apcc-media://') ? w.imageUrl : null,
    backgroundColor: typeof w.backgroundColor === 'string' && HEX.test(w.backgroundColor) ? w.backgroundColor.toUpperCase() : WELCOME_DEFAULTS.backgroundColor,
    textColor: typeof w.textColor === 'string' && HEX.test(w.textColor) ? w.textColor.toUpperCase() : WELCOME_DEFAULTS.textColor,
    fontSize: Number.isFinite(size) ? Math.min(WELCOME_FONT_MAX, Math.max(WELCOME_FONT_MIN, Math.round(size))) : WELCOME_DEFAULTS.fontSize,
  };
}
