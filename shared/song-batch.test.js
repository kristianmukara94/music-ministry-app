// Tests the batch song import: a file of many songs taken apart into one song each, and the checks before they are imported.
// Run with: node --test shared/song-batch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveTitle,
  linesFromDocxHtml,
  linesFromText,
  mergeSongs,
  nextVerseLabel,
  songIssues,
  songToTagged,
  splitSongAt,
  splitSongs,
} from './song-batch.js';

const titles = (result) => result.songs.map((s) => s.title);
const kinds = (song) => song.stanzas.map((s) => s.type);

test('songs titled in capitals are split at each title, with their verse and chorus labels read', () => {
  const sheet = `AMAZING GRACE

Verse 1:
Amazing grace, how sweet the sound
That saved a wretch like me

Chorus:
My chains are gone, I've been set free

HOLY, HOLY, HOLY

Holy, holy, holy, Lord God Almighty
Early in the morning our song shall rise to Thee

Holy, holy, holy, merciful and mighty`;
  const result = splitSongs(linesFromText(sheet));
  assert.equal(result.method, 'titles');
  assert.deepEqual(titles(result), ['AMAZING GRACE', 'HOLY, HOLY, HOLY']);
  assert.deepEqual(kinds(result.songs[0]), ['Verse 1', 'Chorus']);
  assert.equal(result.songs[0].stanzas[0].text, 'Amazing grace, how sweet the sound\nThat saved a wretch like me');
  assert.deepEqual(kinds(result.songs[1]), ['Verse 1', 'Verse 2'], 'without labels, blank lines separate the verses');
});

test('lyrics written all in capitals do not make every line a title', () => {
  const sheet = `PRAYER TO TAKE AUTHORITY

IN THE NAME OF JESUS
I TAKE AUTHORITY

AND I BIND ALL POWER
AND FORCES IN THE AIR`;
  const result = splitSongs(linesFromText(sheet));
  assert.equal(result.songs.length, 1);
  assert.equal(result.songs[0].title, 'PRAYER TO TAKE AUTHORITY');
  assert.equal(result.songs[0].stanzas.length, 2);
});

test('numbered titles, "Song 3:" and "Title:" lines start songs, and the numbers are taken off', () => {
  const sheet = `01. Here I Am Lord

I, the Lord of sea and sky
I have heard my people cry

Song 2: Be Not Afraid

You shall cross the barren desert

Title: Ama Namin
Ama namin, sumasalangit ka`;
  const result = splitSongs(linesFromText(sheet));
  assert.deepEqual(titles(result), ['Here I Am Lord', 'Be Not Afraid', 'Ama Namin']);
  assert.equal(result.songs[2].stanzas[0].text, 'Ama namin, sumasalangit ka');
});

test('numbered verses inside a song are not mistaken for titles', () => {
  const sheet = `ONE BREAD ONE BODY

1. Gentile or Jew, servant or free
Woman or man no more

2. Many the gifts, many the works
One in the Lord of all`;
  const result = splitSongs(linesFromText(sheet));
  assert.equal(result.songs.length, 1);
  assert.equal(result.songs[0].stanzas.length, 2);
});

test('a Word heading or a bold line on its own starts a song; bold lyrics do not', () => {
  const html = [
    '<h2>Lord, I Lift Your Name</h2>',
    '<p>Lord, I lift Your name on high</p>',
    '<p></p>',
    '<p><strong>Shout to the Lord</strong></p>',
    '<p></p>',
    '<p><strong>My Jesus, my Saviour</strong></p>',
    '<p><strong>Lord, there is none like You</strong></p>',
  ].join('');
  const lines = linesFromDocxHtml(html);
  assert.equal(lines[0].heading, true);
  assert.equal(lines[3].bold, true);
  const result = splitSongs(lines);
  assert.deepEqual(titles(result), ['Lord, I Lift Your Name', 'Shout to the Lord']);
  assert.equal(result.songs[1].stanzas[0].text, 'My Jesus, my Saviour\nLord, there is none like You');
});

