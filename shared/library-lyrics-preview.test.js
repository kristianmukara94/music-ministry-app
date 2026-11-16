// The Library's Show Lyrics preview and Edit Song button on Praise & Worship song cards. Synthetic text only.
// Run with: node --test shared/library-lyrics-preview.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { highlightParts } from './text-highlight.js';
import { pwT } from './pw-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the search phrase is marked wherever it occurs, in any letter case, and the line is otherwise unchanged', () => {
  const line = 'Sample lyric line 1, sample LYRIC line 2';
  const parts = highlightParts(line, 'sample lyric');
  assert.deepEqual(parts, [
    { text: 'Sample lyric', match: true },
    { text: ' line 1, ', match: false },
    { text: 'sample LYRIC', match: true },
    { text: ' line 2', match: false },
  ]);
  assert.equal(parts.map((p) => p.text).join(''), line);
});

test('a blank or missing search marks nothing, and an empty line gives no parts', () => {
  assert.deepEqual(highlightParts('Sample lyric line 1', '  '), [{ text: 'Sample lyric line 1', match: false }]);
  assert.deepEqual(highlightParts('Sample lyric line 1', 'absent'), [{ text: 'Sample lyric line 1', match: false }]);
  assert.deepEqual(highlightParts('', 'sample'), []);
});

test('Show Lyrics and Edit Song on a song card never tick the card or add the song', () => {
  const card = read('src/praise-worship/SongSearchResultCard.tsx');
  // Both buttons stop the click before it reaches the card, whose click ticks it.
  assert.match(card, /onClick=\{\(e\) => \{\s+e\.stopPropagation\(\);\s+lyrics\.onToggle\(\);\s+\}\}/);
  assert.match(card, /onClick=\{\(e\) => \{\s+e\.stopPropagation\(\);\s+lyrics\.onEdit\(\);\s+\}\}/);
  assert.match(card, /aria-expanded=\{lyrics\.open\}/);
  assert.match(card, /\{lyrics\?\.open && lyrics\.preview\}/);
  // The open preview keeps its clicks and drags to itself.
  const preview = read('src/praise-worship/SongLyricsPreview.tsx');
  assert.match(preview, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(preview, /onMouseDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(preview, /onDragStart=\{\(e\) => \{\s+e\.preventDefault\(\);\s+e\.stopPropagation\(\);/);
});

test('the preview shows every stanza under its section badge, with the search marked, and Edit Song and Add to Segment under them', () => {
  const preview = read('src/praise-worship/SongLyricsPreview.tsx');
  assert.match(preview, /hymn\.stanzas\.map\(\(s\) =>/);
  assert.match(preview, /\{s\.stanzaType\}<\/span>/);
  assert.match(preview, /<Marked text=\{s\.lyricsText\} query=\{query\} \/>/);
  assert.match(preview, /max-h-56 overflow-y-auto rounded-lg border border-line-strong bg-surface-2 p-3/);
  assert.match(preview, /onClick=\{onEdit\}[^>]*>\s+<PenLine[^>]*\/>\s+\{t\('editSong'\)\}/);
  assert.match(preview, /onClick=\{onAdd\} disabled=\{!canAdd\}[^>]*>\s+<Plus[^>]*\/>\s+\{t\('addToSegment'\)\}/);
  // The container hands the preview the row's own Add, the same one the Add button uses, and opens one preview per card.
  const container = read('src/praise-worship/LibrarySearchContainer.tsx');
  assert.match(container, /<SongLyricsPreview hymnId=\{hymnId\} query=\{query\} t=\{t\} canAdd=\{canInsert\(row\)\} onAdd=\{\(\) => row\.insert\(\)\} onEdit=\{edit\} \/>/);
  assert.match(container, /open\.includes\(key\) \? open\.filter\(\(k\) => k !== key\) : \[\.\.\.open, key\]/);
});

test('Edit Song opens the Edit Hymn form with that song, over the planner', () => {
  const lib = read('src/praise-worship/Library.tsx');
  assert.match(lib, /bridge\.lyrics\s+\.getHymn\(hymnId\)\s+\.then\(\(h\) => \(h \? setEditing\(h\)/);
  assert.match(lib, /<AddSongModal key=\{editing\.id\} hymn=\{editing\}/);
  assert.match(lib, /createPortal\(/);
  assert.match(lib, /onEditSong=\{editSong\}/);
  assert.match(lib, /query=\{query\}/);
});

test('a save refreshes the preview, the Library list and the lineup cards that use the song', () => {
  // The preview reads the song again on every library revision.
  assert.match(read('src/praise-worship/SongLyricsPreview.tsx'), /\}, \[hymnId, revision\]\);/);
  // A save in any window tells every window; the planner re-reads the song it holds and bumps the revision.
  const store = read('src/praise-worship/store.ts');
  assert.match(store, /liveLyrics\.onChanged\(\(id\) => void songChanged\(id\)\);/);
  assert.match(store, /hymns: withHymn\(s\.hymns, id, hymnAfterChange\(fresh\)\)/);
  assert.match(store, /libraryRevision: s\.libraryRevision \+ 1/);
  // The lineup's slides are built with the song's font scale.
  assert.match(store, /style: h\.style \?\? null, fontScale: h\.fontScale \}/);
  assert.match(read('electron/main.js'), /win\.webContents\.send\('lyrics:changed', id\)/);
});

test('Show Lyrics, Hide Lyrics and Edit Song read in English, Tagalog and Cebuano', () => {
  const want = {
    en: ['Show Lyrics', 'Hide Lyrics', 'Edit Song'],
    tl: ['Ipakita ang Lyrics', 'Itago ang Lyrics', 'I-edit ang Kanta'],
    ceb: ['Ipakita ang Lyrics', 'Tagoa ang Lyrics', 'Usba ang Kanta'],
  };
  for (const [lang, labels] of Object.entries(want)) assert.deepEqual(['showLyrics', 'hideLyrics', 'editSong'].map((k) => pwT(lang, k)), labels, lang);
  for (const key of ['addToSegment', 'lyricsLoading', 'lyricsMissing', 'lyricsEmpty']) {
    for (const lang of ['tl', 'ceb']) assert.notEqual(pwT(lang, key), pwT('en', key), `${key} ${lang}`);
  }
});
