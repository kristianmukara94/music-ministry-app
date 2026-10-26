// Praise & Worship model and live-state tests. Run with: node --test shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, livePosition, moveSegment, segmentFromTemplate, step } from './pw.js';
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
