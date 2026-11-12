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

export const WELCOME_SLIDE_TYPES: readonly ['TEXT', 'IMAGE', 'ANNOUNCEMENT'];
export type WelcomeSlideType = 'TEXT' | 'IMAGE' | 'ANNOUNCEMENT';
/** Seconds a slide stays up; 0 is Manual Step. */
export type WelcomeDwell = 5 | 10 | 15 | 0;
export const WELCOME_DWELLS: readonly WelcomeDwell[];
export const WELCOME_DWELL_DEFAULT: WelcomeDwell;
export const WELCOME_SLIDES_MAX: number;
export const WELCOME_TITLE_MAX: number;

/** One slide of the welcome carousel. */
export interface WelcomeSlide {
  id: string;
  type: WelcomeSlideType;
  /** The message (a text slide) or the card's body (an announcement). */
  text: string;
  /** The announcement card's heading. Unused by the other kinds. */
  title: string;
  /** The picture of an image slide. */
  imageUrl: string | null;
  dwell: WelcomeDwell;
}

export type WelcomeFont = 'INTER' | 'CINZEL' | 'ROBOTO' | 'CLASSIC';
export const WELCOME_FONTS: readonly WelcomeFont[];
export const WELCOME_FONT_STACKS: Record<WelcomeFont, string>;
export type WelcomeShadow = 'NONE' | 'SOFT' | 'OUTLINE';
export const WELCOME_SHADOWS: readonly WelcomeShadow[];
export const WELCOME_SCRIM_MAX: number;

export type CountdownMode = 'TARGET' | 'DURATION';
export type CountdownOnZero = 'HOLD' | 'FADE' | 'CLEAR';
export const COUNTDOWN_MODES: readonly CountdownMode[];
export const COUNTDOWN_ON_ZERO: readonly CountdownOnZero[];
export const COUNTDOWN_DURATION_MIN: number;
export const COUNTDOWN_DURATION_MAX: number;
export const COUNTDOWN_LABEL_MAX: number;

/** The pre-service countdown over the welcome screen. */
export interface WelcomeCountdown {
  enabled: boolean;
  mode: CountdownMode;
  /** 24-hour "HH:MM", today, on this computer's clock. */
  targetTime: string;
  durationSec: number;
  onZero: CountdownOnZero;
  /** The words over the digits. */
  label: string;
}
export const COUNTDOWN_DEFAULTS: WelcomeCountdown;

export interface WelcomeSettings extends BackgroundSettings {
  /** Legacy: the single welcome kind before the carousel. Read once to make the first slide. */
  welcomeType: 'TEXT' | 'IMAGE';
  /** Legacy: the single welcome message before the carousel. */
  message: string;
  /** Legacy: the single welcome picture before the carousel. */
  imageUrl: string | null;
  /** How a picture slide is fitted. Separate from the Welcome background's fit. */
  imageFit: ImageFit;
  textColor: string;
  fontSize: number;
  /** The Live set's slide background, saved separately from the Welcome background. */
  slideBackground: BackgroundSettings;
  /** The welcome carousel, in order. */
  slides: WelcomeSlide[];
  fontFamily: WelcomeFont;
  textShadow: WelcomeShadow;
  /** The dark gradient behind the text, 0 to 80 percent. */
  scrim: number;
  countdown: WelcomeCountdown;
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
export const WELCOME_TYPOGRAPHY_DEFAULTS: Pick<WelcomeSettings, 'fontFamily' | 'textShadow' | 'scrim'>;
export function sanitizeWelcomeSettings(raw: unknown): WelcomeSettings;
/** The slide showing `elapsedMs` after the carousel started on `start`, and its time left (null while it waits for the operator). */
export function carouselPosition(slides: readonly Pick<WelcomeSlide, 'dwell'>[], start: number, elapsedMs: number): { index: number; remainingMs: number | null };
/** Milliseconds left on the countdown, or null when it is off. Never below zero. */
export function countdownRemainingMs(countdown: WelcomeCountdown, now: number, startedAt: number): number | null;
export function formatCountdown(ms: number): string;
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
