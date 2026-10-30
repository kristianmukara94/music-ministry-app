// The lower-third window must never open on the primary display, where the operator console runs.
// It reads the main process source, as the other layout tests do, because the window code cannot run outside Electron.
// Run with: node --test shared/lower-third-display.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const main = readFileSync(fileURLToPath(new URL('../electron/main.js', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** The source of one top-level function, up to its closing brace at the start of a line. */
function bodyOf(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return main.slice(start, main.indexOf('\n}\n', start));
}

test('the display for the lower-third window excludes the primary display', () => {
  const body = bodyOf('lowerThirdDisplay');
  assert.match(body, /getPrimaryDisplay\(\)\.id/, 'it reads the primary display');
  assert.match(body, /d\.id === target && d\.id !== primaryId/, 'the chosen display is used only when it is not the primary one');
  assert.match(body, /\?\? null/, 'with no usable display there is no fallback display');
});

test('the lower-third window has no fallback to the primary display', () => {
  const creator = main.slice(main.indexOf('lowerThird: () => {'), main.indexOf('// Confidence monitor'));
  assert.doesNotMatch(creator, /getPrimaryDisplay/, 'the window creator does not fall back to the primary display');
  assert.match(creator, /lowerThirdDisplay\(\)/, 'it takes its display from lowerThirdDisplay');
  const place = bodyOf('placeLowerThirdWindow');
  assert.doesNotMatch(place, /getPrimaryDisplay/, 'moving the window does not fall back to the primary display');
});

test('with no usable display the window is not opened, and the output is switched off', () => {
  const reconcile = bodyOf('reconcileWindows');
  assert.match(reconcile, /key === 'lowerThird' && wanted && !win && !lowerThirdDisplay\(\)/, 'the window is skipped when there is no usable display');
  assert.match(reconcile, /output\/set', output: 'lowerThird', on: false/, 'and the output is switched off again');
});

test('plugging or unplugging a display re-checks the window, so it is not dragged onto the main screen', () => {
  assert.match(main, /'display-removed'/, 'removing a display is handled');
  assert.match(main, /'display-added'/, 'adding a display is handled');
});
