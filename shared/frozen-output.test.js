// Pausing the projector freezes the audience's picture: the frame on air, the look (font, size, intro, background settings), and any background
// on air. Edits made while paused change only the working state, which the Preview shows. Resume puts the staged frame and background on
// air and brings the look up to date. Run with: node --test shared/frozen-output.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyLook, initialLiveState, liveReducer, outputLookOf } from './live.js';
import { remoteViewSnapshot, secondaryViewSnapshot } from './remote-view.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const DECK = {
  kind: 'deck',
  title: 'Readings',
  slides: [[{ role: 'reader', text: 'First' }], [{ role: 'reader', text: 'Second' }], [{ role: 'reader', text: 'Third' }]],
  index: 0,
};
const MEDIA = { id: 21, src: 'apcc-media://media/21', kind: 'image', fit: 'cover', loop: true };

/** The projector on, showing slide one, the Secondary display on air in dual mode. */
const onAir = () => run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, { type: 'projector/show', frame: DECK, source: 'DIRECT_DECK' }, { type: 'display/live', value: true });

test('pausing freezes the frame on air, and the audience keeps it while the operator steps the working slide', () => {
  let s = onAir();
  s = liveReducer(s, { type: 'projector/pause' });
  const frozen = secondaryViewSnapshot(s, 1).lines;
  assert.deepEqual(frozen, ['First']);
  s = liveReducer(s, { type: 'projector/step', delta: 1 });
  assert.equal(s.projector.staged.index, 1, 'the operator moves the working slide');
  assert.equal(s.projector.live.index, 0, 'the frame on air does not move');
  assert.deepEqual(secondaryViewSnapshot(s, 1).lines, ['First'], 'the TV keeps the frozen slide');
  assert.deepEqual(remoteViewSnapshot(s, 1).lines, ['First'], 'the control viewer shows the frozen slide too');
});

test('resume puts the staged slide on air, and the TV and the phones update at once', () => {
  let s = liveReducer(onAir(), { type: 'projector/pause' });
  s = liveReducer(s, { type: 'projector/step', delta: 1 });
  s = liveReducer(s, { type: 'projector/pause' });
  assert.equal(s.projector.paused, false);
  assert.equal(s.projector.live.index, 1, 'the staged slide is on air');
  assert.deepEqual(secondaryViewSnapshot(s, 1).lines, ['Second']);
});

test('a font or size change while paused reaches the Preview only; the on-air look stays until resume', () => {
  let s = run(onAir(), { type: 'settings/projector', value: { slideFont: 'serif', slideFontScale: 1 } });
  s = liveReducer(s, { type: 'projector/pause' });
  s = run(s, { type: 'settings/projector', value: { slideFont: 'bodoni', slideFontScale: 1.3 } });
  assert.equal(s.settings.slideFont, 'bodoni', 'the working settings change');
  assert.equal(outputLookOf(s).slideFont, 'serif', 'the on-air look is the one captured at the pause');
  assert.equal(applyLook(s).settings.slideFont, 'serif', 'the audience reads the captured font');
  assert.equal(secondaryViewSnapshot(s, 1).frame.font, 'serif', 'the TV keeps its font');
  assert.equal(secondaryViewSnapshot(s, 1).frame.fontScale, 1, 'the TV keeps its size');

  s = liveReducer(s, { type: 'projector/pause' });
  assert.equal(outputLookOf(s).slideFont, 'bodoni', 'resume brings the working look on air');
  assert.equal(secondaryViewSnapshot(s, 1).frame.fontScale, 1.3);
});

test('the intro look changed while paused does not reach the audience until resume', () => {
  const intro = { kind: 'pw', slide: { kind: 'title', label: 'Enthronement', subtitle: '' }, segmentName: 'Opening', type: 'song', index: 0, total: 3, footer: '' };
  let s = run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, { type: 'projector/show', frame: intro, source: 'PW_SESSION' }, { type: 'display/live', value: true });
  s = liveReducer(s, { type: 'projector/pause' });
  s = liveReducer(s, { type: 'introSlide/set', value: 'black' });
  assert.equal(secondaryViewSnapshot(s, 1).frame.kind, 'slide', 'the title card stays on the TV while paused');
  s = liveReducer(s, { type: 'projector/pause' });
  assert.equal(secondaryViewSnapshot(s, 1).frame.kind, 'blackout', 'black is on the TV after resume');
});

test('a background take while paused waits for resume; resume puts the staged background on air', () => {
  let s = onAir();
  s = liveReducer(s, { type: 'background/stage', media: MEDIA });
  s = liveReducer(s, { type: 'projector/pause' });
  s = liveReducer(s, { type: 'background/take' });
  assert.equal(s.projector.background.live, null, 'the audience has no new background while paused');
  assert.equal(s.projector.background.staged, MEDIA, 'the take is staged for resume');
  s = liveReducer(s, { type: 'projector/pause' });
  assert.equal(s.projector.background.live, MEDIA, 'resume puts it on air');
});

test('with the projector not paused, edits go straight on air, as before', () => {
  let s = onAir();
  s = run(s, { type: 'settings/projector', value: { slideFont: 'bodoni' } });
  assert.equal(outputLookOf(s).slideFont, 'bodoni');
  assert.equal(secondaryViewSnapshot(s, 1).frame.font, 'bodoni');
});

test('the Preview shows a paused badge, and the audience picture reads the on-air look', () => {
  assert.match(read('src/operator/PreviewPanel.tsx'), /Projector paused · editing staged/);
  const outputs = read('src/output/outputState.ts');
  assert.match(outputs, /export const OnAirLook = createContext\(false\);/);
  assert.match(outputs, /return select\(audience \? onAir\(state\) : state\);/);
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /<OnAirLook\.Provider value=\{!props\.mirror\}>/, 'the congregation picture reads the on-air look; the mirror does not');
});
