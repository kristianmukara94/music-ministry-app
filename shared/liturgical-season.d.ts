export type Season = 'advent' | 'christmas' | 'ordinary-time' | 'lent' | 'holy-week' | 'easter' | 'pentecost';

export const SEASONS: readonly Season[];
export const SEASON_THEME: Record<Season, string>;
export const AUTO_SEASON_THEME: 'season-auto';

export function easterSunday(year: number): Date;
export function firstSundayOfAdvent(year: number): Date;
export function baptismOfTheLord(year: number): Date;
export function seasonOf(date?: Date): Season;
export function seasonThemeOf(date?: Date): string;
export function resolveTheme<T extends string>(id: T, date?: Date): string;
