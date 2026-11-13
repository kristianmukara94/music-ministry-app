// Tests for the theme contrast engine and for every theme in src/styles.css. Run with: node --test shared/theme-contrast.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRAST_TARGETS,
  TOKEN_VARS,
  composite,
  getContrastRatio,
  getRelativeLuminance,
  minContrast,
  parseColor,
  pickOnColor,
  resolveReadableThemeTokens,
} from './theme-contrast.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(root, 'src/styles.css'), 'utf8');

const keyOf = Object.fromEntries(Object.entries(TOKEN_VARS).map(([k, v]) => [v, k]));
const declarations = (body) =>
  Object.fromEntries([...body.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)].map((m) => [keyOf[m[1]], m[2].trim()]).filter(([k]) => k));

/** Each theme's palette as the browser sees it: the @theme defaults with the [data-theme] block on top. */
const defaults = declarations(css.match(/@theme \{([\s\S]*?)\n\}/)[1]);
const THEMES = [...css.matchAll(/\[data-theme="([\w-]+)"\] \{([\s\S]*?)\n\}/g)].map((m) => ({
  id: m[1],
  palette: { ...defaults, ...declarations(m[2]) },
}));

test('WCAG luminance and contrast match the reference values', () => {
  assert.equal(getRelativeLuminance('#000000'), 0);
  assert.equal(getRelativeLuminance('#ffffff'), 1);
  assert.equal(getContrastRatio('#000', '#fff'), 21);
  assert.equal(getContrastRatio('#fff', '#000'), 21);
  // #777 on white is the textbook "just fails AA" grey.
  assert.ok(Math.abs(getContrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
  // Translucent text is judged as painted: white at 50% over black is #808080.
  assert.ok(Math.abs(getContrastRatio('rgb(255 255 255 / 0.5)', '#000') - getContrastRatio('#808080', '#000')) < 0.05);
});

test('colours parse in every syntax styles.css uses', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('rgb(47 14 22 / 0.72)'), { r: 47, g: 14, b: 22, a: 0.72 });
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.equal(parseColor('var(--x)'), null);
});

test('on-accent picks whichever of near-black and white reads better', () => {
  assert.equal(pickOnColor('#f5b92e'), '#0f1115'); // amber button
  assert.equal(pickOnColor('#5a1426'), '#ffffff'); // maroon button
});

test('the styles.css theme list is complete', () => {
  // 15 colour themes + 7 seasons. A new theme block is picked up by every test below automatically.
  assert.equal(THEMES.length, 22);
});

for (const { id, palette } of THEMES) {
  test(`${id}: every text role is readable on every surface`, () => {
    const { tokens } = resolveReadableThemeTokens(palette);
    const grounds = [tokens.canvas, tokens.surface, tokens.surface2];
    const check = (key, target) => {
      const got = minContrast(tokens[key], grounds);
      assert.ok(got >= target, `${id} --${key} ${tokens[key]} reaches ${got.toFixed(2)}:1, needs ${target}:1`);
    };
    check('fg', 7);
    check('muted', 5);
    check('faint', 4.5);
    for (const tint of ['accent', 'gold', 'danger', 'ok', 'warn', 'info']) check(tint, CONTRAST_TARGETS.tint);
    const onAccent = getContrastRatio(tokens.onAccent, tokens.accent);
    assert.ok(onAccent >= 4.5, `${id} on-accent reaches ${onAccent.toFixed(2)}:1`);
    const edge = getContrastRatio(composite(tokens.lineStrong, tokens.surface), tokens.surface);
    assert.ok(edge >= 3, `${id} --line-strong reaches ${edge.toFixed(2)}:1 on the surface`);
  });

  test(`${id}: styles.css already holds the calibrated values and opaque surfaces`, () => {
    const { tokens, changed } = resolveReadableThemeTokens(palette);
    assert.deepEqual(changed, [], `${id}: the engine would still change ${changed.join(', ')}; update styles.css`);
    assert.equal(palette.surface, tokens.surface, `${id} --color-surface must be --color-panel painted over --color-canvas`);
    assert.equal(palette.surface2, tokens.surface2, `${id} --color-surface-2 must be --color-panel-2 painted over --color-surface`);
    assert.equal(parseColor(palette.surface).a, 1);
  });
}

