// The planners' song cache: a changed song replaces the old one, a deleted song leaves it, a lineup slot that uses the song shows the
// new lyrics, and a Mass plan row shows the song's current title and deleted state. Run with: node --test shared/hymn-cache.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { hymnAfterChange, overlayLyricsItems, usesHymn, withHymn } from './hymn-cache.js';

const hymn = (id, title, lyrics, extra = {}) => ({
  id,
  title,
  category: 'Entrance',
  stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: lyrics }],
  ...extra,
});

test('a changed song replaces the cached one, and the old cache is not changed', () => {
  const before = { 5: hymn(5, 'Old title', 'old words') };
  const after = withHymn(before, 5, hymn(5, 'New title', 'new words'));
  assert.equal(after[5].title, 'New title');
  assert.equal(before[5].title, 'Old title', 'the original cache is untouched');
});

test('a song that is no longer in the library leaves the cache', () => {
  const cache = withHymn({ 5: hymn(5, 'Song', 'words') }, 5, hymnAfterChange(null));
  assert.equal(cache[5], undefined);
});

test('a deleted song (with deletedAt) is treated as gone', () => {
  assert.equal(hymnAfterChange(hymn(5, 'Song', 'words', { deletedAt: '2026-10-28T00:00:00Z' })), null);
  const live = hymn(5, 'Song', 'words', { deletedAt: null });
  assert.equal(hymnAfterChange(live), live);
});

test('a lineup slot that uses the song shows its new lyrics after the change', () => {
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  const cue = { ...segment, cues: { ...segment.cues, titleFirst: false } };
  const cacheOf = (cache) => Object.values(cache);

  let cache = { 5: hymn(5, 'Hail Mary', 'old words') };
  assert.equal(slidesFor(cue, { hymns: cacheOf(cache) })[0].text, 'old words');

  cache = withHymn(cache, 5, hymn(5, 'Hail Mary', 'new words'));
  assert.equal(slidesFor(cue, { hymns: cacheOf(cache) })[0].text, 'new words');
});

test('a lineup slot whose song was deleted shows no song lyrics', () => {
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  const cue = { ...segment, cues: { ...segment.cues, titleFirst: false } };
  const cache = withHymn({ 5: hymn(5, 'Hail Mary', 'words') }, 5, hymnAfterChange(null));
  assert.deepEqual(slidesFor(cue, { hymns: Object.values(cache) }).map((s) => s.kind), ['title']);
});

test('usesHymn finds a song in a song slot only', () => {
  const song = { content: { kind: 'song', hymnIds: [5] } };
  const prayer = { content: { kind: 'prayer', noteId: 5 } };
  assert.equal(usesHymn([prayer, song], 5), true);
  assert.equal(usesHymn([prayer], 5), false);
});

test('a Mass plan row shows the song\u2019s current title, not the one saved with the plan', () => {
  const items = [
    { module: 'lyrics', sourceId: '5', label: 'Old title', block: 'entrance' },
    { module: 'bible', sourceId: 'x', label: 'Genesis 1:1', block: 'word' },
  ];
  const shown = overlayLyricsItems(items, { 5: { title: 'New title', deleted: false } });
  assert.equal(shown[0].label, 'New title');
  assert.equal(shown[1].label, 'Genesis 1:1', 'other modules are untouched');
  assert.equal(items[0].label, 'Old title', 'the saved plan is not changed');
});

test('a Mass plan row for a deleted song is shown as deleted, and a song not yet read keeps its saved label', () => {
  const items = [
    { module: 'lyrics', sourceId: '5', label: 'Song', block: 'entrance' },
    { module: 'lyrics', sourceId: '6', label: 'Saved title', block: 'entrance' },
  ];
  const shown = overlayLyricsItems(items, { 5: { title: 'Song', deleted: true } });
  assert.equal(shown[0].stale, true);
  assert.equal(shown[0].deleted, true);
  assert.equal(shown[1].label, 'Saved title');
  assert.equal(shown[1].stale, undefined);
});
