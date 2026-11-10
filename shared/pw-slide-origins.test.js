// Where each slide of a Praise & Worship card comes from (slideOriginsFor), which Go Live's Edit slide on air and Add slide read on every slide
// that is not a song's. Run with: node --test shared/pw-slide-origins.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slideOriginsFor, slidesFor } from './pw.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const card = (content, cues = {}) => ({
  key: 'prayer_authority',
  group: 'opening',
  name: 'Prayer to Take Authority',
  type: 'prayer',
  minutes: 3,
  leader: '',
  content: { hymnIds: [], ...content },
  arrangement: {},
  cues: { lowerThird: false, titleFirst: false, fadeOut: false, ...cues },
  notes: '',
});
const HYMN = { id: 7, title: 'Adlaw-Adlaw', category: 'Joyful Song', style: null, stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: 'One' }, { id: 2, stanzaType: 'Chorus', lyricsText: 'Two' }] };
const PRAYER = { title: 'Prayer to Take Authority', body: 'First part.\nSecond line.\nThird part.', split: null, align: 'center' };

test('the card in the screenshot: a title slide, the prayer’s pages, then the song, each slide named by where it comes from', () => {
  const segment = card({ kind: 'prayer', noteId: 3, hymnIds: [7] }, { titleFirst: true });
  const resolved = { prayer: PRAYER, hymns: [HYMN], more: [] };
  const slides = slidesFor(segment, resolved);
  const origins = slideOriginsFor(segment, resolved);
  assert.equal(origins.length, slides.length, 'one origin for every slide');
  assert.deepEqual(origins[0], { item: 'head', source: 'prayer', title: true, page: null }, 'T is the card’s title slide');
  const prayerPages = origins.filter((o) => o.item === 'head' && !o.title);
  assert.ok(prayerPages.length >= 1);
  assert.deepEqual(prayerPages.map((o) => o.page), prayerPages.map((_, i) => i), 'the prayer’s pages are numbered from 0');
  assert.ok(origins.slice(1 + prayerPages.length).every((o) => o.item === 'songs' && o.source === 'song'), 'then the song');
});

test('chained items keep their place, and a card with nothing to show is its title', () => {
  const segment = card({ kind: 'title', more: [{ kind: 'pictures', slideIds: [1, 2], minutes: 0 }, { kind: 'lectionary', readingType: 'Gospel', minutes: 3 }] });
  const resolved = {
    hymns: [],
    more: [{ pictures: [{ title: 'a', src: 'x' }, { title: 'b', src: 'y' }] }, { reading: { citation: 'Jn 3:16', rawText: 'For God so loved the world.' } }],
  };
  const origins = slideOriginsFor(segment, resolved);
  assert.equal(origins.length, slidesFor(segment, resolved).length);
  assert.deepEqual(origins.map((o) => [o.item, o.source, o.title, o.page]), [
    ['head', 'title', true, null],
    [0, 'pictures', false, null],
    [0, 'pictures', false, null],
    [1, 'reading', false, 0],
  ]);
  const empty = card({ kind: 'song', maxSongs: 1, category: null });
  assert.deepEqual(slideOriginsFor(empty, { hymns: [] }), [{ item: 'card', source: 'title', title: true, page: null }]);
  assert.equal(slidesFor(empty, { hymns: [] }).length, 1);
});

test('a prayer slot with no prayer yet is one placeholder page, which the editor fills', () => {
  const segment = card({ kind: 'prayer', noteId: null });
  assert.deepEqual(slideOriginsFor(segment, { hymns: [] }), [{ item: 'head', source: 'prayer', title: false, page: 0 }]);
});

test('the lineup console edits every slide that is not a song’s through the card editor, saved to the card’s own copy', () => {
  const lineup = read('src/praise-worship/LineupHotEdit.tsx');
  assert.match(lineup, /<CardSlideHotEdit/);
  assert.match(lineup, /showButtons=\{!onAirSlide\}/, 'its buttons show on any slide that is not a song’s');
  assert.match(lineup, /else setCardRequest\(editRequest\)/, 'a double-click on any other chip opens it there');
  const copy = read('src/praise-worship/lineupSlideCopy.ts');
  assert.match(copy, /isCopyFor\(note, owner\)/, 'a shared prayer is copied first, never changed');
  assert.match(copy, /bridge\.notes\.saveCopy\(/, 'written only through the copy-only channel');
  assert.doesNotMatch(copy, /bridge\.notes\.(save|remove)\(/, 'never the Hub’s own save or delete');
  assert.match(copy, /display: 'full'/);
  assert.doesNotMatch(copy, /bridge\.lectionary/, 'the Lectionary is never written');
});
