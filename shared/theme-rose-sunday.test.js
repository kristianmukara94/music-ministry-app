// Rose Sunday and the Theme page's "next change" line, plus the operator-shell tidy-ups that went with them. Synthetic dates only.
// Run with: node --test shared/theme-rose-sunday.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUTO_SEASON_THEME, isRoseSunday, nextThemeChange, resolveTheme, seasonOf, seasonThemeOf } from './liturgical-season.js';
import { PAINTED_THEME_IDS } from './theme-catalog.js';
import { TITLE_BAR_COLOURS } from './title-bar.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const day = (y, m, d) => new Date(y, m - 1, d);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('Gaudete and Laetare Sundays are rose; the days around them keep their season', () => {
  // 2026: Advent 1 = 29 Nov, Gaudete = 13 Dec. 2027: Easter = 28 Mar, Laetare = 7 Mar.
  for (const d of [day(2026, 12, 13), day(2027, 3, 7), day(2025, 12, 14), day(2026, 3, 15)]) {
    assert.equal(isRoseSunday(d), true, iso(d));
    assert.equal(seasonThemeOf(d), 'rose', iso(d));
    assert.equal(resolveTheme(AUTO_SEASON_THEME, d), 'rose', iso(d));
  }
  assert.equal(seasonOf(day(2026, 12, 13)), 'advent', 'the season itself is unchanged');
  assert.equal(seasonOf(day(2027, 3, 7)), 'lent');
  assert.equal(seasonThemeOf(day(2026, 12, 12)), 'advent');
  assert.equal(seasonThemeOf(day(2026, 12, 14)), 'advent');
  assert.equal(seasonThemeOf(day(2027, 3, 8)), 'lent');
  // A theme chosen by hand never turns rose.
  assert.equal(resolveTheme('obsidian', day(2026, 12, 13)), 'obsidian');
});

test('the next change is the first day Automatic paints differently', () => {
  const fromOrdinary = nextThemeChange(day(2026, 11, 21));
  assert.deepEqual([iso(fromOrdinary.date), fromOrdinary.theme], ['2026-11-29', 'advent']);
  const toRose = nextThemeChange(day(2026, 12, 1));
  assert.deepEqual([iso(toRose.date), toRose.theme], ['2026-12-13', 'rose']);
  const backToAdvent = nextThemeChange(day(2026, 12, 13));
  assert.deepEqual([iso(backToAdvent.date), backToAdvent.theme], ['2026-12-14', 'advent']);
});

test('rose is a painted theme everywhere the theme lists must agree', () => {
  assert.ok(PAINTED_THEME_IDS.includes('rose'));
  assert.ok(TITLE_BAR_COLOURS.rose);
  assert.match(read('electron/config.js'), /'pentecost', 'rose', 'season-auto'/);
  assert.match(read('src/theme/themes.ts'), /\{ id: 'rose', name: 'Rose Sunday', group: 'seasonal'/);
  assert.match(read('web/js/theme-init.js'), /\{ id: 'rose', name: 'Rose Sunday', group: 'seasonal', canvas: '#22091a' \}/);
  assert.equal(read('web/css/theme-tokens.css'), read('shared/theme-tokens.css'));
});

test('the Theme page names the theme in use and the next change, in one spelling', () => {
  const view = read('src/settings/ThemeView.tsx');
  assert.match(view, /data-testid="theme-current"/);
  assert.match(view, /nextThemeChange\(today\)/);
  assert.match(view, /\{saved \? 'Saved' : 'Changes save automatically'\}/);
  assert.doesNotMatch(view, />\s*Colors for/);
});

test('the sidebar shows the outputs on one line and its Fullscreen follows Go Live Fullscreen Mode', () => {
  const side = read('src/operator/Sidebar.tsx');
  assert.match(side, /function OutputChip\(/);
  assert.doesNotMatch(side, /<SectionLabel>\{t\('side\.outputs'\)\}<\/SectionLabel>/);
  const actions = read('src/operator/actions.ts');
  assert.match(actions, /if \(view === 'goLive' && !document\.fullscreenElement\) return enterGoLiveFullscreen\(\);/);
  // A window already fullscreen before the mode began still leaves fullscreen with the key, rather than the key only toggling the mode.
  const body = actions.slice(actions.indexOf('export function toggleFullscreen'));
  assert.ok(body.indexOf('exitGoLiveFullscreen();') < body.indexOf("view === 'goLive'"), 'the mode is left first');
  assert.match(body, /exitGoLiveFullscreen\(\);\n\s+if \(document\.fullscreenElement\) void document\.exitFullscreen\(\)/);
  assert.doesNotMatch(read('src/settings/Settings.tsx'), /APCCMMA v\{state\.version\}/);
});
