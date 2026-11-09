// Tests for the Songs page's rules and wiring: the search, the filters, the counts, the synced line, and that the page reads the server's
// list and not the sample songs. Run with: node --test server/test/web-songs-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANGUAGES,
  SCOPES,
  activePlans,
  categoriesInScope,
  categoriesOf,
  countsFor,
  filterSongs,
  keyRank,
  languageBadge,
  plansBySong,
  scopeCounts,
  scopeLabel,
  sortSongs,
  syncedText,
  usedLabel,
} from '../../web/js/song-list.js';
import { defaultSongStep, itemsWithSong, massFromItems, massRows, praiseFromItems, praiseSegments, slotEntries, songSteps } from '../../web/js/plan-model.js';
import { MASS_PLAN, PRAISE_PLAN } from '../../web/js/sample-data.js';
import { LANGUAGES as SERVER_LANGUAGES } from '../lib/songs-sync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SONGS = [
  { id: '1', title: 'Test song', category: 'Communion', language: 'English', key: 'C' },
  { id: '2', title: 'Praise to the Lord', category: 'Entrance Procession', language: 'English', key: 'D' },
  { id: '3', title: 'Panginoon, Ikaw ang Aking Lakas', category: 'Communion', language: 'Tagalog', key: 'G' },
  { id: '4', title: 'Ang Dios Mao Ang Atong Kusog', category: 'Recessional', language: 'Cebuano', key: 'A' },
];

test('the languages are the server\'s three languages', () => {
  assert.deepEqual(LANGUAGES, SERVER_LANGUAGES);
});

test('the category chips come from the church\'s own songs, sorted, with no blanks', () => {
  assert.deepEqual(categoriesOf([...SONGS, { id: '5', title: 'No category', category: '', language: 'English', key: '' }]), ['Communion', 'Entrance Procession', 'Recessional']);
});

test('the search finds a title by any case, and by a phrase', () => {
  assert.deepEqual(filterSongs(SONGS, { q: 'test' }).map((s) => s.title), ['Test song']);
  assert.deepEqual(filterSongs(SONGS, { q: '  praise TO the' }).map((s) => s.title), ['Praise to the Lord']);
  assert.deepEqual(filterSongs(SONGS, { q: 'nothing like this' }), []);
});

test('the language and category filters work together with the search', () => {
  assert.deepEqual(filterSongs(SONGS, { language: 'English' }).map((s) => s.title), ['Test song', 'Praise to the Lord']);
  assert.deepEqual(filterSongs(SONGS, { language: 'Tagalog', category: 'Communion' }).map((s) => s.title), ['Panginoon, Ikaw ang Aking Lakas']);
  assert.deepEqual(filterSongs(SONGS, { language: 'English', category: 'Communion', q: 'test' }).map((s) => s.title), ['Test song']);
});

test('the chip counts follow the search and the language, as before', () => {
  assert.deepEqual(countsFor(SONGS, {}), { All: 4, Communion: 2, 'Entrance Procession': 1, Recessional: 1 });
  assert.deepEqual(countsFor(SONGS, { language: 'English' }), { All: 2, Communion: 1, 'Entrance Procession': 1, Recessional: 0 });
  assert.deepEqual(countsFor(SONGS, { q: 'test' }), { All: 1, Communion: 1, 'Entrance Procession': 0, Recessional: 0 });
});

test('the synced line shows the server\'s time, and says so when there is none', () => {
  assert.equal(syncedText(null), 'No songs synced yet');
  assert.equal(syncedText('not a time'), 'No songs synced yet');
  const text = syncedText('2026-10-27T14:30:00.000Z');
  assert.ok(text.startsWith('Synced '));
  assert.ok(text.includes('2026'), 'the date comes from the server\'s time');
  assert.notEqual(text, 'Synced 2 min ago', 'it is not the old fixed string');
});

test('the Songs page reads the server\'s list and no longer imports the sample songs', () => {
  const page = fs.readFileSync(path.join(here, '..', '..', 'web', 'js', 'songs.js'), 'utf8');
  assert.equal(/sample-data/.test(page), false, 'no sample import on the Songs page');
  assert.match(page, /listSongs\(\)/, 'the page calls the server list');
  assert.equal(/\bSONGS\b/.test(page), false, 'no sample song array is read');
});

// ---- Scope ----

const SCOPED = [
  { id: 'a', title: 'Gloria Patri', category: 'Gloria', scope: 'MASS', language: 'English', key: 'G' },
  { id: 'b', title: 'Awesome God', category: 'Joyful Song', scope: 'PRAISE_AND_WORSHIP', language: 'English', key: 'Bb' },
  { id: 'c', title: 'Papuri', category: 'Joyful Song', scope: 'PRAISE_AND_WORSHIP', language: 'Tagalog', key: '' },
  { id: 'd', title: 'Any Time', category: 'General', scope: 'GENERAL', language: 'Cebuano', key: 'Am' },
];

