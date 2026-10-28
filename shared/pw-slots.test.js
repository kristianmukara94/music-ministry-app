// Moving and swapping lineup slots, and filling empty song slots from a ticked list. Run with: node --test shared/pw-slots.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, readiness, segmentFromTemplate, segmentStatus } from './pw.js';
import { exchangeSlots, fillEmptySongSlots } from './pw-slots.js';

const lineup = () => DEFAULT_TEMPLATE.groups.flatMap((g) => DEFAULT_TEMPLATE.segments.filter((s) => s.group === g.key)).map(segmentFromTemplate);
const at = (segments, key) => segments.find((s) => s.key === key);
const index = (segments, key) => segments.findIndex((s) => s.key === key);
const withSong = (segments, key, hymnIds, extra = {}) =>
  segments.map((s) => (s.key === key ? { ...s, content: { ...s.content, hymnIds }, type: 'song', ...extra } : s));
const withPrayer = (segments, key, noteId) => segments.map((s) => (s.key === key ? { ...s, content: { kind: 'prayer', noteId } } : s));
const snapshot = (segments) => structuredClone(segments);
const templateMinutes = (key) => DEFAULT_TEMPLATE.segments.find((s) => s.key === key).minutes;

test('multi-add fills the empty song slots in lineup order, with the songs in the order they were ticked', () => {
  const { segments, left } = fillEmptySongSlots(lineup(), [9, 3]);
  assert.deepEqual(at(segments, 'marian_song').content.hymnIds, [9], 'the first tick goes to the first empty slot');
  assert.deepEqual(at(segments, 'joyful_song').content.hymnIds, [3], 'the second tick goes to the next empty slot');
  assert.deepEqual(at(segments, 'worship').content.hymnIds, [], 'the slots after the ticks stay empty');
  assert.deepEqual(left, []);
});

