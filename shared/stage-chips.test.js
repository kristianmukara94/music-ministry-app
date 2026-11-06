// Jump to section chips: sub-indexed labels and their keys. Run with: node --test shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipForKey, hotkeyChips, subIndexChip } from './stage-chips.js';
import { slidesFor, segmentFromTemplate, DEFAULT_TEMPLATE } from './pw.js';

test('a stanza over several slides is labelled V1.1, V1.2; a one-slide stanza keeps its label', () => {
  assert.equal(subIndexChip('V1', 0, 1), 'V1');
  assert.equal(subIndexChip('V1'), 'V1');
  assert.equal(subIndexChip('V1', 0, 2), 'V1.1');
  assert.equal(subIndexChip('V1', 1, 2), 'V1.2');
  assert.equal(subIndexChip('C', 2, 3), 'C.3');
});

test('a long stanza in a lineup gets sub-indexed chips with no duplicates', () => {
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.type === 'song')), content: { kind: 'song', hymnIds: [1] } };
  segment.cues = { ...segment.cues, titleFirst: false };
  const long = Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of a verse long enough to run over more than one slide`).join('\n');
  const hymn = { id: 1, title: 'Song', stanzas: [{ id: 10, stanzaType: 'Verse 1', lyricsText: long }, { id: 11, stanzaType: 'Chorus', lyricsText: 'Short chorus' }] };
  const slides = slidesFor(segment, { hymns: [hymn] }).filter((s) => s.kind === 'lyrics');
  const labels = slides.map((s) => subIndexChip(s.chip, s.part, s.parts));
  assert.ok(slides[0].parts > 1, 'the verse runs over more than one slide');
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(labels.slice(0, 2), ['V1.1', 'V1.2']);
  assert.equal(labels.at(-1), 'C');
});

const chip = (index, label, hotkey) => ({ index, label, ...(hotkey === false ? { hotkey } : {}) });
// A song: its title card, V1 over two slides, C, V2, C again, V3 over three slides.
const song = [
  { chips: [chip(0, 'T', false)] },
  { chips: [chip(1, 'V1.1'), chip(2, 'V1.2'), chip(3, 'C'), chip(4, 'V2'), chip(5, 'C'), chip(6, 'V3.1'), chip(7, 'V3.2'), chip(8, 'V3.3')] },
];

test('number keys skip the title card and stop at nine', () => {
  assert.deepEqual(hotkeyChips(song).map((c) => c.label), ['V1.1', 'V1.2', 'C', 'V2', 'C', 'V3.1', 'V3.2', 'V3.3']);
  assert.equal(chipForKey(song, '1', 0), 1);
  assert.equal(chipForKey(song, '3', 0), 3);
  assert.equal(chipForKey(song, '9', 0), null);
  const deck = [{ chips: Array.from({ length: 12 }, (_, i) => chip(i, String(i + 1))) }];
  assert.equal(hotkeyChips(deck).length, 9);
  assert.equal(chipForKey(deck, '9', 0), 8);
  assert.equal(chipForKey(deck, '0', 0), null);
});

test('C jumps to the first chorus', () => {
  assert.equal(chipForKey(song, 'C', 7), 3);
  assert.equal(chipForKey(song, 'c', 0), 3);
  assert.equal(chipForKey([{ chips: [chip(0, 'V1'), chip(1, 'V2')] }], 'C', 0), null);
});

test('V steps to the next verse, skipping the pages of the verse on screen, and wraps', () => {
  assert.equal(chipForKey(song, 'V', 0), 1);
  assert.equal(chipForKey(song, 'V', 1), 4);
  assert.equal(chipForKey(song, 'V', 2), 4);
  assert.equal(chipForKey(song, 'V', 4), 6);
  assert.equal(chipForKey(song, 'V', 7), 1);
  assert.equal(chipForKey(song, 'v', -1), 1);
});

test('C and V keep to the song on screen when a card has two', () => {
  const two = [
    { chips: [chip(0, 'V1'), chip(1, 'C')] },
    { chips: [chip(2, 'V1'), chip(3, 'C'), chip(4, 'V2')] },
  ];
  assert.equal(chipForKey(two, 'C', 2), 3);
  assert.equal(chipForKey(two, 'V', 3), 4);
  assert.equal(chipForKey(two, 'V', 4), 2);
  assert.equal(chipForKey(two, 'C', 0), 1);
});

test('other keys jump nowhere', () => {
  assert.equal(chipForKey(song, 'B', 0), null);
  assert.equal(chipForKey(song, 'Enter', 0), null);
});