test('the scope tabs filter by songs.scope, and a General song is under All Scopes only', () => {
  assert.deepEqual(SCOPES.map((s) => s.value), ['All', 'MASS', 'PRAISE_AND_WORSHIP']);
  assert.deepEqual(filterSongs(SCOPED, { scope: 'MASS' }).map((s) => s.id), ['a']);
  assert.deepEqual(filterSongs(SCOPED, { scope: 'PRAISE_AND_WORSHIP' }).map((s) => s.id), ['b', 'c']);
  assert.equal(filterSongs(SCOPED, {}).length, 4);
  assert.equal(scopeLabel('GENERAL'), 'General');
  assert.equal(scopeLabel('PRAISE_AND_WORSHIP'), 'Praise & Worship');
});

test('the category chips and their counts follow the scope', () => {
  assert.deepEqual(categoriesInScope(SCOPED, 'MASS'), ['Gloria']);
  assert.deepEqual(categoriesInScope(SCOPED, 'All'), ['General', 'Gloria', 'Joyful Song']);
  assert.deepEqual(countsFor(SCOPED, { scope: 'PRAISE_AND_WORSHIP', language: 'Tagalog' }), { All: 1, 'Joyful Song': 1 });
  assert.deepEqual(scopeCounts(SCOPED, { language: 'English' }), { All: 2, MASS: 1, PRAISE_AND_WORSHIP: 1 });
});

test('the page hands the filters their own names, so the language and category chips filter', () => {
  const page = fs.readFileSync(path.join(here, '..', '..', 'web', 'js', 'songs.js'), 'utf8');
  assert.match(page, /state\.language = button\.dataset\.lang/);
  assert.match(page, /state\.category = button\.dataset\.cat/);
  assert.equal(/state\.(lang|cat)\b/.test(page), false);
});

// ---- Badges, sorting and use in plans ----

test('each language has its badge, and an unknown language has none', () => {
  assert.deepEqual(['English', 'Tagalog', 'Cebuano'].map((l) => languageBadge(l).code), ['EN', 'TL', 'CEB']);
  assert.equal(languageBadge('Latin'), null);
});

test('keys sort from A to G with flats, naturals and sharps in order, and a song with no key goes last', () => {
  const ranked = ['G', 'C#', 'Ab', 'A', 'Am', 'A#', 'Bb', 'B', 'not a key', ''].sort((a, b) => keyRank(a) - keyRank(b) || a.localeCompare(b));
  assert.deepEqual(ranked, ['Ab', 'A', 'Am', 'A#', 'Bb', 'B', 'C#', 'G', '', 'not a key']);
});

test('the sort orders: A to Z, key, and most used with the title breaking ties', () => {
  assert.deepEqual(sortSongs(SCOPED).map((s) => s.id), ['d', 'b', 'a', 'c']);
  assert.deepEqual(sortSongs(SCOPED, 'key-asc').map((s) => s.id), ['d', 'b', 'a', 'c']);
  const used = { a: 3, c: 3, b: 1 };
  assert.deepEqual(sortSongs(SCOPED, 'used-desc', (s) => used[s.id] ?? 0).map((s) => s.id), ['a', 'c', 'b', 'd']);
  assert.deepEqual(sortSongs(SCOPED, 'nonsense').map((s) => s.id), ['d', 'b', 'a', 'c']);
  assert.equal(SCOPED[0].id, 'a', 'the list passed in is not reordered');
});

test('only plans dated today or later count, and a plan not in the list does not count', () => {
  const plans = [
    { id: 'later', name: 'Later', liturgical_date: '2026-12-25' },
    { id: 'past', name: 'Past', liturgical_date: '2026-11-08' },
    { id: 'today', name: 'Today', liturgical_date: '2026-11-09' },
  ];
  const active = activePlans(plans, '2026-11-09');
  assert.deepEqual(active.map((p) => p.id), ['today', 'later']);
  const used = plansBySong({ s1: ['later', 'past', 'today', 'deleted'], s2: ['past'] }, active);
  assert.deepEqual(used.get('s1').map((p) => p.id), ['today', 'later']);
  assert.deepEqual(used.get('s2'), []);
  assert.equal(usedLabel(1), 'Used in 1 plan');
  assert.equal(usedLabel(0), 'Used in 0 plans');
});

// ---- Add to plan ----

