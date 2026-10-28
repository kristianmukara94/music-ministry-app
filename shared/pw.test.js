// Praise & Worship model and live-state tests. Run with: node --test shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsTab, DEFAULT_TEMPLATE, livePosition, moveSegment, readiness, scriptureAssignment, segmentFromTemplate, segmentStatus, songAssignment, step, typesFor, visibleSlideIndexes } from './pw.js';
import { initialLiveState, liveReducer } from './live.js';

const lineup = () => DEFAULT_TEMPLATE.groups.flatMap((g) => DEFAULT_TEMPLATE.segments.filter((s) => s.group === g.key)).map(segmentFromTemplate);
const keys = (list) => list.map((s) => s.key);

test('live position follows the segment when the lineup is reordered', () => {
  const groups = DEFAULT_TEMPLATE.groups;
  const segments = lineup();
  // Live on the second slide of Worship, the sixth segment.
  const live = { segmentKey: 'worship', slide: 1 };
  assert.deepEqual(livePosition(segments, live), { segment: 5, slide: 1 });

  // Move Worship to the top of the lineup, as a drag during the service would.
  const reordered = moveSegment(segments, groups, 5, 'opening', 0);
  assert.equal(reordered[0].key, 'worship');
  // The same live state now points at Worship's new row, not at whatever sits at its old index.
  assert.deepEqual(livePosition(reordered, live), { segment: 0, slide: 1 });
  assert.equal(reordered[livePosition(reordered, live).segment].key, 'worship');
});

test('an index-based position would have moved the live slide on reorder', () => {
  const segments = lineup();
  const groups = DEFAULT_TEMPLATE.groups;
  const reordered = moveSegment(segments, groups, 5, 'opening', 0);
  // Index 5 after the move is a different segment: this is the bug the key avoids.
  assert.notEqual(reordered[5].key, 'worship');
});

test('next and back keep walking from the live segment after a reorder', () => {
  const groups = DEFAULT_TEMPLATE.groups;
  const reordered = moveSegment(lineup(), groups, 5, 'opening', 0);
  const counts = reordered.map(() => 1);
  const at = livePosition(reordered, { segmentKey: 'worship', slide: 0 });
  assert.equal(reordered[step(counts, at, 1).segment].key, keys(reordered)[1]);
  // Back from the live segment goes to the previous one, which after the move is the one that was above it.
  assert.equal(reordered[step(counts, at, -1)?.segment ?? 0].key, 'worship');
  assert.equal(step(counts, { segment: 0, slide: 0 }, -1), null, 'Back at the top of the lineup goes nowhere');
});

test('a live segment removed from the lineup has no position, and the start has one', () => {
  const segments = lineup().filter((s) => s.key !== 'worship');
  assert.equal(livePosition(segments, { segmentKey: 'worship', slide: 0 }), null);
  assert.deepEqual(livePosition(segments, { segmentKey: null, slide: 0 }), { segment: 0, slide: 0 });
  assert.equal(livePosition(segments, null), null);
});

test('the reducer keeps the segment key and starts the segment timer only on a new segment', () => {
  let s = liveReducer(initialLiveState(), { type: 'pw/load', sessionId: 3 });
  assert.equal(s.pw.segmentKey, null);
  s = liveReducer(s, { type: 'pw/cursor', segmentKey: 'worship', slide: 0, now: 1000 });
  assert.equal(s.pw.segmentKey, 'worship');
  assert.equal(s.pw.startedAt, 1000);
  s = liveReducer(s, { type: 'pw/cursor', segmentKey: 'worship', slide: 2, now: 5000 });
  assert.equal(s.pw.startedAt, 1000, 'same segment keeps its timer');
  s = liveReducer(s, { type: 'pw/cursor', segmentKey: 'finale', slide: 0, now: 9000 });
  assert.equal(s.pw.startedAt, 9000);
  assert.equal(s.pw.liveSince, 1000, 'the session clock keeps running');
});

test('Mass Queue activity takes Praise & Worship off air and keeps its place', () => {
  let s = liveReducer(initialLiveState(), { type: 'output/set', output: 'projector', on: true });
  s = liveReducer(s, { type: 'pw/load', sessionId: 3 });
  s = liveReducer(s, { type: 'pw/cursor', segmentKey: 'holy_spirit', slide: 0, now: 1 });
  assert.equal(s.projector.source, null);
  s = liveReducer(s, { type: 'projector/stage', frame: { kind: 'idle' } });
  s = liveReducer(s, { type: 'projector/take', source: 'MASS_QUEUE' });
  assert.equal(s.pw.onAir, false);
  assert.equal(s.pw.segmentKey, 'holy_spirit');
});

