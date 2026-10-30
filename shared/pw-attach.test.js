// Attaching Library items to a lineup card: songs join the card, prayers and readings chain, and nothing is refused for want of an
// empty slot. The Add button, "Add selected" and a drop all use these functions. Run with: node --test shared/pw-attach.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, MAX_CHAIN, MAX_SONGS, chainOf, segmentFromTemplate } from './pw.js';
import { attachItem, attachItems, attachMany, describeAttach, parseDrag } from './pw-attach.js';

const card = (key) => segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === key));
const song = (id) => ({ type: 'song', id, title: `Song ${id}` });
const prayer = (id) => ({ type: 'prayer', id, title: `Prayer ${id}` });
const reading = (id) => ({ type: 'scripture', id, title: id });
const apply = (segment, drag) => {
  const result = attachItem(segment, drag);
  assert.ok(!('refused' in result), `refused: ${result.refused}`);
  return { ...segment, ...result.patch };
};

test('a song joins a card that already has one: no empty slot is needed', () => {
  let marian = card('marian_song');
  marian = apply(marian, song(1));
  marian = apply(marian, song(2));
  assert.deepEqual(marian.content.hymnIds, [1, 2]);
  // The card's own limit rose to fit what it holds, so the server accepts it.
  assert.equal(marian.content.maxSongs, 2);
});

test('a card takes songs up to the limit and then says it is full', () => {
  let worship = card('worship');
  for (let id = 1; id <= MAX_SONGS; id += 1) worship = apply(worship, song(id));
  assert.equal(worship.content.hymnIds.length, MAX_SONGS);
  assert.deepEqual(attachItem(worship, song(99)), { refused: 'full' });
});

test('a song already on the card is not added twice, and a song joins a prayer card too', () => {
  const marian = apply(card('marian_song'), song(1));
  assert.deepEqual(attachItem(marian, song(1)), { refused: 'present' });
  assert.deepEqual(apply(card('prayer_authority'), song(1)).content.hymnIds, [1]);
});

test('a prayer fills an empty prayer card, and the next ones chain after it', () => {
  let opening = card('prayer_authority');
  const first = attachItem(opening, prayer(1));
  assert.equal(first.mode, 'added');
  opening = { ...opening, ...first.patch };
  const second = attachItem(opening, prayer(2));
  assert.equal(second.mode, 'chained');
  opening = { ...opening, ...second.patch };
  assert.equal(opening.content.noteId, 1);
  assert.deepEqual(chainOf(opening).map((x) => x.noteId), [2]);
});

test('a prayer card takes a chain up to the limit, and refuses repeats and songs', () => {
  let opening = apply(card('prayer_authority'), prayer(1));
  for (let id = 2; id <= MAX_CHAIN + 1; id += 1) opening = apply(opening, prayer(id));
  assert.equal(chainOf(opening).length, MAX_CHAIN);
  assert.deepEqual(attachItem(opening, prayer(100)), { refused: 'full' });
  assert.deepEqual(attachItem(opening, prayer(1)), { refused: 'present' });
  assert.deepEqual(attachItem(opening, prayer(3)), { refused: 'present' });
});

test('a reading fills a title-only scripture card, and the next one chains', () => {
  let enthronement = card('bible_enthronement');
  const first = attachItem(enthronement, reading('Gospel Acclamation'));
  assert.equal(first.mode, 'added');
  enthronement = { ...enthronement, ...first.patch };
  assert.equal(enthronement.content.kind, 'lectionary');
  const second = attachItem(enthronement, reading('Second Reading'));
  assert.equal(second.mode, 'chained');
  assert.deepEqual(attachItem(enthronement, reading('Gospel Acclamation')), { refused: 'present' });
});

test('the title slide replaces the first item and keeps the chain', () => {
  let enthronement = apply(card('bible_enthronement'), reading('Gospel Acclamation'));
  enthronement = apply(enthronement, reading('Second Reading'));
  const titled = apply(enthronement, reading('title'));
  assert.equal(titled.content.kind, 'title');
  assert.deepEqual(chainOf(titled).map((x) => x.readingType), ['Second Reading']);
});

test('garbage from a drag is refused, not applied', () => {
  const marian = card('marian_song');
  assert.deepEqual(attachItem(marian, null), { refused: 'type' });
  assert.deepEqual(attachItem(marian, { type: 'video', id: 1 }), { refused: 'type' });
  assert.deepEqual(attachItem(marian, { type: 'song', id: 'abc' }), { refused: 'type' });
  assert.deepEqual(attachItem(card('prayer_authority'), { type: 'prayer', id: '' }), { refused: 'type' });
  assert.deepEqual(attachItem(card('bible_enthronement'), { type: 'scripture', id: 'x'.repeat(41) }), { refused: 'type' });
});

