// The two display targets. `primary` is the projector; `secondary` is the TV and the viewers on the Secondary port. In dual mode the secondary
// mirrors the projector's frame; in independent mode it shows its own frame. Its live switch is separate: changing one never changes the other.
// Run with: node --test shared/display-targets.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, liveReducer, secondaryFrame } from './live.js';
import { remoteViewSnapshot, secondaryViewSnapshot } from './remote-view.js';

const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const TEXT = { kind: 'text', title: 'Notice', text: 'Welcome', bg: null };
const OTHER = { kind: 'text', title: 'Second', text: 'Thank you', bg: null };
const showProjector = { type: 'projector/show', frame: TEXT, source: 'DIRECT_DECK' };
const output = (state) => ({ ...state.outputs, projector: state.outputs.projector });

test('the default is dual mode, with the secondary display off', () => {
  const s = initialLiveState();
  assert.equal(s.display.mode, 'dual');
  assert.equal(s.display.targets.secondary.live, false);
  assert.equal(s.display.targets.secondary.layout, 'screen-16x9');
});

test('dual mode: the secondary display mirrors the projector frame when it is on', () => {
  let s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, showProjector, { type: 'display/live', value: true });
  assert.deepEqual(secondaryFrame(s), TEXT, 'the secondary shows what the projector shows');
  const snap = secondaryViewSnapshot(s, 1);
  assert.equal(snap.screen, 'live');
  assert.deepEqual(snap.lines, ['Welcome']);
});

test('independent mode: the secondary shows its own frame, and the projector is not changed', () => {
  let s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, showProjector, { type: 'display/mode', value: 'independent' }, { type: 'display/show', frame: OTHER }, { type: 'display/live', value: true });
  assert.deepEqual(secondaryFrame(s), OTHER);
  assert.deepEqual(s.projector.live, TEXT, 'the projector keeps its own frame');
  assert.deepEqual(secondaryViewSnapshot(s, 1).lines, ['Thank you']);
  assert.deepEqual(remoteViewSnapshot(s, 1).lines, ['Welcome'], 'the primary snapshot is still the projector');
});

test('the secondary live switch changes only the secondary display', () => {
  let s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, showProjector);
  const projector = { live: s.projector.live, staged: s.projector.staged };
  const outputs = output(s);
  s = run(s, { type: 'display/live', value: true }, { type: 'display/live', value: false });
  assert.equal(s.display.targets.secondary.live, false);
  assert.deepEqual({ live: s.projector.live, staged: s.projector.staged }, projector, 'the projector is unchanged');
  assert.deepEqual(output(s), outputs, 'the projector output switch is unchanged');
});

test('turning the projector off does not turn the secondary off, and the secondary is off-screen when its switch is off', () => {
  let s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, showProjector, { type: 'display/live', value: true });
  s = run(s, { type: 'output/toggle', output: 'projector' });
  assert.equal(s.display.targets.secondary.live, true, 'the secondary stays on');
  assert.equal(secondaryViewSnapshot(s, 1).screen, 'live', 'it still shows the frame it has');
  s = run(s, { type: 'display/live', value: false });
  assert.equal(secondaryViewSnapshot(s, 1).screen, 'off', 'off when its own switch is off');
});

test('an unknown mode is ignored, and the mode is one of dual or independent', () => {
  const s = initialLiveState();
  assert.equal(run(s, { type: 'display/mode', value: 'sideways' }).display.mode, 'dual');
  assert.equal(run(s, { type: 'display/mode', value: 'independent' }).display.mode, 'independent');
});

test('stop does not change the secondary display', () => {
  const s = run(initialLiveState(), { type: 'display/mode', value: 'independent' }, { type: 'display/show', frame: OTHER }, { type: 'display/live', value: true }, { type: 'stop' });
  assert.equal(s.display.mode, 'independent');
  assert.equal(s.display.targets.secondary.live, true);
});

test('a blackout or an idle frame shows on the secondary display as its own screen state', () => {
  const s = run(initialLiveState(), { type: 'display/mode', value: 'independent' }, { type: 'display/show', frame: { kind: 'blackout' } }, { type: 'display/live', value: true });
  assert.equal(secondaryViewSnapshot(s, 1).screen, 'blackout');
});
