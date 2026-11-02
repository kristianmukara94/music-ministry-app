// The "text cut off" warning and Auto-split at midpoint: the split rule, the lineup order after a split, the request that carries a badge
// press to the operator window, and the warning kept off the projector. Run with: node --test shared/stanza-split.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { arrangementWithSplit, splitAtMidpoint } from './pw-hot-edit.js';
import { initialLiveState, liveReducer } from './live.js';
import { parseLyrics, toTaggedLyrics } from './lyrics-parser.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const lines = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1}`).join('\n');

test('a stanza splits at its middle line, the odd line going to the first half', () => {
  assert.deepEqual(splitAtMidpoint(lines(4)), ['Line 1\nLine 2', 'Line 3\nLine 4']);
  assert.deepEqual(splitAtMidpoint(lines(5)), ['Line 1\nLine 2\nLine 3', 'Line 4\nLine 5']);
  assert.deepEqual(splitAtMidpoint(lines(2)), ['Line 1', 'Line 2']);
});

test('a blank line near the middle is where it splits, since the stanza already breaks there', () => {
  assert.deepEqual(splitAtMidpoint('a\nb\n\nc\nd\ne'), ['a\nb', 'c\nd\ne']);
  // A blank line far from the middle is ignored: the halves stay about even.
  assert.deepEqual(splitAtMidpoint('a\n\nb\nc\nd\ne\nf\ng'), ['a\n\nb\nc', 'd\ne\nf\ng']);
});

test('one line, or nothing, cannot be split; blank lines at the edges do not count', () => {
  assert.equal(splitAtMidpoint('Only line'), null);
  assert.equal(splitAtMidpoint('\n\n  \n'), null);
  assert.deepEqual(splitAtMidpoint('\n\nA\nB\n\n'), ['A', 'B']);
});

test('both halves keep the stanza label and read back as two stanzas', () => {
  const tagged = toTaggedLyrics([
    { stanzaType: 'Verse 1', lyricsText: 'One\nTwo' },
    { stanzaType: 'Verse 1', lyricsText: 'Three\nFour' },
  ]);
  assert.deepEqual(parseLyrics(tagged).stanzas.map((s) => s.stanzaType), ['Verse 1', 'Verse 1']);
});

test('a lineup order gets the second half after each appearance of the first, and an order without it is the same object', () => {
  const arrangement = { 7: ['1', '2', '1', '3'] };
  assert.deepEqual(arrangementWithSplit(arrangement, 7, 1, 9)[7], ['1', '9', '2', '1', '9', '3']);
  assert.equal(arrangementWithSplit(arrangement, 7, 5, 9), arrangement);
  assert.equal(arrangementWithSplit({}, 7, 1, 9).hasOwnProperty('7'), false);
});

test('a badge press is a live request that counts presses, so the operator window opens it even from the mirror window', () => {
  let s = liveReducer(initialLiveState(), { type: 'operator/splitStanza', hymnId: 4, position: 2 });
  assert.deepEqual(s.splitRequest, { hymnId: 4, position: 2, seq: 1 });
  s = liveReducer(s, { type: 'operator/splitStanza', hymnId: 4, position: 2 });
  assert.equal(s.splitRequest.seq, 2, 'the same stanza again is a new request');
  assert.equal(liveReducer(s, { type: 'operator/splitStanza', hymnId: 'x', position: 2 }), s, 'a malformed request is ignored');
});

test('the warning is drawn on the mirror and the previews, never on the projector', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /<OnAirLook\.Provider value=\{!props\.mirror\}>/, 'the projector is the audience view; the mirror is not');
  assert.match(view, /export function FramePreview[\s\S]*?<OnAirLook\.Provider value=\{false\}>/, 'previews are operator views');
  assert.match(view, /const audience = useContext\(OnAirLook\);/);
  assert.match(view, /\{!audience && isTruncated && song && <TextCutBadge song=\{song\} \/>\}/);
  assert.match(view, /onClick=\{\(\) => dispatch\(\{ type: 'operator\/splitStanza', hymnId: song\.hymnId, position: song\.position \}\)\}/);
  assert.match(read('src/App.tsx'), /case 'projector':\s+return <ProjectorView \/>;/, 'the projector window renders without mirror');
  const hook = read('src/output/useTextAutoFit.ts');
  assert.match(hook, /const cut = size <= Math\.ceil\(floor\) && text\.scrollHeight > roomHeight \+ 1;/, 'cut off means at the floor and still too tall');
  assert.match(hook, /return \{ isTruncated \};/);
});

test('the badge opens the split in the operator window, and every edit box offers Auto-split', () => {
  assert.match(read('src/operator/OperatorApp.tsx'), /<SplitStanzaDialog \/>/);
  const dialog = read('src/praise-worship/SplitStanzaDialog.tsx');
  assert.match(dialog, /if \(!request \|\| request\.seq <= seen\.current\) return;/, 'requests from before the window opened are not replayed');
  assert.match(dialog, /hot\.startEdit\(open\.position\)/, 'the box opens with the stanza in it');
  const forms = read('src/praise-worship/HotEditForms.tsx');
  assert.match(forms, /disabled=\{hot\.busy \|\| !hot\.canSplit\}/);
  assert.match(read('src/praise-worship/QuickCuePanel.tsx'), /onSplit=\{\(\) => void hot\.commitSplit\(i\)\}/);
  assert.match(read('src/praise-worship/LineupHotEdit.tsx'), /onSplit=\{\(\) => void hot\.commitSplit\(hot\.editing!\.index\)\}/);
  const hot = read('src/praise-worship/useLiveHotEditor.ts');
  assert.match(hot, /const words = editing\?\.index === index \? editing\.text : hymn\.stanzas\[index\]\.lyricsText;/, 'a change typed first is split');
  assert.match(hot, /applySplitToSession\(hymn\.id, result\.firstId, result\.secondId\)/, 'the open lineup keeps the second half too');
  assert.match(read('src/lyrics/SongLyrics.tsx'), /return api\.onChanged\(\(id\) => \{\s+if \(id !== openHymnId\) return;/, 'the Song Lyrics cues follow the split');
});
