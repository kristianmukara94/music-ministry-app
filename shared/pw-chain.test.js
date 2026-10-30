// Praise & Worship: chained items on prayer and scripture cards, card runtimes, and adding and removing cards.
// Run with: node --test shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLineupCard,
  chainAssignment,
  chainOf,
  DEFAULT_TEMPLATE,
  groupMinutes,
  holdsItem,
  MAX_CHAIN,
  MAX_SEGMENTS,
  moveChainItem,
  moveItem,
  moveSong,
  reorderChainItem,
  reorderSong,
  newLineupCard,
  removeChainItem,
  removeLineupCard,
  removeSong,
  runtimeOf,
  segmentFromTemplate,
  shiftItem,
  slidesFor,
  step,
  totalMinutes,
  withChain,
} from './pw.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exchangeSlots } from './pw-slots.js';

const groups = DEFAULT_TEMPLATE.groups;
const lineup = () => DEFAULT_TEMPLATE.groups.flatMap((g) => DEFAULT_TEMPLATE.segments.filter((s) => s.group === g.key)).map(segmentFromTemplate);
const prayer = (over = {}) => ({ ...segmentFromTemplate(DEFAULT_TEMPLATE.segments[0]), ...over });
const prayerNote = (title, body) => ({ title, body });

/** A prayer card with a first prayer and two chained prayers, every one of them with its text loaded. */
function chainedPrayerCard(cues = {}) {
  const segment = prayer({
    cues: { titleFirst: false, lowerThird: true, fadeOut: false, ...cues },
    content: {
      kind: 'prayer',
      noteId: 1,
      more: [
        { kind: 'prayer', noteId: 2, minutes: 2 },
        { kind: 'prayer', noteId: 3, minutes: 1 },
      ],
    },
  });
  const resolved = {
    prayer: prayerNote('First', 'One line of the first prayer.'),
    more: [{ prayer: prayerNote('Second', 'Second prayer text.') }, { prayer: prayerNote('Third', 'Third prayer text.') }],
  };
  return { segment, resolved };
}

test('a chained prayer follows the first one, in order, on the same card', () => {
  const { segment, resolved } = chainedPrayerCard();
  const slides = slidesFor(segment, resolved);
  assert.deepEqual(
    slides.map((s) => s.text),
    ['One line of the first prayer.', 'Second prayer text.', 'Third prayer text.'],
  );
  // Every slide keeps the card's name, so the projector and the operator see one card.
  assert.ok(slides.every((s) => s.label === segment.name));
});

test('each chained prayer starts on its own title slide when the card opens with titles', () => {
  const { segment, resolved } = chainedPrayerCard({ titleFirst: true });
  const slides = slidesFor(segment, resolved);
  const titles = slides.filter((s) => s.kind === 'title').map((s) => s.subtitle);
  // The first prayer's title slide, then one for each chained prayer, named after the prayer.
  assert.deepEqual(titles, ['', 'Second', 'Third']);
  assert.equal(slides[0].kind, 'title');
});

test('a chained prayer whose text is missing shows the placeholder, and the rest still play', () => {
  const { segment, resolved } = chainedPrayerCard();
  resolved.more[0] = { prayer: null };
  const slides = slidesFor(segment, resolved);
  assert.equal(slides[1].placeholder, true);
  assert.equal(slides[2].text, 'Third prayer text.');
});

test('next walks through every chained item in a card before moving to the next card', () => {
  const { segment, resolved } = chainedPrayerCard();
  const next = { ...prayer({ key: 'next', name: 'Next card' }), content: { kind: 'prayer', noteId: null, more: [] } };
  const counts = [slidesFor(segment, resolved).length, slidesFor(next, {}).length];
  const seen = [];
  let at = { segment: 0, slide: 0 };
  while (at) {
    seen.push(`${at.segment}:${at.slide}`);
    at = step(counts, at, 1);
  }
  // Three chained prayers are three slides, all in card 0, before card 1 starts. Card 1 opens on its title slide, then its placeholder.
  assert.deepEqual(seen, ['0:0', '0:1', '0:2', '1:0', '1:1']);
});

