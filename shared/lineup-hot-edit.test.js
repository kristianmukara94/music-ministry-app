// The colour picker's debounced save, and editing the Praise & Worship lineup's songs on air.
// Run with: node --test shared/lineup-hot-edit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDebouncedWriter } from './debounced-writer.js';
import { arrangementWithInsert, findStanzaStep, lyricAt, occurrenceOf } from './pw-hot-edit.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

// ---- The debounced save ----

test('a drag of many steps writes once, 300 ms after the last step, with the last value', () => {
  const clock = fakeClock();
  const writes = [];
  const writer = createDebouncedWriter({ delay: 300, write: (p) => writes.push(p), ...clock });
  for (const c of ['#111111', '#222222', '#333333']) {
    writer.push({ textColor: c });
    clock.advance(100);
  }
  assert.deepEqual(writes, [], 'nothing is written while the picker keeps moving');
  clock.advance(199);
  assert.deepEqual(writes, []);
  clock.advance(1);
  assert.deepEqual(writes, [{ textColor: '#333333' }]);
  clock.advance(1000);
  assert.equal(writes.length, 1, 'and only once');
});

test('patches to different settings are merged into the one write', () => {
  const clock = fakeClock();
  const writes = [];
  const writer = createDebouncedWriter({ delay: 300, write: (p) => writes.push(p), ...clock });
  writer.push({ textColor: '#111111' });
  writer.push({ textOutline: 0.5 });
  clock.advance(300);
  assert.deepEqual(writes, [{ textColor: '#111111', textOutline: 0.5 }]);
});

test('flush writes a waiting change at once, as leaving the page does; with nothing waiting it writes nothing', () => {
  const clock = fakeClock();
  const writes = [];
  const writer = createDebouncedWriter({ delay: 300, write: (p) => writes.push(p), ...clock });
  writer.push({ textColor: '#abcdef' });
  assert.equal(writer.hasPending(), true);
  writer.flush();
  assert.deepEqual(writes, [{ textColor: '#abcdef' }]);
  assert.equal(clock.pending(), 0, 'the timer is gone');
  writer.flush();
  clock.advance(1000);
  assert.equal(writes.length, 1);
});

test('cancel drops a waiting change, so a swatch clicked after a drag is not overwritten by it', () => {
  const clock = fakeClock();
  const writes = [];
  const writer = createDebouncedWriter({ delay: 300, write: (p) => writes.push(p), ...clock });
  writer.push({ textColor: '#123456' });
  writer.cancel();
  clock.advance(1000);
  assert.deepEqual(writes, []);
  assert.equal(writer.hasPending(), false);
});

