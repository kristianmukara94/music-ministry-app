// The Secondary display's controls on the Live panel: a mode switch (dual or independent), an On AIR switch, and in independent mode a push of the
// staged slide. Each fires its own action, and none of them changes the projector. Run with: node --test shared/secondary-controls.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the controls fire the mode, On AIR and push actions, and only those', () => {
  const controls = read('src/praise-worship/SecondaryControls.tsx');
  assert.match(controls, /dispatch\(\{ type: 'display\/mode', value: id \}\)/);
  assert.match(controls, /dispatch\(\{ type: 'display\/live', value: !secondary\.live \}\)/);
  assert.match(controls, /dispatch\(\{ type: 'display\/show', frame: staged \}\)/, 'the push sends the staged slide');
  assert.doesNotMatch(controls, /projector\/|output\/toggle/, 'the controls never change the projector');
});

test('the push button shows only in independent mode, and the On AIR switch is a toggle', () => {
  const controls = read('src/praise-worship/SecondaryControls.tsx');
  assert.match(controls, /\{independent && \(/);
  assert.match(controls, /aria-pressed=\{secondary\.live\}/);
  assert.match(controls, /\{secondary\.live \? 'ON AIR' : 'OFF'\}/);
});

test('the controls are on the Live panel', () => {
  assert.match(read('src/praise-worship/LiveView.tsx'), /<SecondaryControls \/>/);
});
