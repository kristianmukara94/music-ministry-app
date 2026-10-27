// Tests for the web plan editor's rules (web/js/plan-model.js): the picker, the segment choices, the save payload, Save and Discard,
// and the status line. Run with: node --test netlify/functions/test/web-plan-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = await import(pathToFileURL(path.join(here, '..', '..', '..', 'web', 'js', 'plan-model.js')).href);
const sample = await import(pathToFileURL(path.join(here, '..', '..', '..', 'web', 'js', 'sample-data.js')).href);

const SONG_A = '20000000-0000-4000-8000-00000000000a';
const SONG_B = '20000000-0000-4000-8000-00000000000b';
const SONG_C = '20000000-0000-4000-8000-00000000000c';
// Songs in the shape the server returns them.
const SERVER_SONGS = [
  { id: SONG_A, title: 'Praise to the Lord, the Almighty', category: 'Entrance', language: 'English', key: 'D' },
  { id: SONG_B, title: 'Be Thou My Vision', category: 'Entrance', language: 'English', key: 'Eb' },
  { id: SONG_C, title: 'Psalm 24 setting', category: 'Responsorial Psalm', language: 'English', key: 'F' },
];

test('the Mass steps come from the template structure, and their sample values are never used', () => {
  const steps = model.massSteps(sample.MASS_PLAN);
  assert.equal(steps.length, 31);
  assert.equal(steps[0].n, 1);
  assert.equal(steps[0].category, 'Entrance');
  assert.equal('value' in steps[0], false, 'the sample value of step 1 is not carried into the steps');
  assert.equal(steps.find((s) => s.n === 2).kind, 'rite');
});

test('the Praise segments come from the template, with their default minutes and no sample values', () => {
  const segments = model.praiseSegments(sample.PRAISE_PLAN);
  assert.equal(segments.length, 12);
  assert.equal(segments[1].defaultMinutes, 5);
  assert.equal('value' in segments[1], false);
  assert.equal(segments.find((s) => s.id === '4').optional, false);
  assert.equal(segments.find((s) => s.id === '10').optional, true, 'an Optional hint marks the segment optional');
});

test('the Change picker lists the church songs from the server, filtered by category and search', () => {
  assert.deepEqual(
    model.songOptions(SERVER_SONGS, { category: 'Entrance' }).map((s) => s.title),
    ['Praise to the Lord, the Almighty', 'Be Thou My Vision'],
  );
  assert.deepEqual(model.songOptions(SERVER_SONGS, { category: 'Entrance', query: 'vision' }).map((s) => s.id), [SONG_B]);
  assert.equal(model.songOptions(SERVER_SONGS, { allSongs: true }).length, 3, 'show all songs ignores the category');
  assert.deepEqual(model.songOptions([], { category: 'Entrance' }), [], 'an empty list stays empty; nothing is invented');
  assert.equal(model.NO_SONGS, 'No songs yet. Songs are added from the church laptop.');
});

test('choosing a song clears typed text for the same segment, and typing clears the song', () => {
  let segments = model.withChoice({}, '1', { songId: SONG_A, text: null });
  assert.deepEqual(segments['1'], { songId: SONG_A });
  segments = model.withChoice(segments, '1', { text: 'Opening note', songId: null });
  assert.deepEqual(segments['1'], { text: 'Opening note' });
  segments = model.withChoice(segments, '1', { songId: null, text: null });
  assert.deepEqual(segments['1'], {}, 'clearing both leaves an empty segment');
});

test('a song that is no longer in the list shows a plain line, not an invented title', () => {
  assert.equal(model.titleOf(SERVER_SONGS, SONG_A), 'Praise to the Lord, the Almighty');
  assert.equal(model.titleOf(SERVER_SONGS, '20000000-0000-4000-8000-0000000000ff'), 'Song no longer in the list');
  assert.equal(model.titleOf(SERVER_SONGS, null), '');
});

test('the save payload has every chosen segment with its minutes, and only notes that have text', () => {
  const payload = model.payloadFor(
    {
      planId: 'plan-1',
      segments: { 1: { songId: SONG_A }, 2: { minutes: 9 }, 3: {} },
      notes: { 2: '  Open prayer  ', 3: '   ' },
    },
    ['1', '2', '3'],
    { 1: 5, 2: 10, 3: 6 },
  );
  assert.deepEqual(payload, {
    id: 'plan-1',
    segments: { 1: { songId: SONG_A, minutes: 5 }, 2: { minutes: 9 }, 3: { minutes: 6 } },
    notes: { 2: 'Open prayer' },
  });
});

test('a Mass save sends no minutes, only what is chosen', () => {
  const payload = model.payloadFor({ planId: 'p', segments: { 7: { text: 'Revelation 7:2-4' } }, notes: {} }, ['7', '8']);
  assert.deepEqual(payload.segments, { 7: { text: 'Revelation 7:2-4' } });
});

test('Save is disabled for the whole of a save, and says so; it is enabled otherwise', () => {
  assert.deepEqual(model.saveButton(true), { disabled: true, label: 'Saving…' });
  assert.deepEqual(model.saveButton(false), { disabled: false, label: 'Save plan' });
});

test('the status line shows a failure first, then unsaved changes, then Saved', () => {
  assert.equal(model.statusText({ dirty: true, error: 'That plan is not in your church.' }), 'That plan is not in your church.');
  assert.equal(model.statusText({ dirty: true, error: '' }), 'Unsaved changes');
  assert.equal(model.statusText({ dirty: false, error: '' }), 'Saved');
});

test('Discard starts again from the saved version, and an edit cannot change the saved copy', () => {
  const saved = { segments: { 1: { songId: SONG_A, minutes: 5 } }, notes: { 2: 'Saved note' } };
  const started = model.savedState(saved);
  started.segments[1].songId = SONG_B;
  started.notes[2] = 'Changed in this session';
  assert.equal(saved.segments[1].songId, SONG_A, 'the saved copy is untouched');
  assert.equal(saved.notes[2], 'Saved note');
  const discarded = model.savedState(saved);
  assert.deepEqual(discarded, { segments: { 1: { songId: SONG_A, minutes: 5 } }, notes: { 2: 'Saved note' } }, 'discard gives the saved version');
});

test('the minute limits are 1 and 60, and the date reads as a plain label', () => {
  assert.equal(model.MIN_MINUTES, 1);
  assert.equal(model.MAX_MINUTES, 60);
  assert.equal(model.dateLabel('2026-11-01'), 'SUNDAY 1 NOVEMBER 2026');
});

test('the view-only note is the design wording', () => {
  assert.equal(model.VIEW_ONLY, 'View only. Ask a planner to make changes.');
});
