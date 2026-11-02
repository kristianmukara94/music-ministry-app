// Go Live from a Library search result: a song goes to the projector without being in the lineup, and the lineup is not touched.
// These read the source (there is no browser here); the reducer rules they lean on are tested in live-song.test.js.
// Run with: node --test shared/quick-live.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer } from './live.js';
import { pwT } from './pw-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const hook = read('src/praise-worship/useQuickLiveController.ts');
const container = read('src/praise-worship/LibrarySearchContainer.tsx');
const card = read('src/praise-worship/SongSearchResultCard.tsx');
const library = read('src/praise-worship/Library.tsx');

test('Go Live shows the first stanza with words as a direct show, and sends nothing for a song without words', () => {
  assert.match(hook, /dispatch\(\{ type: 'projector\/show', frame, source: 'DIRECT_DECK' \}\)/);
  assert.match(hook, /lyricsText\.trim\(\) !== ''/, 'a blank first stanza is skipped');
  assert.match(hook, /if \(!frame\) \{[\s\S]*?return false;/, 'no frame: a notice and no dispatch');
  // Showing a song never writes the lineup's cursor or selected card. Only resuming the lineup does.
  const showing = hook.slice(0, hook.indexOf('const restoreLineup'));
  assert.doesNotMatch(showing, /pw\/cursor|setPwState|updateSegment|commitSegments/);
});

test('a direct show ends the lineup\'s air but leaves the lineup itself alone', () => {
  const s = liveReducer(liveReducer(initialLiveState(), { type: 'output/set', output: 'projector', on: true }), {
    type: 'projector/show',
    frame: { kind: 'lyrics', title: 'Amazing Grace', label: 'Verse 1', text: 'Amazing grace', key: 'song:1', song: { hymnId: 1, position: 0, count: 3 } },
    source: 'DIRECT_DECK',
  });
  assert.equal(s.projector.live.kind, 'lyrics');
  assert.equal(s.projector.live.song.hymnId, 1);
});

test('a click asks twice while another slide is on air; the keyboard and Shift + click do not', () => {
  assert.match(hook, /const needsConfirm = !immediate && somethingLive && liveHymnId !== hymnId;/);
  assert.match(hook, /ARM_MS = 1500/);
  assert.match(card, /onGoLive\(e\.shiftKey\)/);
  assert.match(container, /\(e\.key === 'Enter' && e\.shiftKey\) \|\| \(e\.key === ' '/);
  assert.match(container, /goLive\(row, true\)/);
});

test('the search box takes Ctrl/Cmd + F, ArrowDown, Enter and Shift + Enter', () => {
  assert.match(library, /\(e\.ctrlKey \|\| e\.metaKey\)[\s\S]*?e\.key\.toLowerCase\(\) === 'f'/);
  assert.match(library, /results\.current\?\.focusRow\(0\)/);
  assert.match(library, /e\.shiftKey && row\.hymnId != null/);
});

test('the live song wears a badge and a glow, and only song rows carry a Go Live button', () => {
  assert.match(card, /animate-pulse/);
  assert.match(card, /shadow-\[0_0_14px_rgba\(239,68,68,0\.45\)\]/);
  assert.match(library, /hymnId: h\.id,/);
  assert.equal([...library.matchAll(/^\s+hymnId: /gm)].length, 1, 'prayers and readings have no hymnId, so no Go Live');
});

test('the new labels exist in English and Filipino', () => {
  for (const lang of ['en', 'tl']) {
    for (const key of ['currentlyLive', 'goLiveNow', 'goLiveConfirm', 'onScreen', 'offPlan']) {
      assert.notEqual(pwT(lang, key, { n: 2 }), key, `${lang}.${key}`);
    }
  }
});

test('a song from search parks the lineup\'s place, and resuming puts the same slide back on air', () => {
  const step = (s, ...actions) => actions.reduce((x, a) => liveReducer(x, a), s);
  const lineupFrame = { kind: 'text', title: 'Gloria', text: 'Glory to God', bg: null };
  let s = step(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'pw/load', sessionId: 7 },
    { type: 'projector/show', frame: lineupFrame, source: 'PW_SESSION' },
    { type: 'pw/cursor', segmentKey: 'gloria', slide: 2, now: 1000 },
  );
  assert.equal(s.pw.onAir, true);
  // The song from search is a direct show: the lineup goes off air but keeps its card and slide.
  s = step(s, { type: 'projector/show', frame: { kind: 'lyrics', title: 'Song', label: 'V1', text: 'la', key: 'song:9', song: { hymnId: 9, position: 0, count: 2 } }, source: 'DIRECT_DECK' });
  assert.equal(s.pw.onAir, false);
  assert.equal(s.pw.segmentKey, 'gloria');
  assert.equal(s.pw.slide, 2);
  // Resuming is the lineup's own show plus its cursor at the kept place.
  s = step(s, { type: 'projector/show', frame: lineupFrame, source: 'PW_SESSION' }, { type: 'pw/cursor', segmentKey: 'gloria', slide: 2, now: 2000 });
  assert.equal(s.pw.onAir, true);
  assert.equal(s.pw.liveSince, 1000, 'the session clock is not restarted');
  assert.equal(s.projector.live.title, 'Gloria');
});

test('Space is a character in a text field, and Go Live on a card; the hook checks the window, logs, and can resume', () => {
  assert.match(container, /e\.key === ' ' && !isTextEntry\(e\.target\)/);
  assert.match(read('src/praise-worship/textEntry.ts'), /target\.isContentEditable \|\| \['INPUT', 'TEXTAREA', 'SELECT'\]\.includes\(target\.tagName\)/);
  assert.match(hook, /bridge\.quickLive\.projectorOpen\(\)/);
  assert.match(hook, /if \(windowOpen === false\)/);
  assert.match(hook, /if \(!alreadyLive\) bridge\.quickLive\.logSpontaneous\(\{ songId: hymnId, title: hymn\.title \}\)/);
  assert.match(hook, /const resumeLineup = useCallback/);
});
