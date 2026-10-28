// The Praise & Worship Library has no preview box and no "Preview on projector" button on any tab. The Insert button, the item
// rows with Add, the segment label and the song drag stay. There is no React test harness in this repo, so these checks read the
// source: they confirm what is in the panel and what is gone. Run with: node --test shared/library-panel.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const library = read('src/praise-worship/Library.tsx');
const i18n = read('shared/pw-i18n.js');

test('no preview box, caption, or projector button is left in the Library', () => {
  for (const gone of ['PreviewPane', 'previewOnProjector', 'previewLocal', 'previewEmpty', 'previewPane', 'MonitorUp', 'PwSlideFace', 'slideFooter', 'canProject', 'onProject', 'project(', 'Shift', 'slidesFor', 'resolvedFor', 'candidate', 'prepare']) {
    assert.ok(!library.includes(gone), `${gone} is removed from Library.tsx`);
  }
});

test('the Insert into segment button, the Add rows and the segment label stay', () => {
  assert.ok(library.includes("{t('insertInto')}"), 'Insert into segment button');
  assert.ok(library.includes('disabled={!canInsert(active)}'), 'Insert is enabled as before, for the active row');
  assert.ok(library.includes('onClick={row.insert}'), 'each row still has Add');
  assert.ok(library.includes("t('addsTo'"), 'the Adds to segment label');
});

test('drag-and-drop from the Songs list is still wired', () => {
  assert.ok(library.includes('draggable={row.songId != null}'));
  assert.ok(library.includes("setPwState({ songDrag: row.songId })"));
  assert.ok(library.includes("setPwState({ songDrag: null })"));
});

test('the preview strings are gone from both languages, and the Insert string stays', () => {
  for (const key of ['previewPane', 'previewLocal', 'previewEmpty', 'previewOnProjector', 'previewNeedsLive', 'splitNotUsed']) {
    assert.ok(!new RegExp(`^\s+${key}:`, 'm').test(i18n), `${key} removed`);
  }
  assert.equal((i18n.match(/insertInto:/g) || []).length, 2, 'Insert string kept in both languages');
});
