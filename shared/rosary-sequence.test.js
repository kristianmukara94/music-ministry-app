// Rosary sequence with optional prayers, presentation options, and the editor's slide-fit gauge.
// Run: node --test shared/rosary-sequence.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beadPosition,
  closingPrayers,
  positionOfClosing,
  positionOfDecade,
  rosarySequence,
  stepAt,
  stepsPerDecade,
  STEPS_PER_DECADE,
  TOTAL_POSITIONS,
  totalPositions,
} from './rosary-logic.js';
import { PRESENTATION_DEFAULTS, sanitizePresentation, slideFit, wrappedLineCount } from './rosary-presentation.js';

test('the default sequence is unchanged: Fatima in each decade, then Hail Holy Queen and the Litany', () => {
  assert.equal(STEPS_PER_DECADE, 14);
  assert.equal(TOTAL_POSITIONS, 6 + 5 * 14 + 2);
  assert.deepEqual(closingPrayers(), ['hail_holy_queen', 'litany_loreto']);
  assert.equal(stepAt(6 + 13).kind, 'fatima');
  assert.equal(stepAt(TOTAL_POSITIONS - 1).kind, 'litany_loreto');
});

test('turning the Fatima prayer off shortens every decade and moves the later decades up', () => {
  const o = { fatima: false };
  assert.equal(stepsPerDecade(o), 13);
  assert.equal(totalPositions(o), 6 + 5 * 13 + 2);
  assert.equal(rosarySequence(o).filter((s) => s.kind === 'fatima').length, 0);
  assert.equal(positionOfDecade(2, o), 6 + 13);
  assert.deepEqual(stepAt(positionOfDecade(2, o), o), { section: 'decade', decade: 2, kind: 'announce', bead: null });
  // The bead positions follow: the fourth Hail Mary of the second decade.
  const step = stepAt(positionOfDecade(2, o), o);
  assert.deepEqual(stepAt(beadPosition(step, 4, o), o), { section: 'decade', decade: 2, kind: 'hail_mary', bead: 4 });
});

test('St. Michael is added after the Litany, and the Litany can be left out', () => {
  assert.deepEqual(closingPrayers({ stMichael: true }), ['hail_holy_queen', 'litany_loreto', 'st_michael']);
  assert.deepEqual(closingPrayers({ litany: false, stMichael: true }), ['hail_holy_queen', 'st_michael']);
  const all = { stMichael: true };
  assert.equal(stepAt(totalPositions(all) - 1, all).kind, 'st_michael');
  assert.equal(positionOfClosing('litany_loreto', { litany: false }), -1);
  assert.equal(positionOfClosing('st_michael', all), totalPositions(all) - 1);
});

test('a position past the end lands on the last step of the chosen sequence', () => {
  const o = { litany: false };
  assert.equal(stepAt(999, o).kind, 'hail_holy_queen');
});

test('presentation options keep the defaults for anything missing or of the wrong type', () => {
  assert.deepEqual(sanitizePresentation(null), PRESENTATION_DEFAULTS);
  assert.deepEqual(sanitizePresentation({ beadTracker: 'yes', fatima: false, backgroundId: 7, extra: 1 }), {
    ...PRESENTATION_DEFAULTS,
    fatima: false,
    backgroundId: 7,
  });
  assert.equal(sanitizePresentation({ backgroundId: -1 }).backgroundId, null);
  assert.equal(sanitizePresentation({ backgroundId: 2.5 }).backgroundId, null);
});

test('the fit gauge wraps word by word and flags text past four lines', () => {
  assert.equal(wrappedLineCount('', 10), 0);
  assert.equal(wrappedLineCount('aaaa bbbb', 9), 1);
  assert.equal(wrappedLineCount('aaaa bbbbb', 9), 2);
  assert.equal(wrappedLineCount('one\ntwo', 40), 2);
  // A word longer than the line takes as many lines as it needs.
  assert.equal(wrappedLineCount('ab cdefghijkl', 5), 3);
  assert.equal(wrappedLineCount('ab cdefghijklm', 5), 4);

  const short = slideFit('The angel Gabriel greets Mary, and she says yes to God’s plan.');
  assert.equal(short.fits, true);
  assert.equal(short.capacity, 45 * 4);
  const long = slideFit('word '.repeat(60));
  assert.equal(long.fits, false);
  assert.ok(long.lines > 4);
});
