// The Secondary port's snapshot carries the frame itself: its kind, its text, and the background behind it. The background names its Media
// Library id, which the TV fetches from the Secondary port. Off, idle and blackout frames carry no text or media. Run with:
// node --test shared/secondary-snapshot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, liveReducer } from './live.js';
import { mediaIdOf, secondaryViewSnapshot } from './remote-view.js';

const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const TEXT = { kind: 'text', title: 'Notice', text: 'Welcome', bg: null };
const on = (frame) => run(initialLiveState(), { type: 'display/mode', value: 'independent' }, { type: 'display/show', frame }, { type: 'display/live', value: true });

test('a library address gives its id, and anything else gives none', () => {
  assert.equal(mediaIdOf('apcc-media://media/21'), '21');
  assert.equal(mediaIdOf('apcc-media://media/21/extra'), null);
  assert.equal(mediaIdOf('/Users/me/Downloads/clip.mp4'), null, 'a path is never a media id');
  assert.equal(mediaIdOf(null), null);
});

test('the secondary snapshot carries its live switch and its frame', () => {
  const snap = secondaryViewSnapshot(on(TEXT), 1);
  assert.equal(snap.live, true);
  assert.equal(snap.frame.kind, 'slide');
  assert.equal(snap.frame.title, 'Notice');
  assert.deepEqual(snap.frame.lines, ['Welcome']);
  assert.equal(snap.frame.mediaId, null, 'a text frame with no background has no media');
});

test('off, idle and blackout frames carry no text and no media', () => {
  const off = secondaryViewSnapshot(initialLiveState(), 1);
  assert.deepEqual([off.live, off.frame.kind, off.frame.lines, off.frame.mediaId], [false, 'off', [], null]);
  assert.equal(secondaryViewSnapshot(on({ kind: 'blackout' }), 1).frame.kind, 'blackout');
  assert.equal(secondaryViewSnapshot(on({ kind: 'idle' }), 1).frame.kind, 'idle');
});

test('a slide carries the Live slide background: its media id, kind, fit, loop and shade', () => {
  let s = run(initialLiveState(), { type: 'display/mode', value: 'independent' });
  s = run(s, { type: 'settings/welcome', value: { slideBackground: { backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/21', videoLoop: false, backgroundFit: 'FIT', textShade: true } } });
  s = run(s, { type: 'display/show', frame: { kind: 'pw', slide: { kind: 'lyrics', label: 'V1', chip: 'V1', text: 'Lord', hymnId: 1, hymnTitle: 'Hymn', sectionId: '1', position: 0, stanzaCount: 1, part: 0, parts: 1, fontPx: 96, top: 0.2, centred: false, align: 'center' }, segmentName: 'Opening', type: 'song', index: 0, total: 1, footer: '' } }, { type: 'display/live', value: true });
  const frame = secondaryViewSnapshot(s, 1).frame;
  assert.equal(frame.mediaId, '21');
  assert.equal(frame.mediaKind, 'video');
  assert.equal(frame.loop, false);
  assert.equal(frame.fit, 'contain');
  assert.equal(frame.shade, true);
});

test('a welcome frame carries the Welcome background, not the Live slide background', () => {
  let s = run(initialLiveState(), { type: 'display/mode', value: 'independent' });
  s = run(s, { type: 'settings/welcome', value: { backgroundType: 'IMAGE', backgroundUrl: 'apcc-media://media/12', slideBackground: { backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/21' } } });
  s = run(s, { type: 'display/show', frame: { kind: 'welcome', lang: 'en' } }, { type: 'display/live', value: true });
  const frame = secondaryViewSnapshot(s, 1).frame;
  assert.equal(frame.kind, 'slide');
  assert.equal(frame.mediaId, '12');
  assert.equal(frame.mediaKind, 'image');
});

test('dual mode: turning Remote live on sends the projector frame and its background to the TV at once', () => {
  let s = run(initialLiveState(), { type: 'settings/welcome', value: { backgroundType: 'IMAGE', backgroundUrl: 'apcc-media://media/12' } });
  s = run(s, { type: 'output/toggle', output: 'projector' }, { type: 'projector/show', frame: { kind: 'welcome', lang: 'en' }, source: 'DIRECT_DECK' });
  assert.equal(s.display.mode, 'dual');
  assert.equal(secondaryViewSnapshot(s, 1).frame.kind, 'off', 'off until Remote live is turned on');
  s = run(s, { type: 'display/live', value: true });
  const frame = secondaryViewSnapshot(s, 1).frame;
  assert.equal(frame.kind, 'slide');
  assert.equal(frame.mediaId, '12', 'the TV gets the background by its library id');
  assert.equal(frame.mediaKind, 'image');
});
