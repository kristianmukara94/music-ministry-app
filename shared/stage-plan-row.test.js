// Tests what the ▷ button on a Holy Mass Planner row puts in the live state: a plain-text response becomes a text slide in the Stage / Preview,
// an operator note is never staged, and the staged row is the one the queue marks CURRENT. The live state is the real reducer.
// Run with: node --test shared/stage-plan-row.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, liveReducer } from './live.js';
import { activeRowIndex, canStageRow, textResponseFrame, textRowActions } from './stage-plan-row.js';

const confess = { module: 'custom', sourceId: 'I confess to almighty God', label: 'I confess to almighty God', slot: 'penitential' };
const apply = (state, actions) => actions.reduce(liveReducer, state);

test('a text response in a slot is staged as a text slide titled with the slot', () => {
  const actions = textRowActions(confess, 3, 'Penitential Act');
  assert.deepEqual(actions, [
    { type: 'queue/cursor', index: 3 },
    { type: 'projector/stage', frame: { kind: 'text', title: 'Penitential Act', text: 'I confess to almighty God', bg: null } },
  ]);
});

test('clicking ▷ puts that slide in the preview state and makes the row CURRENT', () => {
  const start = liveReducer(initialLiveState(), { type: 'queue/set', items: [{}, {}, {}, {}], planId: 9 });
  const next = apply(start, textRowActions(confess, 3, 'Penitential Act'));
  assert.deepEqual(next.projector.staged, textResponseFrame('Penitential Act', 'I confess to almighty God'));
  assert.equal(next.queueCursor, 3);
  assert.equal(activeRowIndex(next, 9), 3);
});

test('another row replaces the staged slide and takes over the marker', () => {
  const start = liveReducer(initialLiveState(), { type: 'queue/set', items: [{}, {}, {}, {}], planId: 9 });
  const first = apply(start, textRowActions(confess, 1, 'Penitential Act'));
  const second = apply(first, textRowActions({ ...confess, sourceId: 'May the Lord accept the sacrifice', label: 'x', slot: 'orate' }, 2, 'Prayer over the Offerings'));
  assert.equal(second.projector.staged.text, 'May the Lord accept the sacrifice');
  assert.equal(second.projector.staged.title, 'Prayer over the Offerings');
  assert.equal(activeRowIndex(second, 9), 2);
});

test('the marker shows only for the plan the queue holds', () => {
  assert.equal(activeRowIndex({ queuePlanId: 9, queueCursor: 2 }, 9), 2);
  assert.equal(activeRowIndex({ queuePlanId: 4, queueCursor: 2 }, 9), null);
  assert.equal(activeRowIndex({ queuePlanId: 9, queueCursor: -1 }, 9), null);
  assert.equal(activeRowIndex({ queuePlanId: 9, queueCursor: 2 }, null), null);
});

test('songs and Mass Order parts are opened in their module, not turned into text', () => {
  assert.equal(textRowActions({ module: 'lyrics', sourceId: '12', label: 'Hymn', slot: 'entrance' }, 0, 'Entrance'), null);
  assert.equal(textRowActions({ module: 'mass_order', sourceId: 'gloria', label: 'Gloria', slot: 'gloria' }, 0, 'Gloria'), null);
  assert.equal(canStageRow({ module: 'lyrics', sourceId: '12', label: 'Hymn', slot: 'entrance' }), true);
});

test('an operator note, a stale row and an empty text are never staged', () => {
  const note = { module: 'custom', sourceId: 'Check the microphones', label: 'Check the microphones', slot: null };
  assert.equal(textRowActions(note, 0, ''), null);
  assert.equal(canStageRow(note), false);
  assert.equal(textRowActions({ ...confess, stale: true }, 0, 'x'), null);
  assert.equal(canStageRow({ ...confess, stale: true }), false);
  assert.equal(textRowActions({ ...confess, sourceId: '  ', label: '' }, 0, 'x'), null);
  assert.equal(canStageRow(confess), true);
});

