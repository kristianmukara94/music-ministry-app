// Song Lyrics setlist tools: the in-setlist filter keeps each row's own number, and the key stepper moves keys by semitones in their
// usual spelling. Run with: node --test shared/setlist-tools.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clampTranspose, filterSetlist, foldText, MAX_TRANSPOSE, parseKey, transposeId, transposeKey, transposeLabel } from './setlist-tools.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const titles = ['Pagbabalik-Loób', 'Here I Am, Lord', 'One More Gift', 'Tanging Yaman', 'Amazing Grace', 'Pananagutan', 'Lift Up Your Hearts', 'Hindi Kita Malilimutan', 'Purihin', 'Ama Namin', 'Be Not Afraid', 'Panalangin', '13 Tribes'];
const entries = titles.map((title, i) => ({ hymnId: i + 1, title, composer: i === 3 ? 'Manoling Francisco, SJ' : '' }));

test('an empty filter shows every row in order, each with its own index', () => {
  const rows = filterSetlist(entries, '   ');
  assert.equal(rows.length, entries.length);
  assert.deepEqual(rows.map((r) => r.index), entries.map((_, i) => i));
});

test('a filtered row keeps its place in the whole setlist', () => {
  const rows = filterSetlist(entries, '13');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry.title, '13 Tribes');
  assert.equal(rows[0].index + 1, 13, 'the 13th song still shows 13');
});

test('matching ignores case and accents, needs every word, and reads the composer', () => {
  assert.deepEqual(filterSetlist(entries, 'loob').map((r) => r.index), [0]);
  assert.deepEqual(filterSetlist(entries, 'PAN').map((r) => r.entry.title), ['Pananagutan', 'Panalangin']);
  assert.deepEqual(filterSetlist(entries, 'here lord').map((r) => r.index), [1]);
  assert.deepEqual(filterSetlist(entries, 'here grace'), []);
  assert.deepEqual(filterSetlist(entries, 'francisco').map((r) => r.entry.title), ['Tanging Yaman']);
  assert.equal(foldText('  Pagbabalik-Loób  '), 'pagbabalik-loob');
});

test('keys are read in the forms the song form offers, and the long forms', () => {
  assert.deepEqual(parseKey('E'), { pitch: 4, minor: false });
  assert.deepEqual(parseKey('Bb'), { pitch: 10, minor: false });
  assert.deepEqual(parseKey('F#m'), { pitch: 6, minor: true });
  assert.deepEqual(parseKey('C minor'), { pitch: 0, minor: true });
  assert.deepEqual(parseKey('D major'), { pitch: 2, minor: false });
  assert.deepEqual(parseKey('Cb'), { pitch: 11, minor: false });
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('Capo 2'), null);
});

test('transposing steps a semitone at a time in the usual spelling', () => {
  assert.equal(transposeKey('E', 0), 'E', 'no shift keeps the key as written');
  assert.equal(transposeKey('E', 1), 'F');
  assert.equal(transposeKey('E', 2), 'F#');
  assert.equal(transposeKey('E', -1), 'Eb');
  assert.equal(transposeKey('C', -1), 'B', 'wraps below C');
  assert.equal(transposeKey('B', 1), 'C', 'wraps above B');
  assert.equal(transposeKey('G', 1), 'Ab');
  assert.equal(transposeKey('Am', 2), 'Bm');
  assert.equal(transposeKey('Em', -2), 'Dm');
  assert.equal(transposeKey('F#m', 2), 'G#m');
  assert.equal(transposeKey('', 3), null, 'a song without a key has nothing to move');
  // Every key in the song form moves twelve steps back to itself.
  for (const key of ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']) {
    assert.deepEqual(parseKey(transposeKey(key, 12)), parseKey(key), key);
    assert.deepEqual(parseKey(transposeKey(transposeKey(key, 5), -5)), parseKey(key), key);
  }
});

test('the shift stays within a fifth either way and labels itself', () => {
  assert.equal(clampTranspose(MAX_TRANSPOSE + 4), MAX_TRANSPOSE);
  assert.equal(clampTranspose(-99), -MAX_TRANSPOSE);
  assert.equal(clampTranspose('x'), 0);
  assert.equal(transposeLabel(2), '+2');
  assert.equal(transposeLabel(-1), '−1');
  assert.equal(transposeLabel(0), '');
  assert.equal(transposeId(4, 9), '4:9');
  assert.equal(transposeId(null, 9), 'none:9');
});

test('Song Lyrics wires the badges, the drag handles, the filter and the key stepper', () => {
  const view = read('src/lyrics/SongLyrics.tsx');
  assert.match(view, /data-hotkey-badge/, 'the stanza chips wear their number keys');
  assert.match(view, /<GripVertical\b/, 'setlist rows have a drag handle');
  assert.match(view, /shownEntries\.map\(\(\{ entry, index: i \}\)/, 'filtered rows keep their own index');
  assert.match(view, /openEntry\(first\.index, 'stage'\)/, 'Enter in the filter stages the first match');
  assert.match(view, /<KeyStepper\b/, 'the Live Cues header has the key stepper');
  assert.match(view, /onDragStart=\{\(\) => \{ dragRef\.current = \{ kind: 'library', hymnId: h\.id \}; \}\}/, 'library songs drag into the setlist');
  assert.match(view, /onDragStart=\{\(\) => \{ dragRef\.current = \{ kind: 'setlist', index: i \}; \}\}/, 'setlist rows drag to reorder');
  const ui = read('src/state/ui.ts');
  const persisted = ui.match(/partialize: \(\{([^}]*)\}\)/)?.[1] ?? '';
  assert.match(persisted, /\blaunchpad\b/, 'the saved operator preferences are listed');
  assert.doesNotMatch(persisted, /\btranspose\b/, 'transpositions are kept for the session only');
});