test('"Show all verses" off lists the live slide and the next one, or the first before any cue', () => {
  assert.deepEqual(visibleSlideIndexes(6, -1), [0]);
  assert.deepEqual(visibleSlideIndexes(6, null), [0]);
  assert.deepEqual(visibleSlideIndexes(6, 0), [0, 1]);
  assert.deepEqual(visibleSlideIndexes(6, 4), [4, 5]);
  assert.deepEqual(visibleSlideIndexes(6, 5), [5], 'the last slide has no next one');
  assert.deepEqual(visibleSlideIndexes(0, -1), []);
});

// Insert rules for the lineup slots. The helpers apply a patch the way the desktop Library does.
const slot = (key) => segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === key));
const applied = (segment, patch) => (patch ? { ...segment, ...patch } : segment);

test('segment 4 holds a title slide by default and also takes a song', () => {
  const seg = slot('bible_enthronement');
  assert.equal(seg.type, 'scripture');
  assert.deepEqual(seg.content, { kind: 'title' });
  assert.deepEqual(typesFor(seg), ['scripture', 'song']);
  assert.equal(acceptsTab(seg, 'song'), true);
  assert.equal(acceptsTab(seg, 'scripture'), true);
  assert.equal(acceptsTab(seg, 'prayer'), false);
});

test('a song can be assigned to segment 4, which then holds that song and keeps its minutes', () => {
  const seg = slot('bible_enthronement');
  const patch = songAssignment(seg, 7, null);
  assert.ok(patch, 'the song is accepted');
  const after = applied(seg, patch);
  assert.equal(after.type, 'song');
  assert.deepEqual(after.content, { kind: 'song', hymnIds: [7], maxSongs: 1, category: null });
  assert.deepEqual(after.arrangement, {});
  assert.equal(segmentStatus(after), 'ready');
  assert.equal(after.minutes, 4, 'songs carry no duration, so the slot keeps its minutes');
  assert.equal(Object.hasOwn(patch, 'minutes'), false);
});

test('the title slide can still be assigned to segment 4 after a song', () => {
  const seg = slot('bible_enthronement');
  const withSong = applied(seg, songAssignment(seg, 7, null));
  const patch = scriptureAssignment(withSong, { kind: 'title' });
  assert.ok(patch, 'the title slide is accepted');
  const back = applied(withSong, patch);
  assert.equal(back.type, 'scripture');
  assert.deepEqual(back.content, { kind: 'title' });
  assert.deepEqual(back.arrangement, {});
  assert.equal(segmentStatus(back), 'ready');
  assert.equal(back.minutes, 4);
});

test('the title slide is still assignable on its own, before any song', () => {
  const seg = slot('bible_enthronement');
  assert.deepEqual(scriptureAssignment(seg, { kind: 'title' }), { type: 'scripture', content: { kind: 'title' }, arrangement: {} });
});

test('segments 3 and 5 keep their song-only rules', () => {
  for (const key of ['marian_song', 'joyful_song']) {
    const seg = slot(key);
    assert.deepEqual(typesFor(seg), ['song'], key);
    assert.equal(acceptsTab(seg, 'scripture'), false, key);
    assert.equal(scriptureAssignment(seg, { kind: 'title' }), null, `${key} still refuses a title slide`);
    const filled = applied(seg, songAssignment(seg, 7, null));
    assert.deepEqual(filled.content, { kind: 'song', hymnIds: [7], maxSongs: 1, category: null }, key);
    assert.equal(filled.type, 'song', key);
  }
  assert.equal(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song').types, undefined);
  assert.equal(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'joyful_song').types, undefined);
});

test('a multi-song slot still stops at its limit and refuses a repeat', () => {
  const worship = slot('worship');
  let seg = worship;
  for (const id of [1, 2, 3]) seg = applied(seg, songAssignment(seg, id, null));
  assert.deepEqual(seg.content.hymnIds, [1, 2, 3]);
  assert.equal(songAssignment(seg, 4, null), null, 'a fourth song is refused');
  assert.equal(songAssignment(seg, 2, null), null, 'a song already in the slot is refused');
});

test('a segment the template does not list holds only its own type', () => {
  const seg = { key: 'not_in_template', type: 'prayer' };
  assert.deepEqual(typesFor(seg), ['prayer']);
  assert.equal(acceptsTab(seg, 'song'), false);
});
