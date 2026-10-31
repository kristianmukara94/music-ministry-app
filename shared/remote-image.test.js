// Tests that a PowerPoint's pictures can be stepped through from a phone, and that phones are told which picture is on air.
// Run with: node --test shared/remote-image.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, liveReducer } from './live.js';
import { controlAction, remoteViewSnapshot, secondaryViewSnapshot, snapshotForRole } from './remote-view.js';

const slides = [1, 2, 3].map((n) => ({ title: `Deck - Slide ${n}`, src: `apcc-media://slide/${n}0` }));
const frame = (index) => ({ kind: 'image', title: slides[index].title, src: slides[index].src, deck: { slides, index } });

function onAir(index = 0) {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'output/set', output: 'projector', on: true });
  state = liveReducer(state, { type: 'projector/stage', frame: frame(index) });
  return liveReducer(state, { type: 'projector/take' });
}

test('Next and Previous move through the pictures of a deck', () => {
  let state = onAir(0);
  const next = controlAction(state, { action: 'next' });
  assert.equal(next.ok, true);
  state = liveReducer(state, next.action);
  assert.equal(state.projector.live.src, slides[1].src);
  assert.equal(state.projector.live.deck.index, 1);
  state = liveReducer(state, controlAction(state, { action: 'previous' }).action);
  assert.equal(state.projector.live.src, slides[0].src);
});

test('Next stops at the last picture and Jump goes straight to one', () => {
  let state = onAir(2);
  assert.equal(liveReducer(state, { type: 'projector/step', delta: 1 }), state);
  const jump = controlAction(state, { action: 'jump', index: 0 });
  state = liveReducer(state, jump.action);
  assert.equal(state.projector.live.deck.index, 0);
  assert.equal(controlAction(state, { action: 'jump', index: 9 }).ok, false);
});

test('a lone picture has nothing to step to', () => {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'output/set', output: 'projector', on: true });
  state = liveReducer(state, { type: 'projector/stage', frame: { kind: 'image', title: 'One', src: 'apcc-media://slide/5' } });
  state = liveReducer(state, { type: 'projector/take' });
  assert.equal(controlAction(state, { action: 'next' }).ok, false);
});

test('phones are told the picture on air, its position, and what comes next', () => {
  const state = onAir(1);
  const snap = remoteViewSnapshot(state);
  assert.equal(snap.screen, 'live');
  assert.equal(snap.image, '20');
  assert.equal(snap.position, '2 of 3');
  assert.deepEqual(snap.sections, { index: 1, count: 3 });
  assert.deepEqual(snap.nextLines, ['Deck - Slide 3']);
});

test('a frame that is not a picture sends no picture', () => {
  const state = liveReducer(initialLiveState(), { type: 'output/set', output: 'projector', on: true });
  assert.equal(remoteViewSnapshot(state).image, null);
  assert.equal(secondaryViewSnapshot(state).frame.image ?? null, null);
});

test('a phone steps Praise & Worship through the operator window, and can jump within the segment', () => {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'output/set', output: 'projector', on: true });
  const pwFrame = { kind: 'pw', slide: { kind: 'prayer', text: 'Prayer' }, segmentName: 'Prayer to Take Authority', type: 'prayer', index: 0, total: 83 };
  state = liveReducer(state, { type: 'projector/stage', frame: pwFrame });
  state = liveReducer(state, { type: 'projector/take', source: 'PW_SESSION' });
  state = liveReducer(state, { type: 'pw/load', sessionId: 1 });
  state = liveReducer(state, { type: 'pw/cursor', segmentKey: 'a', slide: 0, now: 1 });

  const snap = remoteViewSnapshot(state);
  assert.equal(snap.position, '1 of 83');
  assert.equal(snap.sections.steps, true);

  const next = controlAction(state, { action: 'next' });
  assert.deepEqual(next.action, { type: 'remote/pwstep', delta: 1 });
  const once = liveReducer(state, next.action);
  const twice = liveReducer(once, controlAction(once, { action: 'previous' }).action);
  assert.equal(once.pwStep.seq, 1);
  assert.equal(twice.pwStep.seq, 2);
  assert.equal(twice.pwStep.delta, -1);
  assert.deepEqual(controlAction(state, { action: 'jump', index: 3 }).action, { type: 'remote/pwstep', index: 3 });
  assert.equal(liveReducer(state, { type: 'remote/pwstep', index: 3 }).pwStep.index, 3);
  assert.equal(controlAction(state, { action: 'jump', index: 83 }).ok, false);
});