test('back walks the chain in reverse and crosses into the previous card at its last item', () => {
  const { segment, resolved } = chainedPrayerCard();
  const counts = [slidesFor(segment, resolved).length, 1];
  assert.deepEqual(step(counts, { segment: 1, slide: 0 }, -1), { segment: 0, slide: 2 });
  assert.deepEqual(step(counts, { segment: 0, slide: 2 }, -1), { segment: 0, slide: 1 });
});

test('a chained reading follows a title slide on a scripture card', () => {
  const card = prayer({
    key: 'bible_enthronement',
    type: 'scripture',
    content: { kind: 'title', more: [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 0 }] },
  });
  const resolved = { more: [{ reading: { citation: 'John 6:63', rawText: 'Your words are spirit and life.' } }] };
  const slides = slidesFor(card, resolved);
  assert.equal(slides[0].kind, 'title');
  assert.equal(slides.at(-1).text, 'Your words are spirit and life.');
});

test('a card with no chain is unchanged: the first item alone', () => {
  const segment = prayer({ cues: { titleFirst: false, lowerThird: true, fadeOut: false }, content: { kind: 'prayer', noteId: 1 } });
  assert.equal(slidesFor(segment, { prayer: prayerNote('Only', 'Only prayer.') }).length, 1);
  assert.deepEqual(chainOf(segment), []);
});

test('a card runtime is its own minutes plus each chained item, and a manual override is kept', () => {
  const { segment } = chainedPrayerCard();
  // The card's own 3 minutes, plus 2 and 1 from the chain.
  assert.equal(runtimeOf(segment), 6);
  // An override of the card's own minutes changes only that part.
  assert.equal(runtimeOf({ ...segment, minutes: 10 }), 13);
});

test('totals and group totals include chained items', () => {
  const segments = lineup();
  const first = segments[0];
  const withItems = { ...first, content: { ...first.content, more: [{ kind: 'prayer', noteId: 9, minutes: 4 }] } };
  const changed = [withItems, ...segments.slice(1)];
  assert.equal(totalMinutes(changed) - totalMinutes(segments), 4);
  assert.equal(groupMinutes(changed, 'opening') - groupMinutes(segments, 'opening'), 4);
});

test('every card chains prayers and readings, whatever its first item is', () => {
  const song = lineup().find((s) => s.key === 'worship');
  assert.ok(chainAssignment(song, { kind: 'prayer', noteId: 5, minutes: 0 }));
  assert.ok(chainAssignment(prayer(), { kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 0 }));
});

test('a chained prayer is added to the card, once, and only up to the limit', () => {
  const segment = prayer({ content: { kind: 'prayer', noteId: 1 } });
  const patch = chainAssignment(segment, { kind: 'prayer', noteId: 2, minutes: 0 });
  assert.ok(patch);
  const chained = { ...segment, ...patch };
  assert.equal(chainOf(chained).length, 1);
  // The first prayer is never added again as a chain item.
  assert.equal(chainAssignment(chained, { kind: 'prayer', noteId: 1, minutes: 0 }), null);
  assert.equal(holdsItem(chained, { kind: 'prayer', noteId: 2, minutes: 0 }), true);
  // A full card takes no more.
  let full = { ...chained, content: { kind: 'prayer', noteId: 1, more: Array.from({ length: MAX_CHAIN }, (_, n) => ({ kind: 'prayer', noteId: 100 + n, minutes: 0 })) } };
  assert.equal(chainAssignment(full, { kind: 'prayer', noteId: 50, minutes: 0 }), null);
});