// ---- A library song row ----
import { lyricsStanzaFrame, mirrorSource, songRowActions } from './stage-plan-row.js';

const hymn = {
  id: 41,
  title: 'MAGBIGAY TAYO SA PANGINOON',
  style: null,
  deletedAt: null,
  stanzas: [
    { stanzaType: 'Verse 1', lyricsText: 'Magbigay tayo sa Panginoon\nng papuri' },
    { stanzaType: 'Refrain', lyricsText: 'Aleluya' },
  ],
};
const songRow = { module: 'lyrics', sourceId: '41', label: 'MAGBIGAY TAYO SA PANGINOON', slot: 'gospel-acclamation' };

test('▷ on a song stages its title and first stanza, and marks the row CURRENT', () => {
  const start = liveReducer(initialLiveState(), { type: 'queue/set', items: [{}, {}, {}, {}, {}], planId: 9 });
  // The Kyrie is what the preview showed before: it is live.
  const kyrie = { kind: 'lyrics', title: 'KYRIE', label: 'Verse 1', text: 'Lord, have mercy.', key: 'song:1' };
  const before = { ...start, projector: { ...start.projector, live: kyrie } };
  const next = apply(before, songRowActions(songRow, 4, hymn));
  assert.equal(next.projector.staged.kind, 'lyrics');
  assert.equal(next.projector.staged.title, 'MAGBIGAY TAYO SA PANGINOON');
  assert.equal(next.projector.staged.text, 'Magbigay tayo sa Panginoon\nng papuri');
  assert.equal(next.projector.staged.label, 'Verse 1');
  assert.deepEqual(next.projector.staged.song, { hymnId: 41, position: 0, count: 2 });
  assert.equal(activeRowIndex(next, 9), 4);
  assert.equal(next.projector.live, kyrie, 'what is on air is not touched');
});

test('the operator preview shows the staged song, but the congregation keeps the live frame', () => {
  const state = apply(initialLiveState(), songRowActions(songRow, 0, hymn));
  const projector = { ...state.projector, live: { kind: 'black' } };
  assert.equal(mirrorSource(projector, { mirror: true, peek: true }).title, 'MAGBIGAY TAYO SA PANGINOON');
  assert.equal(mirrorSource(projector, { mirror: true, peek: false }).kind, 'black', 'not peeking: the preview follows the live output');
  assert.equal(mirrorSource(projector, { mirror: false, peek: true }).kind, 'black', 'the projector never shows a peek');
  assert.equal(mirrorSource({ ...projector, paused: true }, { mirror: true }).title, 'MAGBIGAY TAYO SA PANGINOON', 'paused still shows the staged frame');
});

test('a song that is gone, deleted or empty is not staged, so the caller can say so', () => {
  assert.equal(songRowActions(songRow, 0, null), null);
  assert.equal(songRowActions(songRow, 0, { ...hymn, deletedAt: '2026-01-01' }), null);
  assert.equal(songRowActions(songRow, 0, { ...hymn, stanzas: [] }), null);
  assert.equal(songRowActions({ ...songRow, stale: true }, 0, hymn), null);
  assert.equal(songRowActions({ ...songRow, module: 'mass_order' }, 0, hymn), null);
  assert.equal(lyricsStanzaFrame(hymn, 5), null);
});

// ---- Turning the preview on ----
import { SHOW_STAGED_UI, frameKey, previewBadge } from './stage-plan-row.js';

