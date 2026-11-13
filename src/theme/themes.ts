import { AUTO_SEASON_THEME, resolveTheme } from '../../shared/liturgical-season.js';
import { TOKEN_VARS, resolveReadableThemeTokens, type PaletteKey, type ThemePalette } from '../../shared/theme-contrast.js';

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

const PALETTE_VARS = Object.entries(TOKEN_VARS) as [PaletteKey, string][];

/**
 * Points the whole document at a theme, then runs the contrast engine over the colours it resolved to: any text, tint or outline
 * that falls short of its WCAG target is raised on <html> as an inline variable. The built-in themes already pass (their values in
 * styles.css are the engine's own output, checked by shared/theme-contrast.test.js), so for them this only sets color-scheme, which
 * makes native <select> menus, scrollbars and date pickers draw dark or light to match.
 */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  // Clear what the last theme raised, so this theme's own values are what gets measured.
  for (const [, name] of PALETTE_VARS) root.style.removeProperty(name);
  root.setAttribute('data-theme', resolvedTheme(id));

  const computed = getComputedStyle(root);
  const palette: Partial<Record<PaletteKey, string>> = {};
  for (const [key, name] of PALETTE_VARS) {
    const value = computed.getPropertyValue(name).trim();
    if (value) palette[key] = value;
  }
  if (!palette.canvas) return;
  try {
    const { tokens, scheme, changed } = resolveReadableThemeTokens(palette as ThemePalette);
    for (const key of changed) root.style.setProperty(TOKEN_VARS[key], tokens[key]);
    // The opaque surfaces always follow the theme's panel and canvas, even if a theme block forgot to declare them.
    if (palette.surface !== tokens.surface) root.style.setProperty(TOKEN_VARS.surface, tokens.surface);
    if (palette.surface2 !== tokens.surface2) root.style.setProperty(TOKEN_VARS.surface2, tokens.surface2);
    root.style.colorScheme = scheme;
  } catch {
    // A colour the engine cannot read (a var() or color-mix() in a hand-edited theme) leaves the theme as written.
  }
}
