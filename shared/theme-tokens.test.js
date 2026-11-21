// The shared theme token sheet: one file of [data-theme] blocks used by the desktop app (src/styles.css imports it) and the website
// (web/css/theme-tokens.css is a byte-for-byte copy). Also checks that every list of theme ids agrees, and that the website's old blue
// palette is gone. Run with: node --test shared/theme-tokens.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { THEME_CATALOG, PAINTED_THEME_IDS, DEFAULT_THEME, isPaintedTheme } from './theme-catalog.js';
import { resolveReadableThemeTokens, TOKEN_VARS, getContrastRatio } from './theme-contrast.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');
const shared = read('shared/theme-tokens.css');
const webCopy = read('web/css/theme-tokens.css');
const styles = read('src/styles.css');

const blocks = [...shared.matchAll(/\[data-theme="([\w-]+)"\] \{([\s\S]*?)\n\}/g)].map((m) => ({ id: m[1], body: m[2] }));
const valueIn = (body, name) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();

test('web/css/theme-tokens.css is a byte-for-byte copy of shared/theme-tokens.css', () => {
  assert.equal(webCopy, shared, 'copy shared/theme-tokens.css over web/css/theme-tokens.css');
});

test('the desktop imports the shared sheet, and no theme block is left behind in styles.css', () => {
  assert.match(styles, /@import "\.\.\/shared\/theme-tokens\.css";/);
  assert.equal(/^\[data-theme="[\w-]+"\] \{/m.test(styles), false);
});

test('the sheet defines every desktop theme, each with the full set of colour tokens', () => {
  assert.deepEqual(blocks.map((b) => b.id).sort(), [...PAINTED_THEME_IDS].sort());
  const required = Object.values(TOKEN_VARS).filter((name) => name !== '--color-warn' && name !== '--color-info');
  for (const { id, body } of blocks) {
    for (const name of required) assert.ok(valueIn(body, name), `${id} sets ${name}`);
  }
  // warn and info fall back to the shared :root for the dark themes.
  const base = shared.match(/^:root \{([\s\S]*?)\n\}/m)[1];
  for (const name of ['--color-warn', '--color-info', '--color-amber', '--color-royal', '--color-crimson']) assert.ok(valueIn(base, name), name);
});

test('the shared base values agree with the Tailwind @theme in styles.css, which repeats them for its utilities', () => {
  const base = shared.match(/^:root \{([\s\S]*?)\n\}/m)[1];
  const theme = styles.match(/@theme \{([\s\S]*?)\n\}/)[1];
  for (const name of ['--color-warn', '--color-info', '--color-amber', '--color-royal', '--color-crimson']) {
    assert.equal(valueIn(base, name), valueIn(theme, name), name);
  }
});

test('every list of themes agrees: the catalogue, the desktop picker, config.json and the website', () => {
  const themesTs = read('src/theme/themes.ts');
  const picker = [...themesTs.matchAll(/\{ id: '([\w-]+)', name: '([^']+)', group: '(\w+)'/g)].map((m) => ({ id: m[1], name: m[2], group: m[3] }));
  assert.deepEqual(picker, THEME_CATALOG.map(({ id, name, group }) => ({ id, name, group })));

  const config = read('electron/config.js').match(/export const THEME_IDS = \[([^\]]+)\]/)[1];
  assert.deepEqual([...config.matchAll(/'([\w-]+)'/g)].map((m) => m[1]).filter((id) => id !== 'season-auto').sort(), [...PAINTED_THEME_IDS].sort());

  const context = { window: { location: { search: '' }, addEventListener() {}, setTimeout() {}, clearTimeout() {} }, document: { documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } }, head: { appendChild() {} }, querySelector: () => null, createElement: () => ({}), dispatchEvent() {} }, CustomEvent: class {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  vm.createContext(context);
  vm.runInContext(read('web/js/theme-init.js'), context);
  const web = context.window.apccmmaTheme;
  assert.deepEqual(JSON.parse(JSON.stringify(web.themes.map(({ id, name, group }) => ({ id, name, group })))), THEME_CATALOG.map(({ id, name, group }) => ({ id, name, group })));
  assert.equal(web.defaultTheme, DEFAULT_THEME);
  for (const t of web.themes) assert.equal(t.canvas, valueIn(blocks.find((b) => b.id === t.id).body, '--color-canvas'), `${t.id} canvas`);
});

test('season-auto is a choice, never a painted theme', () => {
  assert.equal(isPaintedTheme('season-auto'), false);
  assert.equal(isPaintedTheme(DEFAULT_THEME), true);
});

test('the website calendar puts --color-on-accent on --color-accent, which every theme keeps readable', () => {
  for (const { id, body } of blocks) {
    const ratio = getContrastRatio(valueIn(body, '--color-on-accent'), valueIn(body, '--color-accent'));
    assert.ok(ratio >= 4.5, `${id}: ${ratio.toFixed(2)}:1`);
    assert.doesNotThrow(() => resolveReadableThemeTokens({ canvas: valueIn(body, '--color-canvas') }));
  }
});

test('the legacy blue palette is gone from every web stylesheet', () => {
  // The sapphire/blue literals the website used before it shared the laptop themes.
  const LEGACY = /#2563eb|#1d4ed8|#3b82f6|#1e3a8a|#93c5fd|#dbeafe|#1e40af|#080c14|#111726|#172033|#1c263b|#0b101b|#50638a|rgba\(\s*(37,\s*99,\s*235|59,\s*130,\s*246)/i;
  const dir = join(root, 'web/css');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'theme-tokens.css')) {
    const text = readFileSync(join(dir, file), 'utf8');
    const hit = text.match(LEGACY);
    assert.equal(hit, null, `${file} still has ${hit?.[0]}`);
  }
  for (const file of ['web/js/theme-init.js', 'web/js/shell.js', 'web/login.html']) {
    assert.equal(read(file).match(LEGACY), null, file);
  }
});

test('outside the paper print styles, web stylesheets use theme tokens rather than fixed colours', () => {
  for (const file of ['web/css/planner.css', 'web/css/login.css']) {
    const text = read(file).replace(/@media print \{[\s\S]*?\n\}/g, '');
    // Exempt, like the brand tile: the web Planner calendar's liturgical colours (--lit-*), the vestment colours, fixed on every theme as
    // the laptop's calendar keeps them.
    const fixed = [...text.matchAll(/^(?!\s*--brand-tile|\s*--lit-)[^\n]*(#[0-9a-f]{3,8}\b|rgba?\([\d\s,.]+\))[^\n]*$/gim)]
      .map((m) => m[0].trim())
      .filter((line) => !/^--shadow-strong|^--card-shadow|^\/\*|^\*/.test(line));
    assert.deepEqual(fixed, [], `${file} has fixed colours`);
  }
});
