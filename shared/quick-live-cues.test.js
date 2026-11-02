// The cue panel of a song sent from Library search: every stanza listed, the one on air marked, stepping that leaves the lineup alone, and
// keys that never fire while typing. Run with: node --test shared/quick-live-cues.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const hook = read('src/praise-worship/useQuickLiveController.ts');
const container = read('src/praise-worship/LibrarySearchContainer.tsx');
const library = read('src/praise-worship/Library.tsx');
const panel = read('src/praise-worship/QuickCuePanel.tsx');

test('stepping stanzas is a direct show: the lineup keeps its place, and black screen holds the same stanza', () => {
  const frame = (i) => ({ kind: 'lyrics', title: 'Song', label: ['Verse 1', 'Chorus', 'Verse 2'][i], text: `line ${i}`, key: 'song:9', song: { hymnId: 9, position: i, count: 3 } });
  const run = (...actions) => actions.reduce((x, a) => liveReducer(x, a), initialLiveState());
  let s = run(
    { type: 'output/set', output: 'projector', on: true },
    { type: 'pw/load', sessionId: 7 },
    { type: 'projector/show', frame: { kind: 'text', title: 'Gloria', text: 'x', bg: null }, source: 'PW_SESSION' },
    { type: 'pw/cursor', segmentKey: 'gloria', slide: 2, now: 1 },
    { type: 'projector/show', frame: frame(0), source: 'DIRECT_DECK' },
    { type: 'projector/show', frame: frame(1), source: 'DIRECT_DECK' },
    { type: 'projector/show', frame: frame(2), source: 'DIRECT_DECK' },
    { type: 'projector/show', frame: frame(1), source: 'DIRECT_DECK' },
  );
  assert.equal(s.projector.live.song.position, 1);
  assert.deepEqual([s.pw.segmentKey, s.pw.slide], ['gloria', 2]);
  s = liveReducer(s, { type: 'projector/blackout' });
  assert.equal(s.projector.live.kind, 'blackout');
  assert.equal(s.projector.beforeBlackout.song.position, 1);
  s = liveReducer(s, { type: 'projector/blackout' });
  assert.equal(s.projector.live.song.position, 1);
});

test('the panel lists every stanza, marks the one on air, and shows a stanza when it is pressed', () => {
  assert.match(panel, /cue\.stanzas\.map/);
  assert.match(panel, /onAirStanza === i/);
  assert.match(panel, /animate-pulse border-danger/);
  assert.match(panel, /quick\.showStanza\(i\)/);
  assert.match(hook, /setCue\(hymn\);/, 'Go Live loads the song into the panel');
  assert.match(library, /<QuickCuePanel quick=\{quick\} t=\{t\} \/>/);
});

test('the keys step, black out and clear, and ignore typing, the result list, tab lists, buttons (for Space) and dialogs', () => {
  assert.match(hook, /window\.addEventListener\('keydown', onKey, true\)/, 'it listens before the app\'s own Left and Right keys');
  assert.match(hook, /isTextEntry\(target\) \|\| target\?\.closest\('#pw-lib-panel, \[role="tablist"\]'\)/);
  assert.match(hook, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowRight' \|\| \(e\.key === ' ' && !onButton\)/);
  assert.match(hook, /e\.key === 'ArrowUp' \|\| e\.key === 'ArrowLeft'/);
  assert.match(hook, /'projector\/blackout'/);
  assert.match(hook, /'projector\/clear'/);
  assert.match(hook, /\[role="dialog"\], dialog\[open\]/);
});

test('the On screen button brings the panel back into view, and a keyboard Go Live moves focus out of the list', () => {
  assert.match(container, /row\.hymnId === quick\.liveHymnId && !immediate\) quick\.focusCue\(\)/);
  assert.match(container, /e\.currentTarget\.blur\(\)/);
  assert.match(hook, /scrollIntoView\(\{ block: 'nearest'/);
});

test('leaving Quick Live puts the lineup slide back, or clears the screen when there was none', () => {
  const song = { kind: 'lyrics', title: 'Song', label: 'V1', text: 'la', key: 'song:9', song: { hymnId: 9, position: 0, count: 2 } };
  const lineup = { kind: 'text', title: 'Gloria', text: 'x', bg: null };
  const run = (s, ...actions) => actions.reduce((x, a) => liveReducer(x, a), s);
  const on = run(initialLiveState(), { type: 'output/set', output: 'projector', on: true });
  // With a lineup slide parked: its own show replaces the song, with no blank screen between.
  let s = run(on, { type: 'pw/load', sessionId: 7 }, { type: 'projector/show', frame: lineup, source: 'PW_SESSION' }, { type: 'pw/cursor', segmentKey: 'gloria', slide: 2, now: 1 }, { type: 'projector/show', frame: song, source: 'DIRECT_DECK' });
  assert.equal(s.pw.onAir, false);
  s = run(s, { type: 'projector/show', frame: lineup, source: 'PW_SESSION' }, { type: 'pw/cursor', segmentKey: 'gloria', slide: 2, now: 2 });
  assert.equal(s.projector.live.title, 'Gloria');
  assert.equal(s.pw.onAir, true);
  // With no lineup: the song is cleared to a blank screen.
  s = run(on, { type: 'projector/show', frame: song, source: 'DIRECT_DECK' }, { type: 'projector/clear' });
  assert.equal(s.projector.live.kind, 'idle');
  assert.equal(s.pw, null);
});

test('the exit action is one step in the hook, a button in the panel header, and Shift + Escape', () => {
  assert.match(hook, /const exitQuickLiveAndRestore = useCallback/);
  assert.match(hook, /Returned to Lineup: \$\{result\.name\}/);
  assert.match(hook, /if \(songUp\) dispatch\(\{ type: 'projector\/clear' \}\)/, 'only a screen that still shows the song is cleared');
  assert.match(hook, /setCue\(null\);\n  \}, \[restoreLineup, tell\]\);/, 'the cue panel is reset');
  assert.match(hook, /e\.key === 'Escape' && !e\.shiftKey/, 'plain Escape still only clears');
  assert.match(panel, /onClick=\{exit\}/);
  assert.match(panel, /aria-keyshortcuts="Shift\+Escape"/);
  assert.match(panel, /e\.key !== 'Escape' \|\| !e\.shiftKey/);
  assert.match(panel, /if \(!cue\) return null;/);
  assert.ok(panel.indexOf('useEffect(') < panel.indexOf('if (!cue) return null;'), 'the hook runs before the early return');
  assert.match(library, /quick\.toast/);
});
