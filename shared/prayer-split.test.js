// A prayer's saved split: the fingerprint of the text it was made for, the stamp that adds it, the normalising of a stored split, the manual
// parts it makes, and how the shared splitter uses a saved split (a current one is used exactly; an out-of-date one falls back and says so).
// Run with: node --test shared/prayer-split.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualParts, normalizeSplit, splitFingerprint, stampSplit } from './prayer-split.js';
import { prayerSlidesFor } from './prayer-slides.js';

const BODY = [
  'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house,',
  'through the intercession of Saint Michael the Archangel, who stands before your throne, and of Our Lady, Queen of the Angels and the Saints,',
  'we pray that your Word be proclaimed without fear in this parish, and that every heart here be made ready to receive your mercy tonight.',
  'Amen.',
  '',
  'Holy Spirit, fill this place with your presence and your peace, and let every worship song lift the name of Jesus above all things.',
].join('\n');
const words = (text) => String(text).split(/\s+/).filter(Boolean);

test('a fingerprint is the same for the same text and changes when the text changes', () => {
  assert.equal(splitFingerprint(BODY), splitFingerprint(String(BODY)));
  assert.notEqual(splitFingerprint(BODY), splitFingerprint(`${BODY} `));
});

test('a new split is stamped with the fingerprint of its text; an existing fingerprint is kept', () => {
  const fresh = stampSplit({ mode: 'manual', at: [2] }, BODY);
  assert.deepEqual(fresh, { mode: 'manual', at: [2], of: splitFingerprint(BODY) });
  const kept = stampSplit({ mode: 'manual', at: [2], of: 'abcd1234' }, BODY);
  assert.equal(kept.of, 'abcd1234', 'an old fingerprint stays, so the split stays out of date');
  assert.equal(stampSplit(null, BODY), null);
});

test('normalizing a split keeps its fingerprint and drops breaks out of range', () => {
  assert.deepEqual(normalizeSplit({ mode: 'manual', at: [1, 99], of: 'abc' }, BODY), { mode: 'manual', at: [1], of: 'abc' });
  assert.equal(normalizeSplit({ mode: 'bogus' }, BODY), null);
});

test('manual parts keep the text between breaks exactly', () => {
  assert.deepEqual(manualParts('One\n\nTwo\n\n\nThree', [0, 2]), ['One', 'Two', 'Three']);
});

test('a current saved split is used exactly as placed, with one size for every part', () => {
  const body = 'Lord, hear us.\nGrant us your peace.\n\nAmen.';
  const split = stampSplit({ mode: 'manual', at: [1] }, body);
  const result = prayerSlidesFor(body, split);
  assert.equal(result.mode, 'manual');
  assert.deepEqual(result.pages.map((p) => p.text), ['Lord, hear us.\nGrant us your peace.', 'Amen.']);
  assert.equal(new Set(result.pages.map((p) => p.fontPx)).size, 1, 'one size for every part');
});

test('a saved split made for text that has since changed falls back to the automatic split, and says so', () => {
  const split = { mode: 'manual', at: [2, 3], of: splitFingerprint('the text before it was changed') };
  const result = prayerSlidesFor(BODY, split);
  assert.equal(result.mode, 'stale');
  assert.deepEqual(result.pages.map((p) => p.text), prayerSlidesFor(BODY, null).pages.map((p) => p.text));
});

test('a split with no fingerprint cannot be checked, so it is out of date', () => {
  assert.equal(prayerSlidesFor(BODY, { mode: 'manual', at: [2] }).mode, 'stale');
});

test('a saved automatic split gives the automatic split', () => {
  const result = prayerSlidesFor(BODY, { mode: 'auto', of: splitFingerprint(BODY) });
  assert.equal(result.mode, 'auto');
  assert.deepEqual(result.pages.map((p) => p.text), prayerSlidesFor(BODY, null).pages.map((p) => p.text));
});

test('no saved split gives the automatic split, and every word is kept in order', () => {
  const result = prayerSlidesFor(BODY, null);
  assert.equal(result.mode, 'auto');
  assert.deepEqual(words(result.pages.map((p) => p.text).join(' ')), words(BODY));
});
