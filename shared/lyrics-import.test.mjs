// Tests for the lyrics import helpers. Run with: node shared/lyrics-import.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLyricText, isMetadataLine, lyricTextFromItems, splitSongSheet } from './lyrics-import.js';
import { parseLyrics } from './lyrics-parser.js';

// pdf.js y grows upwards and reading goes down, so the next line has a smaller y.
const item = (str, y, hasEOL = false) => ({ str, hasEOL, transform: [12, 0, 0, 12, 72, y] });

// The song sheet from the lyrics website, as pasted. The "..." after the chorus is left out.
const OUR_FATHER = `Our Father
Official Lyrics
Words and Music by Brooke Ligertwood, Scott Ligertwood, Jonas Myrin

VERSE 1:
The words of Christ
Passed down through generations
The Son of God teaching us to pray
Echoed words
Father have Your will Your way in me
Completely

VERSE 2:
We wholly trust
You're faithful in provision
Amazing grace mercy for our sins
May we forgive
The way that You've forgiven us oh Lord
So we can sing

CHORUS:
Our Father
Hallowed be Your Name`;

test('items on one line join with spaces, and a new y starts a new line', () => {
  const text = lyricTextFromItems([
    item('Ang', 700), item('Panginoon', 700, true),
    item('ang', 686), item('aking', 686), item('pastol', 686, true),
  ]);
  assert.equal(text, 'Ang Panginoon\nang aking pastol');
});

test('hasEOL starts a new line even at the same y', () => {
  assert.equal(lyricTextFromItems([item('First', 700, true), item('Second', 700, true)]), 'First\nSecond');
});

test('a vertical gap wider than 1.6 line steps becomes one blank line', () => {
  // Line step is 14. The jump from 672 to 630 is 42, which is three steps, so a blank line goes between them.
  const text = lyricTextFromItems([
    item('Verse one', 700, true), item('line two', 686, true), item('line three', 672, true),
    item('Chorus', 630, true),
  ]);
  assert.equal(text, 'Verse one\nline two\nline three\n\nChorus');
});

test('a normal line gap does not add a blank line', () => {
  assert.equal(lyricTextFromItems([item('A', 700, true), item('B', 686, true), item('C', 672, true)]), 'A\nB\nC');
});

test('items without text are skipped, and an empty input gives an empty string', () => {
  assert.equal(lyricTextFromItems([{ hasEOL: true }, item('Only', 700, true)]), 'Only');
  assert.equal(lyricTextFromItems([]), '');
  assert.equal(lyricTextFromItems(undefined), '');
});

test('cleanLyricText normalises CRLF, drops trailing spaces and collapses blank runs', () => {
  assert.equal(cleanLyricText('a  \r\nb\t\r\n\r\n\r\n\r\nc   '), 'a\nb\n\nc');
  assert.equal(cleanLyricText('x\n \n \n \ny'), 'x\n\ny');
  assert.equal(cleanLyricText(null), '');
});

test('the song sheet example gives the title and three stanzas, with no header or credit text in the lyrics', () => {
  const sheet = splitSongSheet(OUR_FATHER);
  assert.equal(sheet.title, 'Our Father');
  assert.ok(sheet.raw.startsWith('VERSE 1:'));
  for (const bad of ['Official Lyrics', 'Words and Music', 'Brooke Ligertwood']) assert.ok(!sheet.raw.includes(bad), bad);

  const { stanzas, errors } = parseLyrics(sheet.raw);
  assert.deepEqual(errors, []);
  assert.deepEqual(stanzas.map((s) => s.stanzaType), ['Verse 1', 'Verse 2', 'Chorus']);
  assert.equal(stanzas[0].lyricsText.split('\n').length, 6);
  assert.equal(stanzas[1].lyricsText.split('\n').length, 6);
  assert.equal(stanzas[2].lyricsText, 'Our Father\nHallowed be Your Name');
  for (const s of stanzas) {
    assert.ok(!/VERSE|CHORUS|Official|Words and Music/.test(s.lyricsText), s.stanzaType);
  }
});

test('metadata lines are recognised at the start of the line, in any case', () => {
  assert.equal(isMetadataLine('Official Lyrics'), true);
  assert.equal(isMetadataLine('words and music by Someone'), true);
  assert.equal(isMetadataLine('Music by Someone'), true);
  assert.equal(isMetadataLine('© 2020 Publisher'), true);
  assert.equal(isMetadataLine('Arr. Someone'), true);
  assert.equal(isMetadataLine('Words of Christ'), false);
  assert.equal(isMetadataLine('Passed down through generations'), false);
});

test('a title above the first section header is taken; a title with no header is taken only with a blank line after it', () => {
  assert.deepEqual(splitSongSheet('Title\n\n[V1]\nLine'), { title: 'Title', raw: '[V1]\nLine' });
  assert.deepEqual(splitSongSheet('Ang Panginoon ang Aking Pastol\n\nAng Panginoon ang aking pastol\nHindi ako magkukulang'), {
    title: 'Ang Panginoon ang Aking Pastol',
    raw: 'Ang Panginoon ang aking pastol\nHindi ako magkukulang',
  });
});

test('no title is taken when more than one line sits above the first header, or the line is over 120 characters', () => {
  assert.equal(splitSongSheet('First line\nsecond line\n\nVERSE 1:\nA').title, '');
  assert.equal(splitSongSheet(`${'x'.repeat(121)}\n\nVERSE 1:\nA`).title, '');
  assert.equal(splitSongSheet(`${'x'.repeat(120)}\n\nVERSE 1:\nA`).title, 'x'.repeat(120));
});

test('a sheet with no section headers still splits on blank lines, and a lone title is not taken', () => {
  assert.deepEqual(splitSongSheet('Title\n\nVerse one\n\n\n\nVerse two'), { title: 'Title', raw: 'Verse one\n\nVerse two' });
  assert.deepEqual(splitSongSheet('Line one\nline two\n\nline three'), { title: '', raw: 'Line one\nline two\n\nline three' });
  assert.deepEqual(splitSongSheet('Only a title'), { title: '', raw: 'Only a title' });
  assert.deepEqual(splitSongSheet('   '), { title: '', raw: '' });
});
