// The Primary (control) viewer moves slides while the Remote display is live, even with the projector off, because in dual mode the TV shows the
// projector's frame. The step reaches the TV at once. In independent mode, or with nothing live, the controls stay off. Run with:
// node --test shared/remote-nav.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, liveReducer } from './live.js';
import { controlAction, primaryDrives, remoteViewSnapshot, secondaryViewSnapshot } from './remote-view.js';

const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const DECK = {
  kind: 'deck',
  title: 'Readings',
  slides: [[{ role: 'reader', text: 'First' }], [{ role: 'reader', text: 'Second' }], [{ role: 'reader', text: 'Third' }]],
  index: 0,
};
const show = { type: 'projector/show', frame: DECK, source: 'DIRECT_DECK' };
const projectorOn = { type: 'output/toggle', output: 'projector' };

test('the control viewer is driven with the projector off when the dual-mode Remote is live', () => {
  const s = run(initialLiveState(), projectorOn, show, projectorOn, { type: 'display/live', value: true });
  assert.equal(s.outputs.projector, false, 'the projector is off');
  assert.equal(primaryDrives(s), true);
  assert.equal(remoteViewSnapshot(s, 1).screen, 'live', 'the banner is not shown');
  assert.deepEqual(remoteViewSnapshot(s, 1).sections, { index: 0, count: 3 });
});

test('a next step with the projector off is accepted, and the TV shows the next slide at once', () => {
  const s = run(initialLiveState(), projectorOn, show, projectorOn, { type: 'display/live', value: true });
  const result = controlAction(s, { action: 'next' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.action, { type: 'projector/step', delta: 1 });
  const after = liveReducer(s, result.action);
  assert.deepEqual(secondaryViewSnapshot(after, 1).lines, ['Second'], 'the Secondary display shows the new slide');
  assert.deepEqual(remoteViewSnapshot(after, 1).lines, ['Second'], 'the control viewer shows it too');
});

test('a jump with the projector off goes to the chosen slide', () => {
  const s = run(initialLiveState(), projectorOn, show, projectorOn, { type: 'display/live', value: true });
  const result = controlAction(s, { action: 'jump', index: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(liveReducer(s, result.action).projector.live.index, 2);
});

test('with the projector and the Remote both off, the controls stay off and the banner shows', () => {
  const s = run(initialLiveState(), projectorOn, show, projectorOn);
  assert.equal(primaryDrives(s), false);
  assert.equal(remoteViewSnapshot(s, 1).screen, 'off');
  const refused = controlAction(s, { action: 'next' });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 409);
});

test('in independent mode the TV has its own frame, so the controls stay off even with the Remote live', () => {
  const s = run(initialLiveState(), projectorOn, show, projectorOn, { type: 'display/mode', value: 'independent' }, { type: 'display/live', value: true });
  assert.equal(primaryDrives(s), false);
  assert.equal(controlAction(s, { action: 'next' }).ok, false);
});

test('with the projector on, the controls work as before, and a paused projector still refuses', () => {
  const on = run(initialLiveState(), projectorOn, show);
  assert.equal(primaryDrives(on), true);
  assert.equal(controlAction(on, { action: 'next' }).ok, true);
  const paused = liveReducer(on, { type: 'projector/pause' });
  assert.deepEqual(controlAction(paused, { action: 'next' }), { ok: false, status: 409, error: 'Paused by operator' });
});
