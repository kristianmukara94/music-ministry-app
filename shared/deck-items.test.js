// The unified Announcements & Whiteboard deck: what each view lists, where new slides go, and how playback steps.
// Run with: node --test shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeckItems,
  canReorder,
  clickKeySelection,
  destinationFor,
  existingView,
  itemKey,
  itemsInView,
  moveKey,
  parseDeckView,
  parseItemKey,
  searchItems,
  splitKeys,
  stepIndex,
} from './deck-items.js';

const ann = [
  { id: 1, folderId: 10, name: 'Bulletin p1', text: null, headline: null, notes: 'Read slowly' },
  { id: 2, folderId: 10, name: 'Bulletin p2', text: 'Second collection today', headline: 'Collection', notes: null },
  { id: 3, folderId: 11, name: 'Oratio', text: 'Prayer text slot', headline: null, notes: null },
  // The picture behind a Whiteboard PowerPoint card.
  { id: 4, folderId: 99, name: 'Deck slide 1', text: null, headline: null, notes: null },
];
const wb = [
  { id: 1, folderId: null, title: 'Sermon outline', content: 'Three points', slideId: null },
  { id: 2, folderId: 20, title: 'Deck slide 1', content: '', slideId: 4 },
  { id: 3, folderId: 20, title: 'PR night', content: 'Youth', slideId: null },
];
const items = buildDeckItems(ann, wb);

test('keys keep the two libraries apart, and read back', () => {
  assert.equal(itemKey('ann', 7), 'a:7');
  assert.equal(itemKey('wb', 7), 'w:7');
  assert.deepEqual(parseItemKey('a:7'), { source: 'ann', id: 7 });
  assert.deepEqual(parseItemKey('w:12'), { source: 'wb', id: 12 });
  assert.equal(parseItemKey('x:1'), null);
  assert.equal(parseItemKey('a:'), null);
});

test('the combined list puts announcements first and lists a PowerPoint picture once, as its Whiteboard card', () => {
  assert.deepEqual(
    items.map((i) => i.key),
    ['a:1', 'a:2', 'a:3', 'w:1', 'w:2', 'w:3'],
  );
});

test('views', () => {
  assert.deepEqual(parseDeckView('all'), { store: 'all', folder: undefined });
  assert.deepEqual(parseDeckView('ann:10'), { store: 'ann', folder: 10 });
  assert.deepEqual(parseDeckView('wb:unfiled'), { store: 'wb', folder: null });
  assert.deepEqual(parseDeckView('nonsense'), { store: 'all', folder: undefined });
  const keys = (view) => itemsInView(items, view).map((i) => i.key);
  assert.equal(keys('all').length, 6);
  assert.deepEqual(keys('ann'), ['a:1', 'a:2', 'a:3']);
  assert.deepEqual(keys('ann:10'), ['a:1', 'a:2']);
  assert.deepEqual(keys('wb'), ['w:1', 'w:2', 'w:3']);
  assert.deepEqual(keys('wb:unfiled'), ['w:1']);
  assert.deepEqual(keys('wb:20'), ['w:2', 'w:3']);
});

test('search matches title, text and notes, every word, any case', () => {
  assert.deepEqual(searchItems(items, 'collection').map((i) => i.key), ['a:2']);
  assert.deepEqual(searchItems(items, 'READ slowly').map((i) => i.key), ['a:1']);
  assert.deepEqual(searchItems(items, 'sermon three').map((i) => i.key), ['w:1']);
  assert.equal(searchItems(items, '  ').length, items.length);
  assert.equal(searchItems(items, 'nothing-like-this').length, 0);
});

test('a new slide goes into the open folder, or the chosen place when the view spans folders', () => {
  assert.deepEqual(destinationFor('ann:11', null, [10, 11], [20]), { store: 'ann', folderId: 11 });
  assert.deepEqual(destinationFor('wb:20', null, [10, 11], [20]), { store: 'wb', folderId: 20 });
  assert.deepEqual(destinationFor('wb:unfiled', null, [10], [20]), { store: 'wb', folderId: null });
  // All: the chosen place, while it exists.
  assert.deepEqual(destinationFor('all', { store: 'wb', folderId: 20 }, [10], [20]), { store: 'wb', folderId: 20 });
  assert.deepEqual(destinationFor('all', { store: 'wb', folderId: 21 }, [10], [20]), { store: 'ann', folderId: 10 });
  assert.deepEqual(destinationFor('all', null, [], []), { store: 'wb', folderId: null });
  // A library's own root: a choice in the other library does not apply.
  assert.deepEqual(destinationFor('wb', { store: 'ann', folderId: 10 }, [10], [20]), { store: 'wb', folderId: null });
  assert.deepEqual(destinationFor('ann', { store: 'wb', folderId: null }, [10, 11], []), { store: 'ann', folderId: 10 });
  assert.deepEqual(destinationFor('ann', { store: 'ann', folderId: 11 }, [10, 11], []), { store: 'ann', folderId: 11 });
});

test('a folder that is gone falls back to its library', () => {
  assert.equal(existingView('ann:10', [10], []), 'ann:10');
  assert.equal(existingView('ann:12', [10], []), 'ann');
  assert.equal(existingView('wb:5', [], [20]), 'wb');
  assert.equal(existingView('wb:unfiled', [], []), 'wb:unfiled');
  assert.equal(existingView('junk', [], []), 'all');
});

test('reordering: inside one announcement folder, or any Whiteboard view, and never while searching', () => {
  assert.equal(canReorder('ann:10', ''), true);
  assert.equal(canReorder('ann', ''), false);
  assert.equal(canReorder('all', ''), false);
  assert.equal(canReorder('wb', ''), true);
  assert.equal(canReorder('wb:unfiled', ''), true);
  assert.equal(canReorder('wb:20', 'x'), false);
});

test('playback steps, wraps only when looping, and starts from the first slide', () => {
  assert.equal(stepIndex(-1, 3, 1, false), 0);
  assert.equal(stepIndex(0, 3, 1, false), 1);
  assert.equal(stepIndex(2, 3, 1, false), -1);
  assert.equal(stepIndex(2, 3, 1, true), 0);
  assert.equal(stepIndex(0, 3, -1, true), 2);
  assert.equal(stepIndex(0, 3, -1, false), -1);
  assert.equal(stepIndex(0, 0, 1, true), -1);
});

test('a mixed pick splits into each library', () => {
  assert.deepEqual(splitKeys(['a:1', 'w:2', 'a:3', 'bad']), { ann: [1, 3], wb: [2] });
});

test('Shift-click picks a range of keys in the order shown', () => {
  const order = ['a:1', 'a:2', 'w:1', 'w:2'];
  const next = clickKeySelection(new Set(['a:1']), order, 'a:1', 'w:1', true);
  assert.deepEqual([...next].sort(), ['a:1', 'a:2', 'w:1']);
  assert.deepEqual([...clickKeySelection(new Set(), order, null, 'w:2', false)], ['w:2']);
});

test('moving a key', () => {
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  const same = ['a', 'b'];
  assert.equal(moveKey(same, 'a', 'a'), same);
});

test('the Whiteboard PowerPoint folder is recognised by name, any case', async () => {
  const { isSystemFolder, WHITEBOARD_POWERPOINT_FOLDER } = await import('./deck-items.js');
  assert.equal(isSystemFolder(WHITEBOARD_POWERPOINT_FOLDER), true);
  assert.equal(isSystemFolder(' whiteboard powerpoint '), true);
  assert.equal(isSystemFolder('Parish Bulletins'), false);
  assert.equal(isSystemFolder(null), false);
});