test('a phone sees the lineup, and picking an item puts it on air', () => {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'output/set', output: 'projector', on: true });
  state = liveReducer(state, { type: 'pw/load', sessionId: 1 });
  state = liveReducer(state, { type: 'pw/lineup', items: [{ key: 'a', name: 'Prayer', minutes: 3 }, { key: 'b', name: 'Marian Song', minutes: 5 }] });
  state = liveReducer(state, { type: 'pw/cursor', segmentKey: 'b', slide: 0, now: 1 });
  state = liveReducer(state, { type: 'projector/stage', frame: { kind: 'pw', slide: { kind: 'title' }, segmentName: 'Marian Song', type: 'song', index: 0, total: 3 } });
  state = liveReducer(state, { type: 'projector/take', source: 'PW_SESSION' });

  const snap = remoteViewSnapshot(state);
  assert.deepEqual(snap.lineup.items.map((i) => i.name), ['Prayer', 'Marian Song']);
  assert.equal(snap.lineup.current, 1);
  assert.equal('lineup' in snapshotForRole(snap, 'secondary'), false);

  const pick = controlAction(state, { action: 'segment', index: 0 });
  assert.deepEqual(pick.action, { type: 'remote/pwstep', segment: 0 });
  assert.equal(liveReducer(state, pick.action).pwStep.segment, 0);
  assert.equal(controlAction(state, { action: 'segment', index: 2 }).ok, false);
  assert.equal(remoteViewSnapshot(liveReducer(state, { type: 'pw/end' })).lineup, null);
});

test('a phone mirrors the open panel: the Rosary shows its steps and sections, and the phone drives them', () => {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'output/set', output: 'projector', on: true });
  const rosary = { kind: 'rosary', section: 'Glorious Mysteries', decade: 'Decade 1', mystery: 'The Resurrection', scripture: '', prayer: 'Announce', text: 'Christ is risen.', bead: null, stage: 'announce' };
  state = liveReducer(state, { type: 'projector/stage', frame: rosary });
  state = liveReducer(state, { type: 'projector/take' });
  state = liveReducer(state, {
    type: 'remote/panel',
    panel: { panel: 'rosary', title: 'Rosary', step: { index: 6, count: 78 }, sections: [{ label: 'Introductory Prayers', current: false }, { label: '1. The Resurrection', current: true }] },
  });

  const snap = remoteViewSnapshot(state);
  assert.equal(snap.position, '7 of 78');
  assert.deepEqual(snap.sections, { index: 6, count: 78 });
  assert.equal(snap.lineup.title, 'Rosary');
  assert.equal(snap.lineup.current, 1);

  assert.deepEqual(controlAction(state, { action: 'next' }).action, { type: 'remote/command', command: { action: 'step', delta: 1 } });
  assert.deepEqual(controlAction(state, { action: 'jump', index: 10 }).action, { type: 'remote/command', command: { action: 'jump', index: 10 } });
  assert.deepEqual(controlAction(state, { action: 'segment', index: 0 }).action, { type: 'remote/command', command: { action: 'section', index: 0 } });
  assert.equal(controlAction(state, { action: 'jump', index: 78 }).ok, false);
  assert.equal(liveReducer(state, controlAction(state, { action: 'next' }).action).remoteCmd.seq, 1);
  assert.equal(remoteViewSnapshot(liveReducer(state, { type: 'remote/panel', panel: null })).lineup, null);
});

test('a song or a text slide can be stepped from a phone through its own panel', () => {
  let state = initialLiveState();
  state = liveReducer(state, { type: 'output/set', output: 'projector', on: true });
  state = liveReducer(state, { type: 'projector/stage', frame: { kind: 'lyrics', title: 'Amazing Grace', label: 'Verse 1', text: 'a' } });
  state = liveReducer(state, { type: 'projector/take' });
  assert.deepEqual(controlAction(state, { action: 'previous' }).action, { type: 'remote/command', command: { action: 'step', delta: -1 } });
});
