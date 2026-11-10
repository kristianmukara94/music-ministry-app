// Song Lyrics Go Live: a setlist stanza goes straight to the projector, every window reads the same song and stanza from the live frame,
// and blackout, clear and a live edit keep the operator's place. Run with: node --test shared/lyrics-live.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';
import { lyricsFrameAfterEdit } from './live-song.js';
import {
  SECONDS_PER_STANZA,
  estimateSongSeconds,
  firstSungStanza,
  formatDuration,
  goLiveNowActions,
  goLiveNowCutsRun,
  goLiveOffActions,
  lyricsOnAir,
  lyricsPositionLabel,
  presentSongStanzaActions,
  sectionChip,
  setlistOnAir,
  setlistStanzaFrame,
} from './lyrics-live.js';

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

// ── GO LIVE NOW: a library song straight to the projector, without a setlist ──

test('GO LIVE NOW projects the first sung stanza as a direct take, with no setlist place, and shows the band', () => {
  const band = { template: 'segment', tag: 'Song', line1: 'Song' };
  const blankFirst = { ...hymn, stanzas: [{ stanzaType: 'Intro', lyricsText: '  ' }, ...hymn.stanzas] };
  const actions = goLiveNowActions({ hymn: blankFirst, band });
  assert.deepEqual(actions.map((a) => a.type), ['projector/stage', 'projector/take', 'lowerThird/show']);
  assert.equal(actions[0].frame.song.position, 1, 'a blank first stanza is skipped');
  assert.equal(actions[0].frame.setlist, undefined, 'the frame carries no setlist place');
  assert.equal(actions[1].source, 'DIRECT_DECK');
  const s = run(projectorOn(), actions);
  assert.equal(s.projector.live.text, 'one');
  assert.deepEqual(s.lowerThird.live, band, 'the band goes up with the song');
  assert.equal(lyricsOnAir(s.projector).setlistId, null);
});

test('GO LIVE NOW only stages the band when the licence is locked, or when the operator switched the lower third off', () => {
  const band = { template: 'segment', tag: 'Song', line1: 'Song' };
  assert.equal(goLiveNowActions({ hymn, band, bandStageOnly: true }).at(-1).type, 'lowerThird/stage');
  const off = run(projectorOn(), [{ type: 'lowerThird/stage', value: band }, { type: 'lowerThird/toggle' }, { type: 'lowerThird/toggle' }]);
  assert.equal(off.lowerThird.choice, 'off');
  const s = run(off, goLiveNowActions({ hymn, band }));
  assert.equal(s.lowerThird.live, null, 'a lower third switched off stays off');
  assert.equal(goLiveNowActions({ hymn }).length, 2, 'no band, no lower-third action');
});

test('GO LIVE NOW sends nothing for a song without words', () => {
  assert.equal(goLiveNowActions({ hymn: { ...hymn, stanzas: [] } }), null);
  assert.equal(goLiveNowActions({ hymn: { ...hymn, stanzas: [{ stanzaType: 'Verse 1', lyricsText: ' \n ' }] } }), null);
});

test('GO LIVE NOW asks twice only when Holy Mass or Praise & Worship holds the projector', () => {
  const base = initialLiveState().projector;
  assert.equal(goLiveNowCutsRun(base), false, 'an idle screen goes at once');
  assert.equal(goLiveNowCutsRun({ ...base, source: 'DIRECT_DECK', live: { kind: 'text', title: 'x', text: 'y', bg: null } }), false, 'a direct slide goes at once');
  assert.equal(goLiveNowCutsRun({ ...base, source: 'MASS_QUEUE', live: { kind: 'text', title: 'x', text: 'y', bg: null } }), true);
  assert.equal(goLiveNowCutsRun({ ...base, source: 'PW_SESSION', live: { kind: 'blackout' }, beforeBlackout: { kind: 'text', title: 'x', text: 'y', bg: null } }), true, 'also behind a blackout');
  assert.equal(goLiveNowCutsRun({ ...base, source: 'MASS_QUEUE', live: { kind: 'idle' } }), false, 'a cleared screen goes at once');
});

test('stanza chips: verses numbered, a plain chorus is C, bridges and outros have their own colour', () => {
  assert.deepEqual(sectionChip('Verse 1'), { label: 'V1', kind: 'Verse' });
  assert.deepEqual(sectionChip('Verse 2'), { label: 'V2', kind: 'Verse' });
  assert.deepEqual(sectionChip('Chorus'), { label: 'C', kind: 'Chorus' });
  assert.deepEqual(sectionChip('Chorus 2'), { label: 'C2', kind: 'Chorus' });
  assert.deepEqual(sectionChip('Bridge'), { label: 'B', kind: 'Bridge' });
  assert.deepEqual(sectionChip('Outro'), { label: 'OUT', kind: 'Outro' });
  assert.deepEqual(sectionChip('Tag'), { label: 'T', kind: 'Tag' });
  assert.deepEqual(sectionChip('Refrain'), { label: 'RE', kind: 'Tag' });
});

test('the setlist running time is a rough guide from the stanza count', () => {
  assert.equal(estimateSongSeconds(0), 0);
  assert.equal(estimateSongSeconds(undefined), 0);
  assert.equal(estimateSongSeconds(5), 5 * SECONDS_PER_STANZA);
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(200), '3:20');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('Song Lyrics GO LIVE NOW reads the session copy and never writes the library', () => {
  const view = read('src/lyrics/SongLyrics.tsx');
  const body = /const handleGoLiveNow = async[\s\S]*?\n  \};\n/.exec(view)?.[0] ?? '';
  assert.ok(body, 'the handler is there');
  assert.match(body, /liveLyrics\.getHymn\(summary\.id\)/, 'the song is read through the session copy');
  assert.match(body, /goLiveNowActions\(/, 'it goes out through the shared actions');
  assert.match(body, /setUi\(\{ lyricsGoLive: true \}\)/, 'Go Live is armed, so the chips go straight out');
  assert.doesNotMatch(body, /\bapi\.|bridge\.lyrics|setStyle|saveSetlist|editLyrics|splitStanza|setLiveStanzas/, 'nothing is written');
  assert.match(view, /onClick=\{\(e\) => void handleGoLiveNow\(h, e\.shiftKey\)\}/, 'every library card has the button');
  assert.match(view, /<LiveOutputCard\b/, 'Live Cues shows what the projector shows');
  assert.match(view, /<LiveStatusBadge\b/, 'the header shows the live status');
});