test('Word line breaks, empty paragraphs and entities come through as lines', () => {
  const lines = linesFromDocxHtml('<p>One<br/>Two &amp; three</p><p></p><p>It&#39;s <strong>half</strong> bold</p>');
  assert.deepEqual(lines.map((l) => l.text), ['One', 'Two & three', '', "It's half bold"]);
  assert.equal(lines[3].bold, undefined, 'a line only partly bold is not a bold line');
});

test('with no titles found, separator lines and then wide gaps split the songs', () => {
  const dashed = splitSongs(linesFromText('Song A\n\nla la la\n---\nSong B\n\nda da da'));
  assert.equal(dashed.method, 'delimiter');
  assert.deepEqual(titles(dashed), ['Song A', 'Song B']);

  const gaps = splitSongs(linesFromText('Song A\n\nla la la\nla la\n\n\n\nSong B\n\nda da da'));
  assert.equal(gaps.method, 'blank');
  assert.deepEqual(titles(gaps), ['Song A', 'Song B']);
});

test('the operator can choose to split at blank lines or at their own delimiter', () => {
  const lines = linesFromText('first song\n\nwords\n%%\nsecond song\n\nmore words');
  assert.deepEqual(titles(splitSongs(lines, { mode: 'delimiter', delimiter: '%%' })), ['first song', 'second song']);
  assert.equal(splitSongs(lines, { mode: 'blank' }).songs.length, 1);
});

test('a file with no structure at all is one song, and an empty file is none', () => {
  const one = splitSongs(linesFromText('just some words\nand more words'));
  assert.equal(one.method, 'single');
  assert.equal(one.songs.length, 1);
  assert.equal(one.songs[0].title, '');
  assert.deepEqual(splitSongs(linesFromText('   \n\n')).songs, []);
});

test('credit lines are left out of the lyrics', () => {
  const result = splitSongs(linesFromText('GLORIA\n\nWords and music by Someone\nGlory to God in the highest\n\nCopyright 2001'));
  assert.equal(result.songs[0].stanzas.length, 1);
  assert.equal(result.songs[0].stanzas[0].text, 'Glory to God in the highest');
});

test('a song is checked before import: no stanzas stops it, a missing title is filled from its first line', () => {
  const empty = { title: 'Nothing', stanzas: [] };
  assert.deepEqual(songIssues(empty).map((i) => [i.level, i.code]), [['error', 'noStanzas']]);
  const untitled = { title: '', stanzas: [{ type: 'Verse 1', text: 'Here I am, Lord\nIs it I, Lord?' }] };
  assert.deepEqual(songIssues(untitled).map((i) => [i.level, i.code]), [['warning', 'emptyTitle']]);
  assert.equal(effectiveTitle(untitled), 'Here I am, Lord');
  const known = { title: 'Amazing Grace', stanzas: [{ type: 'Verse 1', text: 'x' }] };
  assert.deepEqual(songIssues(known, new Set(['amazing grace'])).map((i) => i.code), ['duplicate']);
});

test('a song is saved as tagged lyrics the hymn library reads back the same way', () => {
  const song = { title: 'A', stanzas: [{ type: 'Verse 1', text: 'one' }, { type: 'Chorus', text: 'two' }, { type: 'Verse 2', text: '  ' }] };
  assert.equal(songToTagged(song), '[V1]\none\n\n[C]\ntwo');
});

test('songs can be split at a stanza and merged back', () => {
  const song = { key: 'a', title: 'A', source: 'src', stanzas: [{ key: '1', type: 'Verse 1', text: 'x' }, { key: '2', type: 'Verse 2', text: 'y' }] };
  const [first, second] = splitSongAt(song, 1);
  assert.equal(first.stanzas.length, 1);
  assert.equal(second.title, '');
  assert.equal(second.stanzas[0].text, 'y');
  assert.deepEqual(splitSongAt(song, 0), [song]);
  const merged = mergeSongs(first, second);
  assert.equal(merged.title, 'A');
  assert.equal(merged.stanzas.length, 2);
  assert.equal(nextVerseLabel(merged.stanzas), 'Verse 3');
  assert.equal(nextVerseLabel([]), 'Verse 1');
});
