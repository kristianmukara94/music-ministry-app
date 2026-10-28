export const PROJECTOR_ASPECTS: readonly ['16:9', '4:3'];
export const PROJECTOR_FITS: readonly ['contain', 'fill'];
export const PROJECTOR_IDLE: readonly ['black', 'crest', 'media'];
export const PROJECTOR_STARTUP: readonly ['welcome', 'black', 'last'];
export const TRANSITION_STYLES: readonly ['fade', 'slideLeft', 'slideRight', 'slideUp', 'zoomIn'];
export const FADE_MIN_MS: number;
export const FADE_MAX_MS: number;
export const SLIDE_FONTS: string[];
export const INTRO_SLIDE_MODES: readonly ['title', 'black'];
export const SLIDE_FONT_SCALES: readonly number[];

export interface ProjectorSettings {
  displayId: number | null;
  fullscreen: boolean;
  aspect: '16:9' | '4:3';
  fit: 'contain' | 'fill';
  idle: 'black' | 'crest' | 'media';
  idleMedia: string | null;
  startupScreen: 'welcome' | 'black' | 'last';
  transitionsOn: boolean;
  transitionStyle: 'fade' | 'slideLeft' | 'slideRight' | 'slideUp' | 'zoomIn';
  fadeMs: number;
  slideFont: string | null;
  defaultIntroSlideMode: 'title' | 'black';
  slideFontScale: number;
}

export const PROJECTOR_SETTINGS_DEFAULTS: ProjectorSettings;
export function sanitizeProjectorSettings(raw: unknown): ProjectorSettings;
export function aspectRatioOf(aspect: ProjectorSettings['aspect']): number;