test('the colour picker shows each step at once and saves through the debounced writer, flushed on leaving', () => {
  const hook = read('src/settings/useInstantSetting.ts');
  assert.match(hook, /export const SETTING_SAVE_DELAY_MS = 300;/);
  assert.match(hook, /dispatch\(\{ type: 'settings\/projector', value: patch \}\);\s+writer\.push\(patch\);/, 'the live state first, the file later');
  assert.match(hook, /window\.addEventListener\('beforeunload', flush\);/);
  assert.match(hook, /return \(\) => \{\s+window\.removeEventListener\('beforeunload', flush\);\s+flush\(\);/, 'unmounting writes what is waiting');
  const panel = read('src/settings/OutputSettingsPanel.tsx');
  assert.match(panel, /onChange=\{\(e\) => colour\.set\(\{ textColor: e\.target\.value \}\)\}/);
  assert.match(panel, /onBlur=\{\(\) => colour\.flush\(\)\}/);
  assert.match(panel, /const pickColour = \(textColor: string \| null\) => \{\s+colour\.cancel\(\);\s+void save\(\{ textColor \}\);/);
  // The live state path writes nothing to disk; only projector:save does.
  const main = read('electron/main.js');
  assert.match(main, /ipcMain\.on\('live:dispatch', \(_event, action\) => apply\(action\)\);/);
  assert.match(main, /ipcMain\.handle\('projector:save', \(_event, patch\) => \{\s+const merged = sanitizeProjectorSettings\(\{ \.\.\.state\.settings, \.\.\.\(patch \?\? \{\}\) \}\);\s+writeConfig/);
});

// ---- The lineup ----

const lyric = (hymnId, sectionId, part = 0) => ({ kind: 'slide', slide: { kind: 'lyrics', hymnId, sectionId: String(sectionId), part, label: 'x', chip: 'x', text: 't', hymnTitle: 'Song' } });
const title = { kind: 'slide', slide: { kind: 'title', label: 'Worship', subtitle: '' } };
// Title, Verse (two pages), Chorus, Verse 2, Chorus again, then the end-of-segment black.
const STEPS = [title, lyric(7, 1), lyric(7, 1, 1), lyric(7, 2), lyric(7, 3), lyric(7, 2), { kind: 'black' }];

test('a lyric slide is found behind its step; a title card or the black step is not one', () => {
  assert.equal(lyricAt(STEPS, 1).sectionId, '1');
  assert.equal(lyricAt(STEPS, 0), null);
  assert.equal(lyricAt(STEPS, 6), null);
  assert.equal(lyricAt(STEPS, 99), null);
});

test('a repeated chorus is told apart by which time it is sung, and a second page belongs to its stanza\'s appearance', () => {
  assert.equal(occurrenceOf(STEPS, 3), 1);
  assert.equal(occurrenceOf(STEPS, 5), 2);
  assert.equal(occurrenceOf(STEPS, 2), 1, 'the verse\'s second page');
  assert.equal(occurrenceOf(STEPS, 0), 0);
});

test('a card in the song\'s own order needs no change: the new stanza already follows in the song', () => {
  const none = {};
  assert.equal(arrangementWithInsert(none, 7, '2', 1, 9), none);
  const other = { 8: ['1', '2'] };
  assert.equal(arrangementWithInsert(other, 7, '2', 1, 9), other, 'another song\'s order is not this song\'s');
});

test('a card with its own order gets the new stanza straight after the right appearance of the slide\'s stanza', () => {
  const arrangement = { 7: ['1', '2', '3', '2'] };
  assert.deepEqual(arrangementWithInsert(arrangement, 7, '2', 1, 9)[7], ['1', '2', '9', '3', '2']);
  assert.deepEqual(arrangementWithInsert(arrangement, 7, '2', 2, 9)[7], ['1', '2', '3', '2', '9']);
  assert.deepEqual(arrangement[7], ['1', '2', '3', '2'], 'the old order is not changed in place');
  assert.deepEqual(arrangementWithInsert(arrangement, 7, '5', 1, 9)[7], ['1', '2', '3', '2', '9'], 'an appearance no longer there puts it at the end');
});

test('the new stanza\'s slide is found from the slide it was added after', () => {
  const after = [...STEPS.slice(0, 4), lyric(7, 9), ...STEPS.slice(4)];
  assert.equal(findStanzaStep(after, 7, 9, 3), 4);
  assert.equal(findStanzaStep(after, 7, 2, 4), 6, 'the chorus after it is its second appearance');
  assert.equal(findStanzaStep(after, 7, 42), null);
});

test('the Live panel wires double-click and the editor; the editor saves through the song and never touches the lineup copy first', () => {
  const view = read('src/praise-worship/LiveView.tsx');
  assert.match(view, /onDoubleClick=\{\(\) => setEditRequest\(i\)\}/);
  assert.match(view, /<LineupHotEdit t=\{t\} segmentIndex=\{segmentIndex\} steps=\{steps\} onAir=\{at\.slide\}/);
  const editor = read('src/praise-worship/LineupHotEdit.tsx');
  assert.match(editor, /useLiveHotEditor\(hymn,/);
  assert.match(editor, /arrangementWithInsert\(segment\.arrangement, hymn\.id, slide\.sectionId, occurrence, added\.id\)/);
  assert.match(editor, /if \(!show\) return;/, 'Add leaves the projector where it is');
  assert.match(editor, /if \(index !== null\) jumpTo\(segmentIndex, index\);/, 'Add and show goes to the new slide');
  // The song watch compares the on-air slide against the lineup's copy, so updating that copy first would hide the change from it.
  assert.doesNotMatch(editor, /withHymn|setState\(\(s\) => \(\{ hymns/);
  assert.match(read('src/live/liveSongs.ts'), /const pwSlide = pwSlideFor\(id\);[\s\S]{0,120}?hymn = await bridge\.lyrics\.getHymn\(id\);/, 'the watch reads the on-air slide before the new song arrives');
});

test('an edited lineup slide on the projector is the same slide: its words change in place with no transition', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /if \(frame\.kind === 'pw' && frame\.slide\.kind === 'lyrics'\) \{\s+return `pw\|\$\{frame\.segmentName\}\|\$\{frame\.index\}\|\$\{frame\.slide\.hymnId\}\|\$\{frame\.slide\.sectionId\}\|\$\{frame\.slide\.part \?\? 0\}`;/);
  const forms = read('src/praise-worship/HotEditForms.tsx');
  assert.match(forms, /if \(e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)\)/);
  assert.match(forms, /e\.key === 'Escape' && !e\.shiftKey/);
  assert.match(read('src/praise-worship/QuickCuePanel.tsx'), /<StanzaEditBox /, 'the Quick Live panel uses the same forms');
});
