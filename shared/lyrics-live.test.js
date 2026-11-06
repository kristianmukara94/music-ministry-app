// Song Lyrics Go Live: a setlist stanza goes straight to the projector, every window reads the same song and stanza from the live frame,
// and blackout, clear and a live edit keep the operator's place. Run with: node --test shared/lyrics-live.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';
import { lyricsFrameAfterEdit } from './live-song.js';
import { firstSungStanza, goLiveOffActions, lyricsOnAir, lyricsPositionLabel, presentSongStanzaActions, setlistOnAir, setlistStanzaFrame } from './lyrics-live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const hymn = {
  id: 9,
  title: 'Song',
  style: null,
  stanzas: [
    { stanzaType: 'Verse 1', lyricsText: 'one' },
    { stanzaType: 'Chorus', lyricsText: 'chorus' },
    { stanzaType: 'Verse 2', lyricsText: 'two' },
  ],
};
const place = { id: 4, index: 1, count: 5 };
const run = (state, actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const projectorOn = () => liveReducer(initialLiveState(), { type: 'output/set', output: 'projector', on: true });

test('a setlist stanza frame is the plain stanza frame plus where the song sits in the setlist', () => {
  const frame = setlistStanzaFrame(hymn, 1, place);
  assert.equal(frame.kind, 'lyrics');
  assert.equal(frame.text, 'chorus');
  assert.deepEqual(frame.song, { hymnId: 9, position: 1, count: 3 });
  assert.deepEqual(frame.setlist, { id: 4, index: 1, count: 5 });
  assert.equal(setlistStanzaFrame(hymn, 3, place), null, 'no such stanza');
  assert.equal(setlistStanzaFrame(hymn, 0, null).setlist, undefined, 'without a setlist it is the plain frame');
  assert.equal(setlistStanzaFrame(hymn, 0, { id: 4, index: -1, count: 5 }).setlist, undefined, 'a song not in the setlist carries no place');
});

test('presenting a stanza stages and takes it as a direct projection', () => {
  const actions = presentSongStanzaActions({ hymn, stanzaIndex: 0, setlist: place });
  assert.deepEqual(actions.map((a) => a.type), ['projector/stage', 'projector/take']);
  assert.equal(actions[1].source, 'DIRECT_DECK');
  assert.equal(presentSongStanzaActions({ hymn, stanzaIndex: 7, setlist: place }), null, 'nothing is sent for a missing stanza');

  const s = run(projectorOn(), actions);
  assert.equal(s.projector.live.text, 'one');
  assert.equal(s.projector.source, 'DIRECT_DECK');
  assert.deepEqual(lyricsOnAir(s.projector), { hymnId: 9, stanzaIndex: 0, stanzaCount: 3, setlistId: 4, songIndex: 1, songCount: 5, blackout: false });
  assert.equal(setlistOnAir(s.projector, 4), true);
  assert.equal(setlistOnAir(s.projector, 5), false, 'another setlist is not on air');
  assert.equal(lyricsPositionLabel(s.projector), 'Song 2/5 · 1/3');
});

test('switching stanzas moves the on-air stanza; blackout holds it; clear ends it', () => {
  let s = run(projectorOn(), [...presentSongStanzaActions({ hymn, stanzaIndex: 0, setlist: place }), ...presentSongStanzaActions({ hymn, stanzaIndex: 2, setlist: place })]);
  assert.equal(lyricsOnAir(s.projector).stanzaIndex, 2);

  s = liveReducer(s, { type: 'projector/blackout' });
  assert.equal(s.projector.live.kind, 'blackout');
  assert.equal(lyricsOnAir(s.projector).stanzaIndex, 2, 'the place is read from behind the blackout');
  assert.equal(lyricsOnAir(s.projector).blackout, true);
  assert.equal(setlistOnAir(s.projector, 4), true, 'still this setlist, only covered');

  s = liveReducer(s, { type: 'projector/blackout' });
  assert.equal(s.projector.live.text, 'two', 'blackout off puts the same stanza back');

  s = liveReducer(s, { type: 'projector/clear' });
  assert.equal(lyricsOnAir(s.projector), null);
  assert.equal(setlistOnAir(s.projector, 4), false);
  assert.equal(lyricsPositionLabel(s.projector), null);
});

test('a paused projector holds the take', () => {
  const s = run(projectorOn(), [{ type: 'projector/pause', paused: true }, ...presentSongStanzaActions({ hymn, stanzaIndex: 1, setlist: place })]);
  assert.equal(lyricsOnAir(s.projector), null, 'nothing reaches the screen while paused');
  assert.equal(s.projector.staged.text, 'chorus', 'the stanza waits staged');
});

test('a live edit of the song keeps its setlist place', () => {
  const frame = setlistStanzaFrame(hymn, 1, place);
  const edited = { ...hymn, stanzas: hymn.stanzas.map((x, i) => (i === 1 ? { ...x, lyricsText: 'new chorus' } : x)) };
  const after = lyricsFrameAfterEdit(frame, edited);
  assert.equal(after.frame.text, 'new chorus');
  assert.deepEqual(after.frame.setlist, place);
});

test('a song sent from outside a setlist shows only its stanza position', () => {
  const s = run(projectorOn(), presentSongStanzaActions({ hymn, stanzaIndex: 1, setlist: null }));
  assert.equal(lyricsOnAir(s.projector).setlistId, null);
  assert.equal(lyricsPositionLabel(s.projector), '2/3');
});

test('the first sung stanza skips blank stanzas', () => {
  assert.equal(firstSungStanza([{ lyricsText: '  ' }, { lyricsText: 'a' }]), 1);
  assert.equal(firstSungStanza([{ lyricsText: '' }]), 0);
  assert.equal(firstSungStanza([]), 0);
});

test('Go Live off takes the Song Lyrics stanza off the screen', () => {
  let s = run(projectorOn(), presentSongStanzaActions({ hymn, stanzaIndex: 2, setlist: place }));
  const actions = goLiveOffActions(s.projector);
  assert.deepEqual(actions, [{ type: 'projector/clear' }]);
  s = run(s, actions);
  assert.equal(s.projector.live.kind, 'idle', 'the screen is cleared at once');
  assert.equal(lyricsOnAir(s.projector), null);
  assert.equal(setlistOnAir(s.projector, 4), false, 'the ON AIR indicators go out');
  assert.equal(lyricsPositionLabel(s.projector), null);
  assert.deepEqual(goLiveOffActions(s.projector), [], 'nothing more to clear');

  // Going live again later resumes at the same stanza.
  s = run(s, presentSongStanzaActions({ hymn, stanzaIndex: 2, setlist: place }));
  assert.equal(lyricsOnAir(s.projector).stanzaIndex, 2);
});

test('Go Live off clears a stanza held behind a blackout, so lifting the blackout does not bring it back', () => {
  let s = run(projectorOn(), [...presentSongStanzaActions({ hymn, stanzaIndex: 1, setlist: place }), { type: 'projector/blackout' }]);
  s = run(s, goLiveOffActions(s.projector));
  assert.equal(lyricsOnAir(s.projector), null);
  s = liveReducer(s, { type: 'projector/blackout' });
  assert.equal(s.projector.live.kind, 'idle');
});

test('Go Live off leaves the screen alone when Song Lyrics is not what is on it', () => {
  assert.deepEqual(goLiveOffActions(projectorOn().projector), [], 'an idle screen');
  assert.deepEqual(goLiveOffActions(null), []);
  const queue = run(projectorOn(), [{ type: 'projector/stage', frame: setlistStanzaFrame(hymn, 0, null) }, { type: 'projector/take', source: 'MASS_QUEUE' }]);
  assert.deepEqual(goLiveOffActions(queue.projector), [], 'a Mass Queue hymn stays on air');
  const pw = { ...queue.projector, source: 'PW_SESSION' };
  assert.deepEqual(goLiveOffActions(pw), [], 'a Praise & Worship song stays on air');
  const text = run(projectorOn(), [{ type: 'projector/stage', frame: { kind: 'lyrics', text: 'Welcome' } }, { type: 'projector/take' }]);
  assert.equal(text.projector.live.text, 'Welcome');
  assert.deepEqual(goLiveOffActions(text.projector), [], 'nothing that is not a song stanza');
});

test('Song Lyrics wires Go Live: the toggle, direct projection, the quick controls and their keys', () => {
  const view = read('src/lyrics/SongLyrics.tsx');
  assert.match(view, /goLiveOffActions\(/, 'turning Go Live off clears the song from the screen');
  assert.match(view, /onClick=\{toggleGoLive\}/, 'both toggle states go through one handler');
  assert.match(view, /presentSongStanzaActions\(/, 'stanzas go out through the shared present actions');
  assert.match(view, /<LiveQuickControls\b/, 'the quick controls sit in the Live Cues panel');
  assert.match(view, /onDoubleClick=\{\(\) => projectEntry\(i\)\}/, 'a double-clicked setlist song is projected');
  const controls = read('src/lyrics/LiveQuickControls.tsx');
  assert.match(controls, /type: 'projector\/blackout'/);
  assert.match(controls, /type: 'projector\/clear'/);
  assert.match(controls, /type: 'lowerThird\/toggle'/);
  assert.match(controls, /key === 'b'/);
  assert.match(controls, /key === 'c'/);
});
