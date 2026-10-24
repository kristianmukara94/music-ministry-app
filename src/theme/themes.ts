/** The theme catalogue. Each id has a matching [data-theme] block in src/styles.css. */
export type ThemeId =
  | 'default' | 'light' | 'classic' | 'olive'
  | 'black-gold' | 'deep-teal' | 'burgundy' | 'wine' | 'slate'
  | 'ice-blue' | 'mint' | 'sage' | 'linen' | 'shell';

export type ThemeGroup = 'signature' | 'dark' | 'light';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  group: ThemeGroup;
}

export const THEMES: ThemeInfo[] = [
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

export const THEME_IDS = THEMES.map((t) => t.id);

export const isThemeId = (value: unknown): value is ThemeId => THEME_IDS.includes(value as ThemeId);

/** Points the whole document at a theme. Every colour variable re-resolves at once. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
}
