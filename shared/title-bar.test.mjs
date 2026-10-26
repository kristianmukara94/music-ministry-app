// Tests for the title-bar colours. Run with: node --test shared/title-bar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TITLE_BAR_COLOURS, titleBarOverlayFor } from './title-bar.js';

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

/** The value of a variable inside one theme's block in styles.css. */
function themeValue(theme, name) {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(block, `no [data-theme="${theme}"] block in styles.css`);
  const value = block[1].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(value, `${name} missing in ${theme}`);
  return value[1].toLowerCase();
}

const luminance = (hex) => {
  const channel = (c) => {
    const s = parseInt(c, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = Object.keys(TITLE_BAR_COLOURS);

test('every theme in the table matches its canvas and foreground in styles.css', () => {
  for (const theme of themes) {
    assert.equal(TITLE_BAR_COLOURS[theme].canvas, themeValue(theme, '--color-canvas'), `${theme} canvas`);
    assert.equal(TITLE_BAR_COLOURS[theme].fg, themeValue(theme, '--color-fg'), `${theme} foreground`);
  }
});

test('the table covers every theme in styles.css', () => {
  const blocks = [...css.matchAll(/\[data-theme="([a-z-]+)"\]\s*\{/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(blocks)].sort(), [...themes].sort());
});

test('the symbols are readable on every theme (WCAG contrast of at least 4.5 to 1)', () => {
  for (const theme of themes) {
    const { canvas, fg } = TITLE_BAR_COLOURS[theme];
    assert.ok(contrast(canvas, fg) >= 4.5, `${theme}: ${contrast(canvas, fg).toFixed(2)}`);
  }
});

test('the overlay for a theme takes its canvas as the colour and its foreground as the symbol colour', () => {
  assert.deepEqual(titleBarOverlayFor('light'), { color: '#faf6f4', symbolColor: '#2a0f17', height: 48 });
  assert.deepEqual(titleBarOverlayFor('wine'), { color: '#15070f', symbolColor: '#f6eef5', height: 48 });
});

test('an unknown theme falls back to the default overlay', () => {
  assert.deepEqual(titleBarOverlayFor('not-a-theme'), titleBarOverlayFor('default'));
  assert.deepEqual(titleBarOverlayFor(undefined), titleBarOverlayFor('default'));
});
