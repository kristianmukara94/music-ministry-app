// The Holy Mass planner's Library: the song category filter, the Show Lyrics drawer and Edit Song on song cards, and the sticky panel.
// Synthetic song text only. Run with: node --test shared/planner-library.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { songSlotFor } from './planner-library.js';
import { categoriesOf, hasCategory } from './song-filing.js';
import { plannerT } from './planner-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const planner = read('src/planner/MassPlanner.tsx');
const drawer = read('src/planner/PlannerSongDrawer.tsx');

const SLOTS = [
  { id: 'one', kind: 'song', songCategory: 'Sample Category C' },
  { id: 'spoken', kind: 'text' },
  { id: 'two', kind: 'song', songCategory: 'Sample Category B' },
  { id: 'three', kind: 'song', songCategory: 'Sample Category A' },
];

test('a song filed under two categories is listed under either of them', () => {
  const categories = categoriesOf('Sample Category A', JSON.stringify(['Sample Category A', 'Sample Category B']));
  assert.deepEqual(categories, ['Sample Category A', 'Sample Category B']);
  assert.equal(hasCategory(categories, 'Sample Category A'), true);
  assert.equal(hasCategory(categories, 'sample category b'), true);
  assert.equal(hasCategory(categories, 'Sample Category C'), false);
  // The planner sends the chosen category to the hymn query, which matches the primary column or any entry of categories_json.
  assert.match(planner, /bridge\.lyrics\.listHymns\(\{ search: query, songCategory, primaryCategory: songScope \}\)/);
  const lyrics = read('electron/lyrics.js');
  assert.match(lyrics, /h\.song_category = @songCategory COLLATE NOCASE\s+OR EXISTS \(SELECT 1 FROM json_each\(CASE WHEN json_valid\(h\.categories_json\) THEN h\.categories_json END\) c/);
});

test('Add puts a song in the first empty slot of one of its categories, then the first empty song slot, and nowhere once all are filled', () => {
  assert.equal(songSlotFor([], ['Sample Category A', 'Sample Category B'], SLOTS).id, 'two');
  assert.equal(songSlotFor([{ slot: 'two' }], ['Sample Category A', 'Sample Category B'], SLOTS).id, 'three');
  assert.equal(songSlotFor([], ['sample category a'], SLOTS).id, 'three');
  // No slot of its categories is empty: the first empty song slot. A spoken slot never takes a song.
  assert.equal(songSlotFor([{ slot: 'three' }], ['Sample Category A'], SLOTS).id, 'one');
  assert.equal(songSlotFor([], undefined, SLOTS).id, 'one');
  assert.equal(songSlotFor([{ slot: 'one' }, { slot: 'two' }, { slot: 'three' }], ['Sample Category A'], SLOTS), null);
});

test('the category filter is always on the Lyrics tab, follows the scope, and can be cleared', () => {
  assert.doesNotMatch(planner, /choosing != null && tab === 'lyrics'/);
  assert.match(planner, /\{tab === 'lyrics' && \(\n\s+<div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">/);
  assert.match(planner, /<option value="">\{t\('songCategoryAll'\)\}<\/option>/);
  assert.match(planner, /\.filter\(\(c\) => c\.name === songFilter \|\| suggestedFor\(songScope, c\.name, songCategoryModes\)\)/);
  assert.match(planner, /bg-surface-2 px-2 text-sm text-fg/);
  assert.match(planner, /\{songFilter && \(\n\s+<button\n\s+type="button"\n\s+onClick=\{\(\) => setSongFilter\(''\)\}\n\s+aria-label=\{t\('songCategoryClear'\)\}/);
  // The scope toggle is kept.
  assert.match(planner, /role="radiogroup" aria-label=\{t\('songScopeLabel'\)\}/);
});

test('a song card shows its category badges, Show Lyrics and Edit Song, neither of which picks the card', () => {
  assert.match(planner, /hymnId: h\.id,\n\s+\/\/[^\n]*\n\s+categories: h\.categories,/);
  assert.match(planner, /\{item\.categories\.map\(\(c\) => \(/);
  assert.match(planner, /onClick=\{\(e\) => \{\n\s+e\.stopPropagation\(\);\n\s+toggleLyrics\(hymnId\);\n\s+\}\}/);
  assert.match(planner, /onClick=\{\(e\) => \{\n\s+e\.stopPropagation\(\);\n\s+editSong\(hymnId\);\n\s+\}\}/);
  assert.match(planner, /onClick=\{\(e\) => \{\n\s+e\.stopPropagation\(\);\n\s+target\.add\?\.\(\);\n\s+\}\}/);
  assert.match(planner, /aria-expanded=\{lyricsOpen\}/);
  assert.match(planner, /\{lyricsOpen \? <EyeOff size=\{14\} aria-hidden \/> : <Eye size=\{14\} aria-hidden \/>\}/);
  assert.match(planner, /<PenLine size=\{14\} aria-hidden \/>/);
});

test('the lyrics drawer shows each stanza under its badge with the search marked, and Edit Song and Add under them', () => {
  assert.match(drawer, /hymn\.stanzas\.map\(\(s\) =>/);
  assert.match(drawer, /\{s\.stanzaType\}<\/span>/);
  assert.match(drawer, /<Marked text=\{s\.lyricsText\} query=\{query\} \/>/);
  assert.match(drawer, /highlightParts\(text, query\)/);
  assert.match(drawer, /max-h-56 overflow-y-auto rounded-lg border border-line-strong bg-surface-2 p-3/);
  assert.match(drawer, /onClick=\{onEdit\}[^>]*>\s+<PenLine[^>]*\/>\s+\{t\('libEditSong'\)\}/);
  assert.match(drawer, /onClick=\{onAdd\} disabled=\{!canAdd \|\| !hymn\}/);
  // Clicks and drags inside the drawer stay inside it.
  assert.match(drawer, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(drawer, /onDragStart=\{\(e\) => \{\s+e\.preventDefault\(\);\s+e\.stopPropagation\(\);/);
  assert.match(planner, /<PlannerSongDrawer\n\s+hymnId=\{hymnId\}\n\s+query=\{query\}\n\s+revision=\{lyricsRevision\}/);
});

test('Edit Song opens the Edit Hymn form on document.body, and a save refreshes the drawer, the library and the plan', () => {
  assert.match(planner, /bridge\.lyrics\n\s+\.getHymn\(hymnId\)\n\s+\.then\(\(h\) => \(h \? setEditing\(h\)/);
  assert.match(planner, /createPortal\(\n\s+<AddSongModal key=\{editing\.id\} hymn=\{editing\}[^\n]*\/>,\n\s+document\.body,/);
  // lyrics:changed bumps the revision: the library search, the plan's song rows and the drawer all depend on it.
  assert.match(planner, /bridge\.lyrics\.onChanged\(\(\) => setLyricsRevision\(\(n\) => n \+ 1\)\)/);
  assert.match(planner, /songScope, lyricsRevision, massOrderRevision/);
  assert.match(planner, /\}, \[items, lyricsRevision\]\);/);
  assert.match(drawer, /\}, \[hymnId, revision\]\);/);
  // The song on the projector is re-read by the live song editor on the same broadcast.
  assert.match(read('src/live/liveSongEdits.ts'), /bridge\.lyrics\.onChanged\(handler\)/);
});

test('the Library panel is sticky on wide screens and only its result list scrolls', () => {
  assert.match(planner, /<section data-planner-library className="[^"]*\bxl:sticky xl:top-4 xl:self-start xl:max-h-\[calc\(100vh-9rem\)\][^"]*"/);
  assert.match(planner, /<section data-planner-library className="flex min-h-\[480px\] flex-col overflow-hidden/);
  assert.match(planner, /<ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">/);
  // The search and filters above the list, and the hint below it, never shrink away.
  assert.match(planner, /<div className="flex shrink-0 flex-col gap-3 border-b border-line p-4">/);
  assert.match(planner, /<p className="shrink-0 border-t border-line p-3 text-\[11px\] text-muted">\{t\('dragHintLeft'\)\}<\/p>/);
  // The grid lets the column sit at the top rather than stretch to the plan's height.
  assert.match(planner, /grid min-h-0 flex-1 grid-cols-1 items-start gap-5/);
});

test('the Library words read in English, Tagalog and Cebuano', () => {
  const want = {
    en: ['All categories', 'Song category', 'Show Lyrics', 'Hide Lyrics', 'Edit Song'],
    tl: ['Lahat ng kategorya', 'Kategorya ng awit', 'Ipakita ang Lyrics', 'Itago ang Lyrics', 'I-edit ang Kanta'],
    ceb: ['Tanang kategoriya', 'Kategoriya sa kanta', 'Ipakita ang Lyrics', 'Tagoa ang Lyrics', 'Usba ang Kanta'],
  };
  const keys = ['songCategoryAll', 'songFilterLabel', 'libShowLyrics', 'libHideLyrics', 'libEditSong'];
  for (const [lang, labels] of Object.entries(want)) assert.deepEqual(keys.map((k) => plannerT(lang, k)), labels, lang);
  for (const key of ['songCategoryClear', 'libAddToSlot', 'libAddNoSlot', 'libAddToStep', 'libLyricsLoading', 'libLyricsMissing', 'libLyricsEmpty']) {
    for (const lang of ['tl', 'ceb']) assert.notEqual(plannerT(lang, key), plannerT('en', key), `${key} ${lang}`);
  }
  assert.equal(plannerT('en', 'libAddToSlot', { slot: 'Sample Slot' }), 'Add to Sample Slot');
});
