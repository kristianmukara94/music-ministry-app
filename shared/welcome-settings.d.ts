export const WELCOME_TYPES: readonly ['TEXT', 'IMAGE'];
export const IMAGE_FITS: readonly ['FILL', 'FIT'];
export type ImageFit = 'FILL' | 'FIT';
export const BACKGROUND_TYPES: readonly ['COLOR', 'IMAGE', 'VIDEO'];
export type BackgroundType = 'COLOR' | 'IMAGE' | 'VIDEO';
export const WELCOME_FONT_MIN: number;
export const WELCOME_FONT_MAX: number;
export const WELCOME_MESSAGE_MAX: number;

/** One background's settings. The Welcome background and the Live slide background have these fields, and each is saved on its own. */
export interface BackgroundSettings {
  backgroundType: BackgroundType;
  /** The picture or video's media address (`apcc-media://media/<id>`), or null. */
  backgroundUrl: string | null;
  /** The picture last chosen, kept while the Video tab is used, so switching back shows it. */
  imageFile: string | null;
  /** The video last chosen, kept while the Image tab is used, so switching back shows it. */
  videoFile: string | null;
  /** Whether a video loops. When off, it plays once and holds its last frame. */
  videoLoop: boolean;
  /** Fill covers the output; Show whole picture leaves the colour in the bars. */
  backgroundFit: ImageFit;
  /** The colour behind the background, or null to keep each surface's own dark colour. */
  backgroundColor: string | null;
  /** Whether a dark shade sits behind the text when a picture or video is behind it. */
  textShade: boolean;
}

export interface WelcomeSettings extends BackgroundSettings {
  welcomeType: 'TEXT' | 'IMAGE';
  message: string;
  imageUrl: string | null;
  /** How the Welcome image is fitted (the picture on the Welcome screen). Separate from the Welcome background's fit. */
  imageFit: ImageFit;
  textColor: string;
  fontSize: number;
  /** The Live set's slide background, saved separately from the Welcome background. */
  slideBackground: BackgroundSettings;
}

/** The Welcome screen's colour when none is set. */
export const WELCOME_CANVAS_COLOR: string;
/** The Live slides' own colour when none is set: the design canvas. */
export const SLIDE_CANVAS_COLOR: string;
/** How dark the shade behind the text is, from 0 (none) to 1 (black). */
export const TEXT_SHADE_OPACITY: number;
export const BACKGROUND_DEFAULTS: BackgroundSettings;

export const WELCOME_DEFAULTS: WelcomeSettings;
export const WELCOME_CONTENT_DEFAULTS: Pick<WelcomeSettings, 'welcomeType' | 'message' | 'imageUrl' | 'imageFit'>;
export const WELCOME_STYLE_DEFAULTS: Pick<WelcomeSettings, 'backgroundType' | 'backgroundColor' | 'textColor' | 'fontSize'>;
export function sanitizeWelcomeSettings(raw: unknown): WelcomeSettings;
export function fittedPicture(imageFit: ImageFit, boxW: number, boxH: number, imgW: number, imgH: number): { scale: number; width: number; height: number; left: number; top: number };

export interface WelcomeBackground {
  /** The colour behind everything, or null when unset (each surface keeps its own dark colour). */
  color: string | null;
  media: { kind: 'image' | 'video'; src: string; fit: 'cover' | 'contain'; loop: boolean } | null;
  /** True when the shade sits behind the text: only ever with a picture or a video. */
  shade: boolean;
}
export function welcomeBackground(settings: BackgroundSettings, failed?: boolean): WelcomeBackground;
export function backgroundMissing(settings: BackgroundSettings, library: string[] | null): boolean;
