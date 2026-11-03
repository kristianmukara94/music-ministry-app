// Tests the rules for PowerPoint import progress: the percentage, the wording, and the state the button and bar follow.
// Run with: node --test shared/import-progress.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_IMPORT, IMPORT_PROGRESS_CHANNEL, STAGES, failureMessage, importLabel, importReducer, progressFor, successMessage } from './import-progress.js';

test('the channel is the one the window listens on', () => {
  assert.equal(IMPORT_PROGRESS_CHANNEL, 'powerpoint:import-progress');
});

test('the stages follow one another and fill the bar with no gap', () => {
  const ranges = Object.values(STAGES);
  assert.equal(ranges[0][0], 0);
  assert.equal(ranges.at(-1)[1], 1);
  ranges.slice(1).forEach(([from], i) => assert.equal(from, ranges[i][1]));
});

test('a report carries the slide, the total, the percentage and the words', () => {
  const p = progressFor({ stage: 'rendering', done: 4, total: 12, totalSlides: 12 });
  assert.equal(p.currentSlide, 4);
  assert.equal(p.totalSlides, 12);
  assert.equal(p.statusText, 'Drawing slide 4 of 12…');
  // 5% + 45% of 4/12 = 20%
  assert.equal(p.percentage, 20);
});

test('the percentage is whole, never below 0 or above 100, and reaches 100 only at the end', () => {
  assert.equal(progressFor({ stage: 'reading' }).percentage, 0);
  assert.equal(progressFor({ stage: 'rendering', done: 99, total: 3 }).percentage, 50);
  assert.equal(progressFor({ stage: 'finishing', done: 1, total: 1 }).percentage, 100);
  assert.equal(progressFor({ stage: 'finishing', done: 0, total: 1 }).percentage, 98);
  for (const stage of Object.keys(STAGES)) {
    const { percentage } = progressFor({ stage, done: 5, total: 10 });
    assert.ok(Number.isInteger(percentage) && percentage >= 0 && percentage <= 100);
  }
});

test('the percentage rises through the stages of one file', () => {
  const steps = [
    progressFor({ stage: 'reading' }),
    progressFor({ stage: 'rendering', done: 0, total: 8 }),
    progressFor({ stage: 'rendering', done: 8, total: 8 }),
    progressFor({ stage: 'saving', done: 8, total: 8 }),
    progressFor({ stage: 'layers' }),
    progressFor({ stage: 'layerImages', done: 8, total: 8 }),
    progressFor({ stage: 'finishing', done: 1, total: 1 }),
  ].map((p) => p.percentage);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1], steps.join(','));
  assert.equal(steps.at(-1), 100);
});

test('several files share the bar: the second of three starts at a third', () => {
  assert.equal(progressFor({ stage: 'reading', fileIndex: 1, fileCount: 3 }).percentage, 33);
  assert.equal(progressFor({ stage: 'finishing', done: 1, total: 1, fileIndex: 1, fileCount: 3 }).percentage, 67);
  assert.equal(progressFor({ stage: 'finishing', done: 1, total: 1, fileIndex: 2, fileCount: 3 }).percentage, 100);
});

test('a stage that cannot count slides says what it is doing', () => {
  const p = progressFor({ stage: 'layers', totalSlides: 12 });
  assert.equal(p.currentSlide, 0);
  assert.equal(importLabel(p), 'Reading the words of each slide…');
});

test('the label counts slides when it can', () => {
  assert.equal(importLabel(progressFor({ stage: 'saving', done: 4, total: 12 })), 'Importing 4 / 12 slides…');
  assert.equal(importLabel(progressFor({ stage: 'saving', done: 4, total: 12, fileIndex: 1, fileCount: 2 })), 'Importing 4 / 12 slides… (file 2 of 2)');
  assert.equal(importLabel(null), 'Importing…');
});

test('the bar starts empty, moves forward, and ignores a report that would move it back', () => {
  let s = importReducer(IDLE_IMPORT, { type: 'start' });
  assert.deepEqual(s, { busy: true, progress: null });
  s = importReducer(s, { type: 'progress', progress: progressFor({ stage: 'rendering', done: 6, total: 12 }) });
  const at = s.progress.percentage;
  s = importReducer(s, { type: 'progress', progress: progressFor({ stage: 'rendering', done: 2, total: 12 }) });
  assert.equal(s.progress.percentage, at);
});

test('a report that arrives when no import is running is ignored', () => {
  const s = importReducer(IDLE_IMPORT, { type: 'progress', progress: progressFor({ stage: 'saving', done: 1, total: 2 }) });
  assert.equal(s, IDLE_IMPORT);
});

test('finishing or failing resets the bar and frees the button', () => {
  const running = importReducer(importReducer(IDLE_IMPORT, { type: 'start' }), { type: 'progress', progress: progressFor({ stage: 'saving', done: 1, total: 2 }) });
  assert.equal(running.busy, true);
  assert.deepEqual(importReducer(running, { type: 'finish' }), { busy: false, progress: null });
  assert.deepEqual(importReducer(running, { type: 'fail' }), { busy: false, progress: null });
  // And a new import starts from an empty bar, not the last one's.
  assert.equal(importReducer(IDLE_IMPORT, { type: 'start' }).progress, null);
});

test('the success message counts the slides, explains a deck with none, and says nothing when cancelled', () => {
  assert.equal(successMessage(12, 'Sermons'), 'Added 12 slides to "Sermons".');
  assert.equal(successMessage(1, 'Unfiled'), 'Added 1 slide to "Unfiled".');
  assert.match(successMessage(0, 'Unfiled'), /no visible slides/);
  assert.equal(successMessage(null, 'Unfiled'), null);
});

test('the failure message says what went wrong and what to try', () => {
  const m = failureMessage('Slide 3 could not be drawn.');
  assert.match(m, /Slide 3 could not be drawn\./);
  assert.match(m, /No slides were added/);
  assert.match(m, /try Import PowerPoint again/);
  assert.match(failureMessage(''), /did not finish/);
  assert.match(failureMessage(undefined), /did not finish/);
});
