// The live projector slide follows an edit to its song: the same stanza where it still exists, the last stanza with a note when the
// song has fewer, nothing changes for another song or for a style change, and a deleted song leaves its slide on screen.
// Run with: node --test shared/live-song.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLyricsStep, lyricsFrameAfterEdit, stanzaTarget } from './live-song.js';
import { initialLiveState, liveReducer } from './live.js';

const hymn = (id, title, stanzas) => ({ id, title, stanzas: stanzas.map((lyricsText, i) => ({ stanzaType: `Verse ${i + 1}`, lyricsText })) });
const shown = (song) => ({
  kind: 'lyrics',
  title: 'Hail Mary',
  label: 'Verse 2',
  text: 'old second verse',
  style: { fontSize: 80 },
  key: `song:${song.hymnId}`,
  song,
});

test('an edit with the same number of stanzas keeps the operator’s stanza', () => {
  const frame = shown({ hymnId: 5, position: 1, count: 3 });
  const edited = hymn(5, 'Hail Mary', ['first', 'new second verse', 'third']);
  const result = lyricsFrameAfterEdit(frame, edited);
  assert.equal(result.frame.text, 'new second verse');
  assert.equal(result.frame.song.position, 1, 'same stanza');
  assert.equal(result.moved, false);
  assert.equal(result.changed, true);
});

test('an edit with more stanzas keeps the operator’s stanza too', () => {
  const frame = shown({ hymnId: 5, position: 1, count: 3 });
  const result = lyricsFrameAfterEdit(frame, hymn(5, 'Hail Mary', ['a', 'b', 'c', 'd']));
  assert.equal(result.frame.song.position, 1);
  assert.equal(result.moved, false);
});

test('an edit with fewer stanzas moves to the last stanza that still exists, and says so', () => {
  const frame = shown({ hymnId: 5, position: 2, count: 3 });
  const result = lyricsFrameAfterEdit(frame, hymn(5, 'Hail Mary', ['only', 'two']));
  assert.equal(result.frame.song.position, 1, 'the last stanza');
  assert.equal(result.frame.text, 'two');
  assert.equal(result.moved, true, 'the operator is told it moved');
});

test('the title and label follow the edit, and the style stays as it was on screen', () => {
  const frame = shown({ hymnId: 5, position: 0, count: 2 });
  const result = lyricsFrameAfterEdit(frame, hymn(5, 'Hail Mary (new)', ['new first', 'b']));
  assert.equal(result.frame.title, 'Hail Mary (new)');
  assert.equal(result.frame.label, 'Verse 1');
  assert.deepEqual(result.frame.style, { fontSize: 80 });
});

test('an edit to another song does not touch the live slide', () => {
  const frame = shown({ hymnId: 5, position: 0, count: 2 });
  assert.equal(lyricsFrameAfterEdit(frame, hymn(6, 'Other', ['x'])), null);
});

test('a style change does not alter the live slide: the text is the same, so nothing changes', () => {
  const frame = shown({ hymnId: 5, position: 1, count: 3 });
  const restyled = hymn(5, 'Hail Mary', ['first', 'old second verse', 'third']);
  const result = lyricsFrameAfterEdit(frame, restyled);
  assert.equal(result.changed, false);
});

test('a deleted song gives no change, so its slide stays on screen', () => {
  const frame = shown({ hymnId: 5, position: 1, count: 3 });
  assert.equal(lyricsFrameAfterEdit(frame, { ...hymn(5, 'Hail Mary', ['a']), deletedAt: '2026-10-28T00:00:00Z' }), null);
  assert.equal(lyricsFrameAfterEdit(frame, null), null);
});

test('a song that has no stanzas any more gives no change either', () => {
  assert.equal(stanzaTarget(0, 3, 0), null);
});

test('a Praise & Worship step shows the target stanza of the song, nearest to the current step', () => {
  const steps = [
    { kind: 'lyrics', hymnId: 5, position: 0 },
    { kind: 'other' },
    { kind: 'lyrics', hymnId: 5, position: 1 },
    { kind: 'lyrics', hymnId: 5, position: 0 },
  ];
  assert.equal(findLyricsStep(steps, 5, 0, 2), 3, 'the repeat nearest the current step');
  assert.equal(findLyricsStep(steps, 5, 1, 0), 2);
  assert.equal(findLyricsStep(steps, 5, 4, 0), null, 'a stanza no longer in the arrangement');
});

test('the projector refreshes only the slide whose key matches, and nothing else in the live state changes', () => {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'projector/show', frame: shown({ hymnId: 5, position: 0, count: 2 }), source: 'DIRECT_DECK' });
  const other = liveReducer(state, { type: 'projector/refresh', key: 'song:6', frame: { kind: 'lyrics', title: 'x', label: 'x', text: 'x' } });
  assert.equal(other, state, 'no matching key: the state is not changed at all');
  const refreshed = liveReducer(state, { type: 'projector/refresh', key: 'song:5', frame: { ...shown({ hymnId: 5, position: 0, count: 2 }), text: 'new words' } });
  assert.equal(refreshed.projector.live.text, 'new words');
  assert.equal(refreshed.projector.staged.text, 'new words', 'the staged copy of the same slide follows');
  assert.equal(refreshed.projector.source, state.projector.source, 'the source is not changed');
  assert.equal(refreshed.queueCursor, state.queueCursor, 'the queue selection is not changed');
});

test('a prayer slide refreshes by its own key', () => {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'projector/show', frame: { kind: 'text', title: 'Prayer', text: 'old', bg: null, key: 'prayer:3' } });
  const refreshed = liveReducer(state, { type: 'projector/refresh', key: 'prayer:3', frame: { kind: 'text', title: 'Prayer', text: 'new', bg: null, key: 'prayer:3' } });
  assert.equal(refreshed.projector.live.text, 'new');
});
