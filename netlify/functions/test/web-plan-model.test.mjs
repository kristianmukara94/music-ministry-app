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
  { id: SONG_A, title: 'Praise to the Lord, the Almighty', category: 'Entrance Procession', language: 'English', key: 'D' },
  { id: SONG_B, title: 'Be Thou My Vision', category: 'Entrance Procession', language: 'English', key: 'Eb' },
  { id: SONG_C, title: 'Psalm 24 setting', category: 'Responsorial Psalm', language: 'English', key: 'F' },
];

test('the Mass steps come from the template structure, and their sample values are never used', () => {
  const steps = model.massSteps(sample.MASS_PLAN);
  assert.equal(steps.length, 31);
  assert.equal(steps[0].n, 1);
  assert.equal(steps[0].category, 'Entrance Procession');
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
    model.songOptions(SERVER_SONGS, { category: 'Entrance Procession' }).map((s) => s.title),
    ['Praise to the Lord, the Almighty', 'Be Thou My Vision'],
  );
  assert.deepEqual(model.songOptions(SERVER_SONGS, { category: 'Entrance Procession', query: 'vision' }).map((s) => s.id), [SONG_B]);
  assert.equal(model.songOptions(SERVER_SONGS, { allSongs: true }).length, 3, 'show all songs ignores the category');
  assert.deepEqual(model.songOptions([], { category: 'Entrance Procession' }), [], 'an empty list stays empty; nothing is invented');
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

test('the web song categories are the laptop\'s song category names, in the same order', async () => {
  const flow = await import(pathToFileURL(path.join(here, '..', '..', '..', 'shared', 'mass-flow.js')).href);
  assert.deepEqual(sample.SONG_CATEGORIES, flow.SONG_CATEGORY_NAMES, 'the web picker offers exactly the laptop\'s categories');
});

test('every Mass step that names a category uses one the web picker offers', () => {
  for (const step of model.massSteps(sample.MASS_PLAN)) {
    if (step.kind === 'song' && step.category) assert.ok(sample.SONG_CATEGORIES.includes(step.category), `${step.category} is offered`);
  }
});

// ---- The item list the editors read and save ----

const STEPS = model.massSteps(sample.MASS_PLAN);
const SEGS = model.praiseSegments(sample.PRAISE_PLAN);

test('the Mass steps carry their group, by section', () => {
  assert.equal(STEPS.find((s) => s.n === 1).group, 'introductory');
  assert.equal(STEPS.find((s) => s.n === 7).group, 'word');
  assert.equal(STEPS.find((s) => s.n === 15).group, 'eucharist');
  assert.equal(STEPS.find((s) => s.n === 25).group, 'communion');
  assert.equal(STEPS.find((s) => s.n === 31).group, 'concluding');
});

test('a saved Mass plan reads into the editor: the song or text per step, the notes, and items the editor does not show', () => {
  const items = [
    { key: '1', group: 'introductory', order: 1, kind: 'song', songId: SONG_A },
    { key: '2', group: 'introductory', order: 2, kind: 'rite', note: 'Incense' },
    { key: 'laptop-9', group: 'word', order: 40, kind: 'reading', text: 'Matthew 5' },
  ];
  const state = model.massFromItems(items, STEPS);
  assert.deepEqual(state.segments, { 1: { songId: SONG_A } });
  assert.deepEqual(state.notes, { 2: 'Incense' });
  assert.deepEqual(state.extra, [items[2]], 'an item the editor does not show is kept, not dropped');
});

test('the editor saves a Mass plan as items in step order, with the unshown items last and renumbered', () => {
  const state = { segments: { 7: { text: 'Revelation 7:2-4' }, 1: { songId: SONG_A } }, notes: { 2: 'Incense' }, extra: [{ key: 'laptop-9', group: 'word', order: 40, kind: 'reading', text: 'Matthew 5' }] };
  const items = model.massToItems(state, STEPS);
  assert.deepEqual(items.map((i) => i.key), ['1', '2', '7', 'laptop-9']);
  assert.deepEqual(items.map((i) => i.order), [1, 2, 3, 4]);
  assert.equal(items.find((i) => i.key === '7').kind, 'reading');
  assert.equal(items.find((i) => i.key === '2').kind, 'rite');
  assert.equal(items.find((i) => i.key === '2').note, 'Incense');
});

test('a Praise & Worship plan reads its minutes, and saves every segment with its minutes', () => {
  const state = model.praiseFromItems([{ key: '3', group: 'opening', order: 3, kind: 'song', songId: SONG_A, minutes: 12 }], SEGS);
  assert.equal(state.segments['3'].minutes, 12);
  const items = model.praiseToItems({ ...state, extra: [] }, SEGS);
  assert.equal(items.length, SEGS.length, 'every segment is saved');
  assert.equal(items.find((i) => i.key === '3').minutes, 12);
  assert.equal(items.find((i) => i.key === '1').minutes, 5, 'a segment with no change keeps its default minutes');
});

test('a song the plan uses that has been removed is shown as removed, and an unknown song as no longer in the list', () => {
  const songs = [{ id: SONG_A, title: 'Praise to the Lord' }, { id: SONG_B, title: 'Old song', removed: true }];
  assert.equal(model.titleOf(songs, SONG_A), 'Praise to the Lord');
  assert.equal(model.titleOf(songs, SONG_B), 'Old song (removed)');
  assert.equal(model.titleOf(songs, 'not-in-the-list'), 'Song no longer in the list');
});

test('the editor\'s song list is the picker\'s songs plus any removed song the plan refers to', () => {
  const picker = [{ id: SONG_A, title: 'Praise to the Lord' }];
  const planSongs = [{ id: SONG_A, title: 'Praise to the Lord' }, { id: SONG_B, title: 'Old song', removed: true }];
  assert.deepEqual(model.songsForEditor(picker, planSongs).map((s) => s.id), [SONG_A, SONG_B]);
});

test('the save body carries the plan\'s id, the version the editor loaded, and the items', () => {
  assert.deepEqual(model.savePayload({ id: 'p1', updatedAt: '2026-10-27T10:00:00.000Z' }, [{ key: '1' }]), {
    id: 'p1',
    baseUpdatedAt: '2026-10-27T10:00:00.000Z',
    items: [{ key: '1' }],
  });
});
