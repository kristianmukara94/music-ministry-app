// The slide launch guard: a slide goes live straight away when any output is live, the projector or the Secondary display (Remote). The
// "projector is off" prompt asks only when both are off. Run with: node --test shared/output-guard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, isAnyOutputLive, liveReducer } from './live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);

test('both outputs off: the prompt is needed', () => {
  assert.equal(isAnyOutputLive(initialLiveState()), false);
});

test('the projector live is enough to go straight ahead', () => {
  const s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' });
  assert.equal(isAnyOutputLive(s), true);
});

test('Remote live with the projector off is enough to go straight ahead, with no prompt', () => {
  const s = run(initialLiveState(), { type: 'display/live', value: true });
  assert.equal(s.outputs.projector, false, 'the projector is still off');
  assert.equal(isAnyOutputLive(s), true);
});

test('turning Remote off again brings the prompt back', () => {
  const s = run(initialLiveState(), { type: 'display/live', value: true }, { type: 'display/live', value: false });
  assert.equal(isAnyOutputLive(s), false);
});

test('the Mass queue and the Praise & Worship guard both use the shared check, and nothing else', () => {
  const routing = read('src/planner/routing.ts');
  assert.match(routing, /if \(!isAnyOutputLive\(state\)\) \{/);
  assert.doesNotMatch(routing, /if \(!outputs\.projector\)/, 'the projector-only guard is gone');

  const pw = read('src/praise-worship/live.ts');
  assert.match(pw, /if \(!isAnyOutputLive\(live\)\) \{/);
  assert.doesNotMatch(pw, /if \(!live\.outputs\.projector\)/, 'the projector-only guard is gone');
});

test('Skip still launches without the projector, and the turn-on choice still turns it on', () => {
  const routing = read('src/planner/routing.ts');
  assert.match(routing, /skip: \(\) => \{\s*setUi\(\{ projectorPrompt: null, projectorPromptChoice: 'skip' \}\);/);
  assert.match(routing, /turnOnAndGo: \(\) => \{\s*setUi\(\{ projectorPrompt: null \}\);\s*turnOnProjectorAndGo/);
});
