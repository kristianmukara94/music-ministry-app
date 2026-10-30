// The Praise & Worship slide face is drawn into preview boxes that get their height from their aspect ratio. A container-height unit (cqh) can
// resolve to zero there, which stacked the title card's icon, title, rule and song list on top of each other. Every offset is in container widths.
// Run with: node --test shared/pw-slide-face.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const face = readFileSync(fileURLToPath(new URL('../src/praise-worship/PwSlideFace.tsx', import.meta.url)), 'utf8');
// Comments may mention the unit; only the code is checked.
const code = face.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('the slide face uses no container-height units, so a preview box cannot collapse its spacing', () => {
  assert.doesNotMatch(code, /cqh/, 'no cqh in the slide face');
});

test('the title card keeps its icon, rule and subtitle spacing in container widths', () => {
  assert.match(code, /mb-\[1\.406cqw\]/, 'the gap under the icon');
  assert.match(code, /max-h-\[36\.563cqw\]/, 'the title height limit, as 65% of a 16:9 frame');
  assert.match(code, /h-\[0\.197cqw\]/, 'the rule keeps a visible thickness');
});
