export const WELCOME_TYPES: readonly ['TEXT', 'IMAGE'];
export const WELCOME_FONT_MIN: number;
export const WELCOME_FONT_MAX: number;
export const WELCOME_MESSAGE_MAX: number;

export interface WelcomeSettings {
  welcomeType: 'TEXT' | 'IMAGE';
  message: string;
  imageUrl: string | null;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
}

export const WELCOME_DEFAULTS: WelcomeSettings;
export const WELCOME_CONTENT_DEFAULTS: Pick<WelcomeSettings, 'welcomeType' | 'message' | 'imageUrl'>;
export const WELCOME_STYLE_DEFAULTS: Pick<WelcomeSettings, 'backgroundColor' | 'textColor' | 'fontSize'>;
export function sanitizeWelcomeSettings(raw: unknown): WelcomeSettings;