const TEMPLATES = { mass: MASS_PLAN, praise: PRAISE_PLAN };
const SONG = '20000000-0000-4000-8000-000000000001';
const OTHER_SONG = '20000000-0000-4000-8000-000000000002';

test('a song goes into an empty Mass slot with that slot\'s number, and the plan\'s other items are kept', () => {
  const plan = { kind: 'mass', items: [{ key: 's2', group: 'introductory', order: 1, kind: 'rite', slot: 2, text: 'Said by all', note: 'Keep this note' }] };
  const items = itemsWithSong(plan, TEMPLATES, 's16', SONG);
  const added = items.find((item) => item.songId === SONG);
  assert.equal(added.slot, 16);
  assert.equal(added.kind, 'song');
  assert.equal(added.group, 'communion');
  const kept = items.find((item) => item.slot === 2);
  assert.equal(kept.text, 'Said by all');
  assert.equal(kept.note, 'Keep this note');
  assert.deepEqual(items.map((item) => item.order), [1, 2]);
});

test('a second song joins a filled step, and the same song is refused in that step', () => {
  const first = itemsWithSong({ kind: 'mass', items: [] }, TEMPLATES, 's16', OTHER_SONG);
  const both = itemsWithSong({ kind: 'mass', items: first }, TEMPLATES, 's16', SONG);
  const rows = massRows(MASS_PLAN);
  assert.deepEqual(slotEntries(massFromItems(both, rows).segments.s16).map((e) => e.songId), [OTHER_SONG, SONG]);
  assert.equal(new Set(both.map((item) => item.key)).size, 2, 'each item has its own key');
  assert.equal(itemsWithSong({ kind: 'mass', items: both }, TEMPLATES, 's16', SONG), null);
});

test('a Praise & Worship plan keeps its minutes, and a step that is not for songs is refused', () => {
  const segments = praiseSegments(PRAISE_PLAN);
  const plan = { kind: 'pw', items: [{ key: '2', group: 'opening', order: 1, kind: 'song', minutes: 9 }] };
  const items = itemsWithSong(plan, TEMPLATES, '2', SONG);
  const filled = praiseFromItems(items, segments);
  assert.equal(filled.segments['2'].songId, SONG);
  assert.equal(filled.segments['2'].minutes, 9);
  assert.equal(itemsWithSong(plan, TEMPLATES, '1', SONG), null, 'the welcome is a rite');
  assert.equal(itemsWithSong({ kind: 'mass', items: [] }, TEMPLATES, 's2', SONG), null, 'the Confiteor is spoken');
});

test('the step offered first is the song\'s own category, then an empty step, and never one that has the song', () => {
  const plan = { kind: 'mass', items: itemsWithSong({ kind: 'mass', items: [] }, TEMPLATES, 's1', SONG) };
  assert.equal(defaultSongStep(songSteps(plan, TEMPLATES, OTHER_SONG, 'Communion Procession')).id, 's16');
  const steps = songSteps(plan, TEMPLATES, SONG, 'Entrance Procession');
  assert.equal(steps.find((s) => s.id === 's1').hasSong, true);
  assert.equal(defaultSongStep(steps).id, 's3', 'the song is already in its own slot, so the next empty step');
  assert.equal(steps.every((s) => s.row.kind === 'song'), true);
  assert.equal(defaultSongStep([]), null);
});

// ---- Wiring ----

test('the page keeps its promises: the search id, the hotkey, the row button and escaped values', () => {
  const root = path.join(here, '..', '..', 'web');
  const html = fs.readFileSync(path.join(root, 'songs.html'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'js', 'songs.js'), 'utf8');
  const dialog = fs.readFileSync(path.join(root, 'js', 'add-to-plan.js'), 'utf8');
  assert.match(html, /id="song-search-input"/);
  assert.match(html, /<dialog id="song-drawer" class="song-drawer"/);
  assert.equal(/<script(?![^>]*\bsrc=)|\son[a-z]+=/i.test(html), false, 'no inline script or handler, as the Content Security Policy requires');
  assert.match(page, /event\.key !== '\/'/);
  assert.match(page, /querySelector\('dialog\[open\]'\)/);
  assert.match(page, /event\.stopPropagation\(\)/);
  assert.equal(/innerHTML/.test(dialog), false, 'the dialog fills its lists with new Option()');
  // say() writes textContent, so it is the one place a name may be written as it is.
  const markup = page.replace(/say\(`[^`]*`\);/g, '');
  for (const field of ['song.title', 'song.category', 'song.key', 'song.ccli', 'plan.name', 'state.failed']) {
    assert.equal(new RegExp(`\\$\\{${field.replace('.', '\\.')}\\}`).test(markup), false, `${field} never goes into markup unescaped`);
  }
});