test('multi-add leaves filled slots alone and returns the songs it cannot place', () => {
  const filled = withSong(lineup(), 'marian_song', [7]);
  const { segments, left } = fillEmptySongSlots(filled, [1, 2]);
  assert.deepEqual(at(segments, 'marian_song').content.hymnIds, [7], 'a filled slot is not changed');
  assert.deepEqual(at(segments, 'joyful_song').content.hymnIds, [1]);
  assert.deepEqual(at(segments, 'worship').content.hymnIds, [2], 'the next tick goes to the next empty slot in lineup order, which is Worship');
  assert.deepEqual(left, [], 'the lineup has room for both');
  const full = lineup().map((s) => (s.type === 'song' ? { ...s, content: { ...s.content, hymnIds: [9] } } : s));
  const tight = fillEmptySongSlots(full, [1, 2]);
  assert.deepEqual(tight.left, [1, 2], 'with no empty song slot, every song is returned');
  const more = fillEmptySongSlots(lineup(), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(more.left.length > 0, 'songs beyond the empty slots are returned');
});

test('a swap between two songs keeps each song’s arrangement, minutes and readiness with it', () => {
  let segments = withSong(lineup(), 'joyful_song', [1], { arrangement: { 1: ['2', '1'] }, minutes: 9 });
  segments = withSong(segments, 'repentance', [2], { arrangement: { 2: ['1'] }, minutes: 4 });
  const result = exchangeSlots(segments, index(segments, 'joyful_song'), index(segments, 'repentance'));
  assert.ok(result.segments, 'the swap is allowed');
  const joyful = at(result.segments, 'joyful_song');
  const repentance = at(result.segments, 'repentance');
  assert.deepEqual(joyful.content.hymnIds, [2]);
  assert.deepEqual(joyful.arrangement, { 2: ['1'] }, 'the arrangement moved with song 2');
  assert.equal(joyful.minutes, 4, 'the minutes moved with song 2');
  assert.deepEqual(repentance.content.hymnIds, [1]);
  assert.deepEqual(repentance.arrangement, { 1: ['2', '1'] }, 'the arrangement moved with song 1');
  assert.equal(repentance.minutes, 9);
  assert.equal(segmentStatus(joyful), 'ready');
  assert.equal(segmentStatus(repentance), 'ready');
});

test('a move into an empty slot of the same type leaves the old slot empty', () => {
  const segments = withSong(lineup(), 'joyful_song', [1], { arrangement: { 1: ['1'] }, minutes: 6 });
  const result = exchangeSlots(segments, index(segments, 'joyful_song'), index(segments, 'marian_song'));
  assert.ok(result.segments);
  const marian = at(result.segments, 'marian_song');
  const joyful = at(result.segments, 'joyful_song');
  assert.deepEqual(marian.content.hymnIds, [1]);
  assert.equal(marian.minutes, 6, 'the item brings its minutes');
  assert.deepEqual(marian.arrangement, { 1: ['1'] });
  assert.deepEqual(joyful.content.hymnIds, [], 'the old slot is empty');
  assert.deepEqual(joyful.arrangement, {});
  assert.equal(joyful.minutes, templateMinutes('joyful_song'), 'the empty slot returns to its template minutes');
  assert.equal(segmentStatus(joyful), 'needs_song');
});

test('a prayer can swap with a prayer, and a prayer cannot go into a song slot', () => {
  let segments = withPrayer(lineup(), 'prayer_authority', 11);
  segments = withPrayer(segments, 'consecration_mary', 12);
  const swapped = exchangeSlots(segments, index(segments, 'prayer_authority'), index(segments, 'consecration_mary'));
  assert.equal(at(swapped.segments, 'prayer_authority').content.noteId, 12);
  assert.equal(at(swapped.segments, 'consecration_mary').content.noteId, 11);
  const refused = exchangeSlots(segments, index(segments, 'prayer_authority'), index(segments, 'marian_song'));
  assert.deepEqual(refused, { refused: 'type' });
});

test('a swap or move between different types is refused and changes nothing', () => {
  let segments = withSong(lineup(), 'marian_song', [1]);
  segments = withPrayer(segments, 'prayer_authority', 11);
  const before = snapshot(segments);
  const songToPrayer = exchangeSlots(segments, index(segments, 'marian_song'), index(segments, 'prayer_authority'));
  assert.deepEqual(songToPrayer, { refused: 'type' });
  const titleToSong = exchangeSlots(segments, index(segments, 'bible_enthronement'), index(segments, 'marian_song'));
  assert.deepEqual(titleToSong, { refused: 'type' });
  assert.deepEqual(segments, before, 'nothing changed');
});

test('an empty slot cannot be dragged from', () => {
  const segments = lineup();
  assert.deepEqual(exchangeSlots(segments, index(segments, 'marian_song'), index(segments, 'joyful_song')), { refused: 'empty' });
});

test('a swap keeps the worship limit: a 3-song slot does not go into a 1-song slot', () => {
  let segments = withSong(lineup(), 'worship', [1, 2, 3]);
  segments = withSong(segments, 'joyful_song', [4]);
  const before = snapshot(segments);
  const result = exchangeSlots(segments, index(segments, 'worship'), index(segments, 'joyful_song'));
  assert.deepEqual(result, { refused: 'limit' });
  assert.deepEqual(segments, before, 'nothing changed');
});

test('a 1-song item moves into the empty worship slot, which keeps its own 3-song limit', () => {
  const segments = withSong(lineup(), 'joyful_song', [4]);
  const result = exchangeSlots(segments, index(segments, 'joyful_song'), index(segments, 'worship'));
  assert.ok(result.segments);
  assert.equal(at(result.segments, 'worship').content.maxSongs, 3);
  assert.deepEqual(at(result.segments, 'worship').content.hymnIds, [4]);
  assert.deepEqual(at(result.segments, 'joyful_song').content.hymnIds, []);
});

test('a 2-song worship slot cannot swap with a 1-song slot, since its two songs would not fit there', () => {
  let segments = withSong(lineup(), 'worship', [1, 2]);
  segments = withSong(segments, 'joyful_song', [4]);
  assert.deepEqual(exchangeSlots(segments, index(segments, 'worship'), index(segments, 'joyful_song')), { refused: 'limit' });
});

test('segment 4 still takes a song or the title slide: a reading is refused there, and a song is allowed in', () => {
  const segments = lineup();
  const reading = exchangeSlots(segments, index(segments, 'gospel_acclamation'), index(segments, 'bible_enthronement'));
  assert.deepEqual(reading, { refused: 'segment4' }, 'the reading cannot go into segment 4');
  const title = exchangeSlots(segments, index(segments, 'bible_enthronement'), index(segments, 'gospel_acclamation'));
  assert.deepEqual(title, { refused: 'segment4' }, 'a swap that would put the reading into segment 4 is refused');
  let inFour = withSong(segments, 'bible_enthronement', [5]);
  inFour = withSong(inFour, 'joyful_song', [6]);
  const swapped = exchangeSlots(inFour, index(inFour, 'joyful_song'), index(inFour, 'bible_enthronement'));
  assert.equal(at(swapped.segments, 'bible_enthronement').type, 'song');
  assert.deepEqual(at(swapped.segments, 'bible_enthronement').content.hymnIds, [6]);
  assert.equal(at(swapped.segments, 'bible_enthronement').content.maxSongs, 1, 'segment 4 keeps its one-song limit');
});

test('a swap changes only the two slots, so the readiness totals stay the same', () => {
  let segments = withSong(lineup(), 'joyful_song', [1]);
  segments = withSong(segments, 'repentance', [2]);
  const before = readiness(segments);
  const result = exchangeSlots(segments, index(segments, 'joyful_song'), index(segments, 'repentance'));
  assert.deepEqual(readiness(result.segments), before);
});
