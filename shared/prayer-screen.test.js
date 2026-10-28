// Full-screen prayers: every slide fits the screen at its size, automatic and manual splits make the slides the operator placed,
// clearing a split gives back one prayer that is scaled to fit, and no words are lost or repeated.
// Run with: node --test shared/prayer-screen.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prayerSlidesFor } from './prayer-slides.js';
import { DEFAULT_BODY_PX, FLOOR_PX, fitsScreen, manualParts, normalizeSplit, placeBreak, screenPagesOf } from './prayer-screen.js';

// A synthetic prayer of long lines, in two paragraphs. It is not the church's wording.
const BODY = [
  'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house,',
  'through the intercession of Saint Michael the Archangel, who stands before your throne, and of Our Lady, Queen of the Angels and the Saints,',
  'we pray that your Word be proclaimed without fear in this parish, and that every heart here be made ready to receive your mercy tonight.',
  'Amen.',
  '',
  'Holy Spirit, fill this place with your presence and your peace, and let every worship song lift the name of Jesus above all things.',
].join('\n');
const TITLE = 'Prayer to Take Authority';
const EXTRA_LARGE = 80;

const words = (text) => String(text).split(/\s+/).filter(Boolean);
const note = (over = {}) => ({ title: TITLE, body: BODY, style: null, split: null, ...over });

test('the default and extra large sizes are the projector sizes: 69 and 80 pixels', () => {
  assert.equal(DEFAULT_BODY_PX, 69);
  assert.equal(EXTRA_LARGE, 80);
});



test('no words are lost or repeated by an automatic split, at Default and Extra Large', () => {
  for (const style of [null, { fontSize: EXTRA_LARGE }]) {
    const pages = screenPagesOf(note({ style, split: { mode: 'auto' } }));
    assert.deepEqual(words(pages.map((p) => p.text).join(' ')), words(BODY));
  }
});




test('no words are lost or repeated by a manual split', () => {
  const pages = screenPagesOf(note({ split: { mode: 'manual', at: [0, 2, 5] } }));
  assert.deepEqual(words(pages.map((p) => p.text).join(' ')), words(BODY));
});


test('placing a break adds it, and placing it again removes it; removing the last one gives the automatic split', () => {
  const added = placeBreak(BODY, null, 2);
  assert.deepEqual(added, { split: { mode: 'manual', at: [2] } });
  assert.deepEqual(placeBreak(BODY, added.split, 2), { split: null });
});

test('a break can be placed on an automatic split: the automatic split is kept for every section the break does not touch', () => {
  assert.deepEqual(placeBreak(BODY, { mode: 'auto' }, 2), { split: { mode: 'manual', at: [2] } });
});

test('a break that leaves a part too long for one slide is not refused: that part is split automatically', () => {
  const long = ['A short first line.', ...Array.from({ length: 200 }, (_, i) => `Line ${i} with some more words to make it long enough.`)].join('\n');
  const { split } = placeBreak(long, null, 0);
  assert.deepEqual(split, { mode: 'manual', at: [0] });
  const pages = screenPagesOf({ title: TITLE, body: long, style: null, split });
  assert.ok(pages.length > 2, 'the long part is split');
  assert.deepEqual(words(pages.map((p) => p.text).join(' ')), words(long));
});

test('a stored split is cleaned against the text: out-of-range and repeated breaks are dropped', () => {
  assert.deepEqual(normalizeSplit({ mode: 'manual', at: [3, 1, 1, 99, -2, 1.5, 'x'] }, BODY), { mode: 'manual', at: [1, 3] });
  assert.equal(normalizeSplit({ mode: 'bogus' }, BODY), null);
  assert.equal(normalizeSplit(null, BODY), null);
  assert.deepEqual(normalizeSplit({ mode: 'auto' }, BODY), { mode: 'auto' });
});

test('manual parts drop blank edge lines and keep the text between them exactly', () => {
  const body = 'One\n\nTwo\n\n\nThree';
  assert.deepEqual(manualParts(body, [0, 2]), ['One', 'Two', 'Three']);
  assert.deepEqual(manualParts(body, [1]), ['One', 'Two\n\n\nThree']);
});

test('the full-screen view shows the shared split: the same slides and the same size as the lineup and the projector', () => {
  const body = 'Lord God, we ask you to take authority over every power that would turn our hearts away from you. Holy Spirit, fill this place with your presence and your peace; let every worship song lift the name of Jesus above all things. Amen.';
  const note = { title: 'Prayer to Take Authority', body, style: null, split: null };
  assert.deepEqual(screenPagesOf(note).map((p) => p.text), prayerSlidesFor(body, null).pages.map((p) => p.text), 'the full-screen view uses the same split as the lineup');
});

test('the full-screen view draws every slide at one size', () => {
  const body = Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} of the prayer, which runs on for a while.`).join(' ');
  const pages = screenPagesOf({ title: 'Prayer', body, style: null, split: null });
  assert.ok(pages.length > 1);
  assert.equal(new Set(pages.map((p) => p.fontPx)).size, 1);
});
