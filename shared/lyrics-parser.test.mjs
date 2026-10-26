// Tests for section headers in lyrics. Run with: node shared/lyrics-parser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, sectionHeader } from './lyrics-parser.js';

test('the word and bracket forms of Verse 1 are all recognised as Verse 1', () => {
  for (const line of ['VERSE 1:', 'Verse 1', 'verse 1.', '[V1]', '[Verse 1]']) {
    const header = sectionHeader(line);
    assert.equal(header?.kind, 'Verse', line);
    assert.equal(Number(header.number), 1, line);
  }
  assert.deepEqual(parseLyrics('VERSE 1:\nA').stanzas.map((s) => s.stanzaType), ['Verse 1']);
  assert.deepEqual(parseLyrics('Verse 1\nA').stanzas.map((s) => s.stanzaType), ['Verse 1']);
  assert.deepEqual(parseLyrics('[V1]\nA').stanzas.map((s) => s.stanzaType), ['Verse 1']);
});

test('CHORUS: and Refrain are both Chorus', () => {
  assert.equal(sectionHeader('CHORUS:')?.kind, 'Chorus');
  assert.equal(sectionHeader('Refrain')?.kind, 'Chorus');
  assert.deepEqual(parseLyrics('Refrain\nLa la').stanzas, [{ stanzaType: 'Chorus', lyricsText: 'La la' }]);
});

test('Bridge, Tag and Outro are headers in both forms', () => {
  assert.equal(sectionHeader('Bridge')?.kind, 'Bridge');
  assert.equal(sectionHeader('[T]')?.kind, 'Tag');
  assert.equal(sectionHeader('OUTRO.')?.kind, 'Outro');
});

test('the short forms are not headers: a lyric line that is only C stays a lyric line', () => {
  assert.equal(sectionHeader('C'), null);
  assert.equal(sectionHeader('V1'), null);
  assert.deepEqual(parseLyrics('C').stanzas, [{ stanzaType: 'Verse 1', lyricsText: 'C' }]);
});

test('an unknown bracket tag is still reported, as before', () => {
  const { errors } = parseLyrics('[X2]\nA');
  assert.deepEqual(errors, ['Unknown tag [X2]. Use [V1], [C], [B], [T], or [O].']);
});

test('bracket-tag sheets parse as they did', () => {
  const { stanzas } = parseLyrics('[V1]\nA\nB\n\n[C]\nC1\n\n[V2]\nD');
  assert.deepEqual(stanzas, [
    { stanzaType: 'Verse 1', lyricsText: 'A\nB' },
    { stanzaType: 'Chorus', lyricsText: 'C1' },
    { stanzaType: 'Verse 2', lyricsText: 'D' },
  ]);
});

test('a sheet with no headers still splits on blank lines', () => {
  const { stanzas } = parseLyrics('A\nB\n\nC');
  assert.deepEqual(stanzas, [
    { stanzaType: 'Verse 1', lyricsText: 'A\nB' },
    { stanzaType: 'Verse 2', lyricsText: 'C' },
  ]);
});
