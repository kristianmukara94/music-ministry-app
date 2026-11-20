// The colour themes a page can be painted with, shared by the laptop's main process, the cloud API and the tests. Each id has a
// [data-theme] block in shared/theme-tokens.css. The laptop's own picker (src/theme/themes.ts) lists the same ids plus `season-auto`,
// which is never painted: it resolves to today's season first. web/js/theme-init.js keeps its own copy of this list (it is a classic
// script and cannot import), and shared/theme-tokens.test.js checks that every copy agrees.
import { resolveTheme } from './liturgical-season.js';

/** Every paintable theme, in the laptop's picker order. */
export const THEME_CATALOG = Object.freeze([
  { id: 'advent', name: 'Advent', group: 'seasonal' },
  { id: 'christmas', name: 'Christmas', group: 'seasonal' },
  { id: 'ordinary-time', name: 'Ordinary Time', group: 'seasonal' },
  { id: 'lent', name: 'Lent', group: 'seasonal' },
  { id: 'holy-week', name: 'Holy Week', group: 'seasonal' },
  { id: 'easter', name: 'Easter', group: 'seasonal' },
  { id: 'pentecost', name: 'Pentecost', group: 'seasonal' },
  { id: 'rose', name: 'Rose Sunday', group: 'seasonal' },
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
]);

export const PAINTED_THEME_IDS = Object.freeze(THEME_CATALOG.map((t) => t.id));

/** The laptop's default theme (electron/config.js), and what the website paints before it has heard from a laptop. */
export const DEFAULT_THEME = 'obsidian';

/** True for an id that has a [data-theme] block. `season-auto` is not one. */
export const isPaintedTheme = (value) => typeof value === 'string' && PAINTED_THEME_IDS.includes(value);

/** The theme a chosen id paints with on `date`: `season-auto` becomes the season's theme; an unknown id becomes the default. */
export function paintedTheme(id, date = new Date()) {
  const resolved = resolveTheme(id, date);
  return isPaintedTheme(resolved) ? resolved : DEFAULT_THEME;
}

/**
 * A website address with `?theme=<id>` added, so a browser tab opened from the laptop paints the laptop's theme on its first frame.
 * Only addresses on the church's cloud website (`websiteOrigin`) are changed; any other address, or one that cannot be read, comes back
 * as it was. An existing `theme` parameter is replaced.
 */
export function withThemeParam(address, theme, websiteOrigin) {
  if (!isPaintedTheme(theme) || typeof address !== 'string') return address;
  let url;
  let origin;
  try {
    url = new URL(address);
    origin = new URL(websiteOrigin).origin;
  } catch {
    return address;
  }
  if (url.origin !== origin) return address;
  url.searchParams.set('theme', theme);
  return url.toString();
}
