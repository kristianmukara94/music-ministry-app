import { AUTO_SEASON_THEME, resolveTheme } from '../../shared/liturgical-season.js';

/** The theme catalogue. Each id has a matching [data-theme] block in src/styles.css, except `season-auto`. */
export type SeasonThemeId = 'advent' | 'christmas' | 'ordinary-time' | 'lent' | 'holy-week' | 'easter' | 'pentecost';

export type ThemeId =
  | 'obsidian' | 'default' | 'light' | 'classic' | 'olive'
  | 'black-gold' | 'deep-teal' | 'burgundy' | 'wine' | 'slate'
  | 'ice-blue' | 'mint' | 'sage' | 'linen' | 'shell'
  | SeasonThemeId
  /** Follows the Church calendar: today's season picks the colours. Never a [data-theme] itself. */
  | 'season-auto';

export type ThemeGroup = 'seasonal' | 'signature' | 'dark' | 'light';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  group: ThemeGroup;
  /** Seasonal themes: when the season runs and its liturgical colour, shown on the card. */
  detail?: string;
}

export const THEMES: ThemeInfo[] = [
  { id: 'advent', name: 'Advent', group: 'seasonal', detail: 'Violet · First Sunday of Advent to Dec 24' },
  { id: 'christmas', name: 'Christmas', group: 'seasonal', detail: 'White & gold · Dec 25 to the Baptism of the Lord' },
  { id: 'ordinary-time', name: 'Ordinary Time', group: 'seasonal', detail: 'Green · After Christmas and after Pentecost' },
  { id: 'lent', name: 'Lent', group: 'seasonal', detail: 'Violet · Ash Wednesday to Holy Week' },
  { id: 'holy-week', name: 'Holy Week', group: 'seasonal', detail: 'Red · Palm Sunday to Holy Saturday' },
  { id: 'easter', name: 'Easter', group: 'seasonal', detail: 'White & gold · Easter Sunday to Pentecost' },
  { id: 'pentecost', name: 'Pentecost', group: 'seasonal', detail: 'Red · Pentecost Sunday' },
  { id: 'obsidian', name: 'Obsidian Console', group: 'signature' },
  { id: 'default', name: 'APCCMMA Default', group: 'signature' },
  { id: 'light', name: 'APCCMMA Light', group: 'signature' },
  { id: 'classic', name: 'Classic', group: 'signature' },
  { id: 'olive', name: 'Olive', group: 'signature' },
  { id: 'black-gold', name: 'Black & Gold', group: 'dark' },
  { id: 'deep-teal', name: 'Deep Teal', group: 'dark' },
  { id: 'burgundy', name: 'Burgundy', group: 'dark' },
  { id: 'wine', name: 'Wine', group: 'dark' },
  { id: 'slate', name: 'Slate', group: 'dark' },
  { id: 'ice-blue', name: 'Ice Blue', group: 'light' },
  { id: 'mint', name: 'Mint', group: 'light' },
  { id: 'sage', name: 'Sage', group: 'light' },
  { id: 'linen', name: 'Linen', group: 'light' },
  { id: 'shell', name: 'Shell', group: 'light' },
];

export const THEME_IDS: ThemeId[] = [...THEMES.map((t) => t.id), AUTO_SEASON_THEME];

export const isThemeId = (value: unknown): value is ThemeId => THEME_IDS.includes(value as ThemeId);

/** The [data-theme] a theme id paints with today. `season-auto` becomes the current season's theme. */
export const resolvedTheme = (id: ThemeId, date: Date = new Date()): Exclude<ThemeId, 'season-auto'> => resolveTheme(id, date) as Exclude<ThemeId, 'season-auto'>;

/** Points the whole document at a theme. Every colour variable re-resolves at once. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', resolvedTheme(id));
}