test('the first-paint color-scheme in styles.css agrees with the engine for every theme', () => {
  // Native <select> menus follow color-scheme; before themes.ts runs, the CSS list decides it.
  const list = css.match(/:root:is\(([^)]*\))\s*\{\s*color-scheme: light;/);
  assert.ok(list, 'no light color-scheme rule in styles.css');
  const light = new Set([...list[1].matchAll(/data-theme="([\w-]+)"/g)].map((m) => m[1]));
  for (const { id, palette } of THEMES) {
    const { scheme } = resolveReadableThemeTokens(palette);
    assert.equal(light.has(id) ? 'light' : 'dark', scheme, `${id} is ${scheme} by luminance`);
  }
});

test('a deliberately unreadable palette comes out readable', () => {
  const { tokens, scheme, changed } = resolveReadableThemeTokens({
    canvas: '#3a0d18',
    panel: 'rgb(90 25 40 / 0.6)',
    panel2: 'rgb(120 35 55 / 0.6)',
    line: 'rgb(255 255 255 / 0.02)',
    lineStrong: '#4a1520',
    fg: '#7a4b55',
    muted: '#5a2b35',
    faint: '#4a1b25',
    accent: '#6b3a10',
    onAccent: '#6b3a10',
    gold: '#6b3a10',
    danger: '#7a2020',
    ok: '#1f4a2a',
    warn: '#5a3a08',
    info: '#1a2a5a',
  });
  assert.equal(scheme, 'dark');
  const grounds = [tokens.canvas, tokens.surface, tokens.surface2];
  assert.ok(minContrast(tokens.fg, grounds) >= 7);
  assert.ok(minContrast(tokens.muted, grounds) >= 5);
  assert.ok(minContrast(tokens.faint, grounds) >= 4.5);
  assert.ok(getContrastRatio(tokens.onAccent, tokens.accent) >= 4.5);
  assert.ok(changed.includes('fg') && changed.includes('lineStrong'));
  // Backgrounds are never moved.
  assert.equal(tokens.canvas, '#3a0d18');
  // Running it again on its own output changes nothing.
  assert.deepEqual(resolveReadableThemeTokens(tokens).changed, []);
});

test('a light palette with washed-out text is darkened, not lightened', () => {
  const { tokens, scheme } = resolveReadableThemeTokens({ canvas: '#ffffff', panel: '#f4f4f4', panel2: '#ececec', fg: '#999999', muted: '#bbbbbb', faint: '#dddddd' });
  assert.equal(scheme, 'light');
  assert.ok(getRelativeLuminance(tokens.fg) < getRelativeLuminance('#999999'));
  assert.ok(minContrast(tokens.faint, ['#ffffff', '#f4f4f4', '#ececec']) >= 4.5);
});

/** Every .ts/.tsx file under src. */
function sources(dir = join(root, 'src')) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no text is drawn as the foreground faded below 70%', () => {
  // text-fg/60 on a light theme is 4:1 and text-fg/50 is 3:1. Hints take text-faint and secondary text takes text-muted,
  // which the engine keeps readable. A disabled control may still fade.
  const offenders = [];
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?<![\w:/-])(?:[\w-]+:)*text-fg\/([0-9]+)\b/g)) {
      if (/(^|:)disabled:/.test(m[0])) continue;
      if (Number(m[1]) < 70) offenders.push(`${file.slice(root.length)}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('modals and menus paint on an opaque surface, never on the translucent panel', () => {
  const offenders = [];
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<\w+[^>]*?role="(?:dialog|alertdialog|menu|listbox)"[^>]*?>/gs)) {
      if (/\bbg-panel(-2)?\b(?!\/)/.test(m[0])) offenders.push(`${file.slice(root.length)}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
