// A card's title slide edited in the slide editor: the live preview draws the name exactly as Save keeps it, so typing never shows more or
// other than what lands on the card. Only synthetic strings are used. Run with: node --test shared/card-name-preview.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_CARD_NAME, cardNameOf } from './pw.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('a typed name is kept on one line, trimmed and capped', () => {
  assert.equal(cardNameOf('  Sample Prayer\nLine  \n'), 'Sample Prayer Line');
  assert.equal(cardNameOf('Sample\t\tTitle'), 'Sample Title');
  assert.equal(cardNameOf(`Sample${'d'.repeat(300)}`).length, MAX_CARD_NAME);
  assert.equal(cardNameOf(''), '');
  assert.equal(cardNameOf(null), '');
});

test('the rename and the live preview share the one rule', () => {
  assert.match(read('src/praise-worship/lineupSlideCopy.ts'), /const clean = cardNameOf\(name\);/, 'Save renames with it');
  assert.match(read('src/praise-worship/LiveView.tsx'), /slide\?\.kind === 'title'\) return \{ \.\.\.shown, slide: \{ \.\.\.slide, label: cardNameOf\(text\) \|\| slide\.label \} \}/, 'the preview draws it while typing');
});

test('the Holy Mass preview follows the draft on a rosary step too', () => {
  assert.match(read('src/golive/MassLiveView.tsx'), /case 'text':\s*case 'rosary':\s*return \{ \.\.\.frame, text \};/);
});