test('staging a row changes only the stage, the cursor and the operator preview, and opens no window', () => {
  const before = liveReducer(initialLiveState(), { type: 'queue/set', items: [{}, {}, {}, {}, {}], planId: 9 });
  // A window opens only when an output is switched on (electron/main.js reconcileWindows), so the outputs must not move.
  assert.deepEqual(before.outputs, { projector: false, lowerThird: false, preview: false });
  const actions = [...textRowActions(confess, 1, 'Penitential Act'), ...songRowActions(songRow, 4, hymn)];
  assert.ok(actions.every((a) => a.type === 'queue/cursor' || a.type === 'projector/stage'), 'no action switches an output on');
  const after = apply(before, actions);
  assert.deepEqual(after.outputs, before.outputs, 'projectorWindowOpen and the Preview window stay false');
  assert.equal(after.projector.paused, before.projector.paused);
  assert.equal(after.projector.live, before.projector.live, 'nothing goes live');
  assert.equal(after.projector.staged.title, 'MAGBIGAY TAYO SA PANGINOON');
});

test('the operator-window state ▷ sets is the staged peek and the floating panel, and nothing else', () => {
  assert.deepEqual({ ...SHOW_STAGED_UI }, { stagePeek: true, previewOpen: true });
});

test('a staged slide shows the STAGED badge even while the projector is off', () => {
  assert.deepEqual(previewBadge({ projectorOn: false, paused: false, stagePeek: true }), { id: 'staged', label: 'STAGED' });
  assert.equal(previewBadge({ projectorOn: true, paused: false, stagePeek: true }).label, 'STAGED');
  assert.equal(previewBadge({ projectorOn: false, paused: false, stagePeek: false }).label, 'OFF');
  assert.equal(previewBadge({ projectorOn: true, paused: false, stagePeek: false }).label, 'LIVE');
  assert.equal(previewBadge({ projectorOn: true, paused: true, stagePeek: false }).label, 'Projector paused');
});

test('the preview mirror draws the staged slide with the projector off', () => {
  const state = apply(initialLiveState(), textRowActions(confess, 0, 'Penitential Act'));
  assert.equal(state.outputs.projector, false);
  assert.equal(mirrorSource(state.projector, { mirror: true, peek: true }).text, 'I confess to almighty God');
});

test('a state update that carries the same live picture does not look like a change', () => {
  // The state reaches the window as a fresh copy on every update, the one caused by staging included. Only a different picture may end the peek.
  const live = { kind: 'lyrics', title: 'KYRIE', label: 'Verse 1', text: 'Lord, have mercy.', song: { hymnId: 1, position: 0, count: 2 } };
  assert.notEqual(live, JSON.parse(JSON.stringify(live)));
  assert.equal(frameKey(live), frameKey(JSON.parse(JSON.stringify(live))));
  assert.notEqual(frameKey(live), frameKey({ ...live, text: 'Christ, have mercy.' }));
  assert.equal(frameKey(undefined), 'null');
});

test('a long text response becomes a deck of slides, so it is never cut off and its sections can be jumped to', () => {
  const long = Array.from({ length: 30 }, (_, i) => `word${i} of the response`).join(' ');
  const frame = textResponseFrame('I Confess', long);
  assert.equal(frame.kind, 'deck');
  assert.ok(frame.slides.length > 1);
  assert.equal(frame.index, 0);
  assert.equal(frame.labels[0], `I Confess (1/${frame.slides.length})`);
  assert.equal(frame.slides.flat().map((l) => l.text).join(' '), long);
});

test('a text response with paragraphs is one slide per paragraph', () => {
  const frame = textResponseFrame('Prayer of the Faithful', 'For the Church.\nLord, hear our prayer.\n\nFor the sick.\nLord, hear our prayer.');
  assert.equal(frame.kind, 'deck');
  assert.deepEqual(frame.slides.map((s) => s.map((l) => l.text)), [['For the Church.', 'Lord, hear our prayer.'], ['For the sick.', 'Lord, hear our prayer.']]);
  assert.equal(frame.labels, undefined);
});

test('a typed row from the website shows its words, never its internal id', () => {
  for (const sourceId of ['web:s2', 'webref:s20']) {
    const actions = textRowActions({ module: 'custom', sourceId, label: 'Matthew 5:1-12a', slot: 'first_reading' }, 0, 'First Reading');
    assert.equal(actions[1].frame.text, 'Matthew 5:1-12a');
  }
});
