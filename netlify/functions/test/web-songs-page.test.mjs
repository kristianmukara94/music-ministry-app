// Tests for the Songs page's rules and wiring: the search, the filters, the counts, the synced line, and that the page reads the server's
// list and not the sample songs. Run with: node --test netlify/functions/test/web-songs-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, categoriesOf, countsFor, filterSongs, syncedText } from '../../../web/js/song-list.js';
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
  const page = fs.readFileSync(path.join(here, '..', '..', '..', 'web', 'js', 'songs.js'), 'utf8');
  assert.equal(/sample-data/.test(page), false, 'no sample import on the Songs page');
  assert.match(page, /listSongs\(\)/, 'the page calls the server list');
  assert.equal(/\bSONGS\b/.test(page), false, 'no sample song array is read');
});
