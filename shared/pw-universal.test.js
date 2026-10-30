// Praise & Worship: every card holds songs, prayers and readings together. These tests cover what a card plays, in what order,
// how its runtime adds up, and what each kind of attach does to each kind of card. Run with: node --test shared/pw-universal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, chainOf, runtimeOf, segmentFromTemplate, slidesFor, songsOf, step } from './pw.js';
import { attachItem, attachMany } from './pw-attach.js';

const card = (key) => segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === key));
const HYMN = (id, title) => ({ id, title, category: 'General', stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: `${title} line` }] });
const hymns = [HYMN(1, 'Alpha'), HYMN(2, 'Beta')];
const prayerNote = (title, body) => ({ title, body });
const labelsOf = (slides) => slides.map((s) => (s.kind === 'lyrics' ? `song:${s.hymnTitle}` : s.kind === 'title' ? `title:${s.subtitle || s.label}` : `text:${s.text}`));

test('a song card plays its songs, then the prayer chained after them, then moves on', () => {
  const song = { ...card('marian_song'), content: { kind: 'song', hymnIds: [1, 2], maxSongs: 2, category: null, more: [{ kind: 'prayer', noteId: 9, minutes: 1 }] }, cues: { titleFirst: false, lowerThird: true, fadeOut: false } };
  const resolved = { hymns, more: [{ prayer: prayerNote('After', 'Closing words.') }] };
  const slides = slidesFor(song, resolved);
  assert.deepEqual(labelsOf(slides).filter((l, i, all) => i === 0 || l !== all[i - 1]), ['song:Alpha', 'song:Beta', 'text:Closing words.']);

  const next = { ...card('joyful_song'), cues: { titleFirst: false, lowerThird: true, fadeOut: false } };
  const counts = [slides.length, slidesFor(next, {}).length];
  const seen = [];
  let at = { segment: 0, slide: 0 };
  while (at) {
    seen.push(`${at.segment}:${at.slide}`);
    at = step(counts, at, 1);
  }
  assert.equal(seen.length, slides.length + counts[1], 'Next walks every slide of the card, then the next card, without a skip');
  assert.equal(seen[slides.length - 1], `0:${slides.length - 1}`, 'the last slide of the card comes before the next card');
  assert.equal(seen[slides.length], `1:0`);
});

test('a prayer card plays its prayer, then its songs, then its chain', () => {
  const prayer = { ...card('prayer_authority'), cues: { titleFirst: false, lowerThird: true, fadeOut: false }, content: { kind: 'prayer', noteId: 1, hymnIds: [2], more: [{ kind: 'prayer', noteId: 3, minutes: 0 }] } };
  const resolved = { prayer: prayerNote('First', 'First words.'), hymns: [HYMN(2, 'Beta')], more: [{ prayer: prayerNote('Last', 'Last words.') }] };
  const texts = labelsOf(slidesFor(prayer, resolved));
  assert.deepEqual(texts, ['text:First words.', 'song:Beta', 'text:Last words.']);
});

test('a title card holds songs and a reading chain, in that order, after its title slide', () => {
  const card4 = { ...card('bible_enthronement'), cues: { titleFirst: false, lowerThird: true, fadeOut: false }, content: { kind: 'title', hymnIds: [1], more: [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 0 }] } };
  const resolved = { hymns, more: [{ reading: { citation: 'John 6:63', rawText: 'Spirit and life.' } }] };
  assert.deepEqual(labelsOf(slidesFor(card4, resolved)), ['title:Bible Enthronement', 'song:Alpha', 'text:Spirit and life.']);
});

test('a card with nothing to show keeps its title slide', () => {
  const empty = { ...card('worship'), content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } };
  assert.equal(slidesFor(empty, {}).length, 1);
  assert.equal(slidesFor(empty, {})[0].kind, 'title');
});

test('runtime adds the card’s own minutes to each chained item’s minutes, whatever the card holds', () => {
  const mixed = { ...card('worship'), minutes: 10, content: { kind: 'song', hymnIds: [1, 2], maxSongs: 2, category: null, more: [{ kind: 'prayer', noteId: 1, minutes: 3 }, { kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 2 }] } };
  assert.equal(runtimeOf(mixed), 15);
  assert.equal(runtimeOf({ ...mixed, minutes: 4 }), 9, 'the operator’s own figure can be overridden');
  assert.deepEqual(songsOf(mixed), [1, 2]);
  assert.equal(chainOf(mixed).length, 2);
});

test('a song attaches to a prayer card and a prayer to a song card, without changing either card’s kind', () => {
  const prayerCard = card('prayer_authority');
  const withSong = { ...prayerCard, ...attachItem(prayerCard, { type: 'song', id: 1, title: 'Alpha' }).patch };
  assert.equal(withSong.content.kind, 'prayer');
  assert.deepEqual(songsOf(withSong), [1]);

  const songCard = card('worship');
  const withPrayer = { ...songCard, ...attachItem(songCard, { type: 'prayer', id: 7, title: 'Seven' }).patch };
  assert.equal(withPrayer.content.kind, 'song');
  assert.deepEqual(chainOf(withPrayer).map((x) => x.noteId), [7]);
});

test('a mixed batch of songs, prayers and readings lands on one card, in the order given', () => {
  const result = attachMany(card('bible_enthronement'), [
    { type: 'song', id: 1, title: 'Alpha' },
    { type: 'prayer', id: 5, title: 'Five' },
    { type: 'scripture', id: 'Gospel Acclamation', title: 'Gospel' },
    { type: 'song', id: 2, title: 'Beta' },
  ]);
  assert.equal(result.left, 0);
  assert.deepEqual(songsOf(result.segment), [1, 2]);
  assert.deepEqual(chainOf(result.segment).map((x) => x.kind), ['prayer', 'lectionary']);
  assert.equal(result.segment.content.kind, 'title', 'the title slide stays the first item');
});
