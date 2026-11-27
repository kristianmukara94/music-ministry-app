// Blackout blacks out every audience screen, while the operator's floating Live preview keeps drawing the slide and shows a BLACKOUT badge.
// Run with: node --test shared/blackout-preview.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';
import { remoteViewSnapshot, secondaryViewSnapshot } from './remote-view.js';
import { mirrorSource } from './stage-plan-row.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const slide = (body = 'Sample Verse Line') => ({
  kind: 'deck',
  title: 'Sample Slide Title',
  slides: [[body], ['Sample Body Text']],
  index: 0,
});

const run = (state, ...actions) => actions.reduce(liveReducer, state);

/** The sample slide on the projector and the Secondary display, both switched on. */
function onAir() {
  const start = initialLiveState();
  const secondary = { ...start.display.targets.secondary, live: true };
  return run(
    { ...start, display: { ...start.display, targets: { ...start.display.targets, secondary } } },
    { type: 'output/set', output: 'projector', on: true },
    { type: 'projector/show', frame: slide(), source: 'DIRECT_DECK' },
  );
}

const blackedOut = () => run(onAir(), { type: 'projector/blackout' });
const preview = (state, options) => mirrorSource(state.projector, { mirror: true, ignoreBlackout: true, ...options });

test('under Blackout the projector, the cast picture, /tv and the TV are black, with no slide text', () => {
  const state = blackedOut();
  // The Projector window and Nearby TV Cast's picture window draw ProjectorView with no props.
  assert.deepEqual(mirrorSource(state.projector), { kind: 'blackout' });
  // The Primary phone and the cast stage view.
  const primary = remoteViewSnapshot(state, 0);
  assert.equal(primary.screen, 'blackout');
  assert.deepEqual(primary.lines, []);
  // The Secondary port: the TV (/tv) and its viewers.
  const tv = secondaryViewSnapshot(state, 0);
  assert.equal(tv.screen, 'blackout');
  assert.equal(tv.frame.kind, 'blackout');
  assert.doesNotMatch(JSON.stringify([primary.lines, tv.lines, tv.frame]), /Sample/);
});

test('an audience screen cannot use the exemption: without mirror the option does nothing', () => {
  assert.deepEqual(mirrorSource(blackedOut().projector, { ignoreBlackout: true }), { kind: 'blackout' });
});

test('the Live preview keeps drawing the active slide under Blackout', () => {
  assert.deepEqual(preview(blackedOut()), slide());
});

test('the other operator mirrors still show Blackout', () => {
  assert.deepEqual(mirrorSource(blackedOut().projector, { mirror: true }), { kind: 'blackout' });
});

test('a slide sent under Blackout shows in the preview while the audience stays black', () => {
  const state = run(blackedOut(), { type: 'projector/show', frame: slide('Sample Body Text'), source: 'DIRECT_DECK' });
  assert.deepEqual(preview(state), slide('Sample Body Text'));
  assert.equal(state.projector.live.kind, 'blackout');
});

test('Clear text still clears the preview under Blackout, and Blackout stays up', () => {
  const state = run(blackedOut(), { type: 'projector/clear' });
  assert.equal(preview(state).kind, 'idle');
  assert.equal(state.projector.live.kind, 'blackout');
});

test('Blackout off puts the previewed slide back on every output', () => {
  const state = run(blackedOut(), { type: 'projector/blackout' });
  assert.deepEqual(state.projector.live, slide());
  assert.deepEqual(preview(state), slide());
  assert.equal(remoteViewSnapshot(state, 0).screen, 'live');
});

test('a paused or staged preview still shows the staged slide', () => {
  const paused = run(onAir(), { type: 'projector/pause', paused: true }, { type: 'projector/stage', frame: slide('Sample Body Text') }, { type: 'projector/blackout' });
  assert.deepEqual(preview(paused), slide('Sample Body Text'));
  const staged = run(blackedOut(), { type: 'projector/stage', frame: slide('Sample Body Text') });
  assert.deepEqual(preview(staged, { peek: true }), slide('Sample Body Text'));
  assert.deepEqual(preview(staged), slide());
});

test('a black frame with nothing held behind it stays black in the preview', () => {
  const state = run(initialLiveState(), { type: 'projector/show', frame: { kind: 'blackout' }, source: 'DIRECT_DECK' });
  assert.deepEqual(preview(state), { kind: 'blackout' });
});

test('only the floating Live preview asks for the exemption, and its header shows the BLACKOUT badge', () => {
  const panel = read('src/operator/PreviewPanel.tsx');
  assert.match(panel, /<ProjectorView mirror embedded ignoreBlackout \/>/);
  assert.match(panel, /const blackout = useLive\(\(s\) => s\.state\.projector\.live\.kind === 'blackout'\);/);
  assert.match(panel, /\{badge\.label\}\s*<\/span>\s*\{blackout && \(\s*<span\s+role="status"[\s\S]*?>\s*Blackout\s*<\/span>/, 'the badge sits next to the output pill');
  for (const file of ['src/App.tsx', 'src/output/MirrorWindow.tsx', 'src/golive/console/OutputsCard.tsx', 'src/praise-worship/GoLiveTakeover.tsx']) {
    assert.doesNotMatch(read(file), /ignoreBlackout/, file);
  }
});