test('adding several ticked items to one card attaches every one that fits, and counts the rest', () => {
  const result = attachMany(card('prayer_authority'), [prayer(1), prayer(2), prayer(2), prayer(3)]);
  assert.equal(result.added, 1);
  assert.equal(result.chained, 2);
  assert.equal(result.present, 1);
  assert.equal(result.left, 0);
  const songs = attachMany(card('marian_song'), [1, 2, 3, 4, 5, 6, 7, 8].map(song));
  assert.deepEqual(songs.segment.content.hymnIds, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(songs.added, 8);
  assert.equal(songs.left, 0);
});

test('the report names the card and says what happened', () => {
  assert.equal(describeAttach('Marian Song', 'song', { added: 1, chained: 0, present: 0, left: 0 }), 'Added 1 song to Marian Song.');
  assert.equal(describeAttach('Opening', 'prayer', { added: 0, chained: 1, present: 0, left: 0 }), 'Chained 1 prayer to Opening.');
  assert.equal(describeAttach('Opening', 'prayer', { added: 1, chained: 2, present: 0, left: 0 }), 'Added 1 prayer and chained 2 prayers to Opening.');
  assert.equal(describeAttach('Worship', 'song', { added: 2, chained: 0, present: 1, left: 3 }), 'Added 2 songs to Worship. 1 already in Worship. 3 not added: Worship is full or cannot take them.');
});

test('the lineup rail takes drops on every card through attachItem', () => {
  const rail = readFileSync(fileURLToPath(new URL('../src/praise-worship/LineupRail.tsx', import.meta.url)), 'utf8');
  for (const hook of ['onDragOver=', 'onDragEnter=', 'onDragLeave=', 'onDrop=', "getData('application/json')", 'attachItems(segment, batch)', 'dragOverSegmentKey']) {
    assert.ok(rail.includes(hook), `LineupRail.tsx has ${hook}`);
  }
});

test('a batch payload is read as its items, in order, and the single form still works', () => {
  const batch = parseDrag(JSON.stringify({ type: 'song', items: [{ id: 3, title: 'C' }, { id: 1, title: 'A' }, { id: 2, title: 'B' }] }));
  assert.deepEqual(batch, { type: 'song', items: [{ id: 3, title: 'C' }, { id: 1, title: 'A' }, { id: 2, title: 'B' }] });
  assert.deepEqual(parseDrag({ type: 'prayer', id: 9, title: 'Nine' }), { type: 'prayer', items: [{ id: 9, title: 'Nine' }] });
});

test('a payload that is not a Library drag is not read as one', () => {
  assert.equal(parseDrag('not json'), null);
  assert.equal(parseDrag(null), null);
  assert.equal(parseDrag({ type: 'video', items: [{ id: 1 }] }), null);
  assert.equal(parseDrag({ type: 'song', items: [] }), null);
  assert.equal(parseDrag({ type: 'song', items: [null, 4, { title: 'no id' }] }), null);
  // A nested row's drag inside a card carries its place in the card, and is never a Library item.
  assert.equal(parseDrag({ sourceSegmentKey: 'worship', sourceIndex: 1, itemType: 'song', type: 'song', id: 1 }), null);
});

test('a drag cannot carry more items than the limit', () => {
  const items = Array.from({ length: 500 }, (_, id) => ({ id, title: String(id) }));
  assert.equal(parseDrag({ type: 'song', items }).items.length, 200);
});

test('a batch of songs lands on one card at once, in the order dragged, and repeats are skipped', () => {
  const batch = parseDrag({ type: 'song', items: [{ id: 3, title: 'C' }, { id: 1, title: 'A' }, { id: 3, title: 'C again' }, { id: 2, title: 'B' }] });
  const result = attachItems(card('worship'), batch);
  assert.deepEqual(result.segment.content.hymnIds, [3, 1, 2]);
  assert.equal(result.added, 3);
  assert.equal(result.present, 1);
});

test('a batch of prayers fills an empty prayer card and chains the rest after it, in order', () => {
  const result = attachItems(card('prayer_authority'), { type: 'prayer', items: [{ id: 5, title: 'Five' }, { id: 6, title: 'Six' }, { id: 7, title: 'Seven' }] });
  assert.equal(result.segment.content.noteId, 5);
  assert.deepEqual(chainOf(result.segment).map((x) => x.noteId), [6, 7]);
  assert.equal(result.added, 1);
  assert.equal(result.chained, 2);
});

test('a batch that attaches nothing hands back the same card', () => {
  const marian = apply(card('marian_song'), song(1));
  const result = attachItems(marian, { type: 'song', items: [{ id: 1, title: 'A' }] });
  assert.equal(result.segment, marian);
  assert.equal(result.present, 1);
});

test('the Library drags its whole selection, and the rail highlights one card by its key', () => {
  const library = readFileSync(fileURLToPath(new URL('../src/praise-worship/Library.tsx', import.meta.url)), 'utf8');
  const rail = readFileSync(fileURLToPath(new URL('../src/praise-worship/LineupRail.tsx', import.meta.url)), 'utf8');
  assert.match(library, /rows\.filter\(\(r\) => r\.drag && ticked\.includes\(r\.key\)\)/, 'a selected card drags every selected row');
  assert.match(library, /items: dragged\.flatMap/, 'the payload carries the items as an array');
  assert.match(rail, /parseDrag\(data\.getData\('application\/json'\)\)/, 'a drop reads the payload through parseDrag');
  assert.match(rail, /setDragOverSegmentKey\(\(now\) => \(now === segment\.key \? null : now\)\)/, 'leaving a card clears only its own highlight');
  assert.match(rail, /const dropHere = dragOverSegmentKey === segment\.key/, 'only the card under the pointer is highlighted');
});