test('shiftItem moves an item and leaves the list alone at either end', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(shiftItem(list, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(shiftItem(list, 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(shiftItem(list, 0, -1), list);
  assert.deepEqual(shiftItem(list, 2, 1), list);
});

test('withChain replaces only the chain of a card', () => {
  const { segment } = chainedPrayerCard();
  const next = { ...segment, ...withChain(segment, []) };
  assert.deepEqual(chainOf(next), []);
  assert.equal(next.content.noteId, 1);
});

test('swapping a card first item keeps each card its own chain', () => {
  const segments = lineup();
  const a = segments.findIndex((s) => s.key === 'prayer_authority');
  const b = segments.findIndex((s) => s.key === 'consecration_mary');
  const withPrayers = segments.map((s, i) => {
    if (i === a) return { ...s, content: { kind: 'prayer', noteId: 1, more: [{ kind: 'prayer', noteId: 10, minutes: 0 }] } };
    if (i === b) return { ...s, content: { kind: 'prayer', noteId: 2, more: [{ kind: 'prayer', noteId: 20, minutes: 0 }] } };
    return s;
  });
  const result = exchangeSlots(withPrayers, a, b);
  assert.ok(result.segments);
  assert.equal(result.segments[a].content.noteId, 2);
  assert.deepEqual(chainOf(result.segments[a]).map((x) => x.noteId), [10]);
  assert.deepEqual(chainOf(result.segments[b]).map((x) => x.noteId), [20]);
});

test('adding a card puts it straight after the selected card, in the same group', () => {
  const segments = lineup();
  const card = newLineupCard({ key: 'custom_test', name: 'New card', type: 'prayer' });
  const { segments: next, index } = addLineupCard(segments, groups, 1, card);
  assert.equal(index, 2);
  assert.equal(next[2].key, 'custom_test');
  assert.equal(next[2].group, next[1].group);
  assert.equal(next.length, segments.length + 1);
});

test('a card added with nothing selected goes to the top of the first group', () => {
  const card = newLineupCard({ key: 'custom_top', name: 'Top', type: 'song' });
  const { segments, index } = addLineupCard([], groups, -1, card);
  assert.equal(index, 0);
  assert.equal(segments[0].group, 'opening');
  assert.deepEqual(segments[0].content, { kind: 'song', hymnIds: [], maxSongs: 1, category: null, more: [] });
});

test('a card key that is already in the lineup is refused, and so is a full lineup', () => {
  const segments = lineup();
  assert.throws(() => addLineupCard(segments, groups, 0, newLineupCard({ key: 'worship', name: 'Dup', type: 'song' })), /own key/);
  const full = Array.from({ length: MAX_SEGMENTS }, (_, n) => ({ ...newLineupCard({ key: `card_${n}`, name: `Card ${n}`, type: 'song' }), group: 'opening' }));
  assert.throws(() => addLineupCard(full, groups, 0, newLineupCard({ key: 'one_more', name: 'More', type: 'song' })), /at most/);
});

test('removing a card keeps the selection on the card that takes its place', () => {
  const segments = lineup();
  const middle = removeLineupCard(segments, groups, 2);
  assert.equal(middle.segments.length, segments.length - 1);
  assert.ok(!middle.segments.some((s) => s.key === segments[2].key));
  assert.equal(middle.index, 2);
  const last = removeLineupCard(segments, groups, segments.length - 1);
  assert.equal(last.index, segments.length - 2);
});

test('a new card of each type starts empty and holds the right slot', () => {
  assert.equal(newLineupCard({ key: 'a', name: 'A', type: 'prayer' }).content.kind, 'prayer');
  assert.equal(newLineupCard({ key: 'b', name: 'B', type: 'song' }).content.kind, 'song');
  assert.equal(newLineupCard({ key: 'c', name: 'C', type: 'scripture' }).content.kind, 'title');
  assert.equal(newLineupCard({ key: 'd', name: 'D', type: 'prayer', minutes: 7 }).minutes, 7);
});

const songCard = (hymnIds, arrangement = {}) => ({
  ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'worship')),
  content: { kind: 'song', hymnIds, maxSongs: 6, category: null },
  arrangement,
});

test('moving a song swaps it with its neighbour and leaves the rest of the card alone', () => {
  const card = songCard([1, 2, 3]);
  assert.deepEqual(moveSong(card, 1, -1).content.hymnIds, [2, 1, 3]);
  assert.deepEqual(moveSong(card, 1, 1).content.hymnIds, [1, 3, 2]);
  assert.equal(moveSong(card, 1, -1).content.maxSongs, 6);
  // The card itself is not mutated.
  assert.deepEqual(card.content.hymnIds, [1, 2, 3]);
});

test('a song at either end cannot move off it, and a card without songs has nothing to move', () => {
  const card = songCard([1, 2, 3]);
  assert.equal(moveSong(card, 0, -1), null);
  assert.equal(moveSong(card, 2, 1), null);
  assert.equal(moveSong(prayer(), 0, 1), null);
});

test('removing a song takes only that song, and its arrangement with it', () => {
  const card = songCard([1, 2, 3], { 1: ['10'], 2: ['20'], 3: ['30'] });
  const patch = removeSong(card, 2);
  assert.deepEqual(patch.content.hymnIds, [1, 3]);
  assert.deepEqual(patch.arrangement, { 1: ['10'], 3: ['30'] });
  assert.equal(removeSong(card, 99), null);
  assert.deepEqual(card.content.hymnIds, [1, 2, 3]);
});

test('moving a chained item swaps it with its neighbour and keeps the first item', () => {
  const { segment } = chainedPrayerCard();
  const moved = { ...segment, ...moveChainItem(segment, 1, -1) };
  assert.deepEqual(chainOf(moved).map((x) => x.noteId), [3, 2]);
  assert.equal(moved.content.noteId, 1);
  assert.equal(moveChainItem(segment, 0, -1), null);
  assert.equal(moveChainItem(segment, 1, 1), null);
});

test('removing a chained item takes only that item, not the card or the first item', () => {
  const { segment } = chainedPrayerCard();
  const removed = { ...segment, ...removeChainItem(segment, 0) };
  assert.deepEqual(chainOf(removed).map((x) => x.noteId), [3]);
  assert.equal(removed.content.noteId, 1);
  assert.equal(removeChainItem(segment, 5), null);
  assert.equal(runtimeOf(removed), runtimeOf(segment) - 2);
});

test('the rail lists every item of a card in one nested list, with move and remove for each', () => {
  const rail = readFileSync(fileURLToPath(new URL('../src/praise-worship/LineupRail.tsx', import.meta.url)), 'utf8');
  for (const hook of ['items.length + primaryCount > 1', 'reorder(n, n + delta)', 'removeSong(segment, songs[n])', 'removeChainItem(segment, n - songs.length)']) {
    assert.ok(rail.includes(hook), `LineupRail.tsx has ${hook}`);
  }
  // A card's second line is a count of its items, not the titles joined into one truncated line.
  assert.ok(rail.includes("t('itemsCount', { n: items.length + primaryCount })"));
});

test('moveItem puts an item at its new place and leaves the list alone when the move is off the list', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(list, 1, 1), list);
  assert.deepEqual(moveItem(list, 1, 9), list);
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
});

test('dragging a song within its card reorders hymnIds and nothing else', () => {
  const card = songCard([1, 2, 3, 4], { 1: ['10'], 4: ['40'] });
  assert.deepEqual(reorderSong(card, 3, 0).content.hymnIds, [4, 1, 2, 3]);
  assert.deepEqual(reorderSong(card, 0, 2).content.hymnIds, [2, 3, 1, 4]);
  assert.equal(reorderSong(card, 0, 2).content.maxSongs, 6);
  assert.equal(reorderSong(card, 2, 2), null);
  assert.equal(reorderSong(prayer(), 0, 1), null);
});

test('dragging a chained item within its card reorders the chain and keeps the first item', () => {
  const { segment } = chainedPrayerCard();
  const moved = { ...segment, ...reorderChainItem(segment, 0, 1) };
  assert.deepEqual(chainOf(moved).map((x) => x.noteId), [3, 2]);
  assert.equal(moved.content.noteId, 1);
  assert.equal(reorderChainItem(segment, 1, 1), null);
});
