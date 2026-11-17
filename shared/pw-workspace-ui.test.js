// The Praise & Worship workspace: the pinned Library panel, its Song Category filter, the song titles in the Live lineup, and the Planner's
// separate Liturgical and Praise & Worship calendars. Synthetic data only. Run with: node --test shared/pw-workspace-ui.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lineupSongs, segmentStatus } from './pw.js';
import { calendarForPlan, calendarKind, calendarPlans, PLANNER_CALENDARS, SERVICE_TYPE } from './planner-calendars.js';
import { categoriesOf, hasCategory } from './song-filing.js';
import { pwT } from './pw-i18n.js';
import { plannerT } from './planner-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const library = read('src/praise-worship/Library.tsx');
const results = read('src/praise-worship/LibrarySearchContainer.tsx');
const card = read('src/praise-worship/SongSearchResultCard.tsx');
const planView = read('src/praise-worship/PlanView.tsx');
const liveView = read('src/praise-worship/LiveView.tsx');
const plannerView = read('src/planner/PlannerView.tsx');
const calendarView = read('src/planner/PlannerCalendarView.tsx');

const songCard = (hymnIds) => ({ key: 'sample-slot', name: 'Sample Slot', type: 'song', minutes: 5, content: { kind: 'song', maxSongs: 3, category: null, hymnIds } });
const HYMNS = { 1: { title: 'Sample Song 1' }, 2: { title: 'Sample Song 2' }, 3: { title: 'Sample Song 3' } };

// ── 1. The pinned Library ──

test('the Library panel is pinned in the two-column layout and stops short of the window bottom', () => {
  const panel = library.match(/export const LIBRARY_PANEL =\s+'([^']+)'/)?.[1] ?? '';
  for (const cls of ['flex', 'flex-col', '@4xl/pw:sticky', '@4xl/pw:top-4', '@4xl/pw:self-start', '@4xl/pw:max-h-[calc(100vh-var(--topbar-h,3rem)-2.5rem)]']) {
    assert.ok(panel.split(' ').includes(cls), `the panel has ${cls}`);
  }
  assert.match(library, /<section aria-labelledby="pw-library-heading" data-pw-library className=\{LIBRARY_PANEL\}>/);
  // The header, search, filters and buttons are locked; only the result list scrolls.
  assert.equal(library.match(/<div className="flex shrink-0 flex-col gap-3">/g)?.length, 2, 'a locked block above and below the list');
  assert.match(results, /className="flex max-h-\[60vh\] min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1 @4xl\/pw:max-h-none @4xl\/pw:min-h-40"/);
});

test('the Library column spans the Lineup and the segment editor, so the panel stays pinned past both', () => {
  assert.match(planView, /@4xl\/pw:grid-cols-2 @4xl\/pw:grid-rows-\[auto_1fr\]/);
  assert.match(planView, /data-pw-library-column className="min-w-0 @4xl\/pw:col-start-1 @4xl\/pw:row-span-2 @4xl\/pw:row-start-1 @4xl\/pw:self-stretch"/);
  assert.match(planView, /@4xl\/pw:col-start-2 @4xl\/pw:row-start-1">\s+<LineupRail \/>/);
  assert.match(planView, /@4xl\/pw:col-start-2 @4xl\/pw:row-start-2">\s+<SegmentEditor \/>/);
  // The editor no longer spans both columns, where the pinned panel would cover it.
  assert.doesNotMatch(planView, /@4xl\/pw:col-span-2/);
});

// ── 2. The Song Category filter ──

test('a song filed under several categories matches each of them, whatever the case', () => {
  const categories = categoriesOf('Sample Category A', JSON.stringify(['Sample Category A', 'Sample Category B']));
  assert.deepEqual(categories, ['Sample Category A', 'Sample Category B']);
  assert.equal(hasCategory(categories, 'sample category b'), true);
  assert.equal(hasCategory(categories, 'Sample Category C'), false);
  // The hymn query matches the primary column or any entry of categories_json.
  assert.match(read('electron/lyrics.js'), /OR EXISTS \(SELECT 1 FROM json_each\(CASE WHEN json_valid\(h\.categories_json\) THEN h\.categories_json END\) c/);
  assert.match(read('src/lyrics/useSongFilter.ts'), /songCategory: state\.songCategory\.trim\(\) && state\.songCategory !== ALL_CATEGORIES \? state\.songCategory\.trim\(\) : undefined,/);
});

test('the Praise & Worship Library has a Song Category dropdown, All categories first, with a clear button while one is chosen', () => {
  assert.match(library, /<select\s+id="pw-lib-song-category"\s+value=\{filter\.songCategory\}\s+onChange=\{\(e\) => filter\.setSongCategory\(e\.target\.value\)\}/);
  assert.match(library, /className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 text-xs text-fg/);
  assert.match(library, /<option value="">\{t\('allCategories'\)\}<\/option>/);
  assert.match(library, /\{filter\.songCategory && \(\s+<button\s+type="button"\s+onClick=\{\(\) => filter\.setSongCategory\(''\)\}\s+aria-label=\{t\('clearCategory'\)\}/);
  // The scope still has its own dropdown beside it.
  assert.match(library, /<CategorySelectGroup[\s\S]*?scopeOnly[\s\S]*?idPrefix="pw-lib"/);
});

test('each song card badges every category the song is filed under and highlights the one filtered by', () => {
  assert.match(library, /categories: h\.categories,/);
  assert.match(library, /activeCategory=\{tab === 'song' \? filter\.songCategory : ''\}/);
  assert.match(results, /activeCategory=\{activeCategory\}/);
  assert.match(card, /\{row\.categories\.map\(\(c\) => \(/);
  assert.match(card, /c\.toLowerCase\(\) === activeCategory\.toLowerCase\(\) \? 'border-accent\/60 bg-accent\/15 text-accent' : 'border-line-strong bg-surface-2 text-fg\/80'/);
});

// ── 3. Song titles in the Live lineup ──

test('a lineup row lists its one song, or every chained song in sung order', () => {
  assert.deepEqual(lineupSongs(songCard([2]), HYMNS), [{ id: 2, title: 'Sample Song 2' }]);
  assert.deepEqual(lineupSongs(songCard([3, 1, 2]), HYMNS).map((s) => s.title), ['Sample Song 3', 'Sample Song 1', 'Sample Song 2']);
});

test('a song not loaded yet is left out, and a song card with no song keeps its No song badge', () => {
  assert.deepEqual(lineupSongs(songCard([1, 99]), HYMNS), [{ id: 1, title: 'Sample Song 1' }]);
  assert.deepEqual(lineupSongs(songCard([1]), { 1: { title: '  ' } }), []);
  assert.deepEqual(lineupSongs(songCard([]), HYMNS), []);
  assert.equal(segmentStatus(songCard([])), 'needs_song');
  assert.match(liveView, /\{noSong && <span className="[^"]*">\{t\('noSongBadge'\)\}<\/span>\}/);
});

test('the Live lineup draws each song title and marks the song on air on the current segment', () => {
  assert.match(liveView, /const songs = lineupSongs\(s, hymns\);/);
  assert.match(liveView, /const onAir = current && song\.id === playingHymn;/);
  assert.match(liveView, /data-on-air=\{onAir \|\| undefined\}/);
  assert.match(liveView, /<span className="truncate" title=\{song\.title\}>\{song\.title\}<\/span>/);
  assert.match(liveView, /<LiveLineup session=\{session\} segment=\{segmentIndex\} hymns=\{hymns\} playingHymn=\{playingHymn\} \/>/);
  // The stage's own song list reads the same helper.
  assert.match(liveView, /const songs = segment \? lineupSongs\(segment, hymns\) : \[\];/);
});

// ── 4. Two calendars ──

test('the Liturgical Calendar shows Holy Mass plans only and the Praise & Worship Calendar Praise & Worship sessions only', () => {
  const mass = [{ id: 1, name: 'Sample Plan A', liturgicalDate: '2026-11-22' }];
  const pw = [{ id: 7, name: 'Sample Session B', liturgicalDate: '2026-11-22' }];
  assert.deepEqual(calendarPlans('mass', mass, pw), { mass, pw: [] });
  assert.deepEqual(calendarPlans('pw', mass, pw), { mass: [], pw });
  // Anything else is the Liturgical Calendar, where the Planner opens.
  assert.deepEqual(calendarPlans('other', mass, pw), { mass, pw: [] });
  assert.equal(calendarKind(undefined), 'mass');
  assert.deepEqual(PLANNER_CALENDARS, ['mass', 'pw']);
  assert.deepEqual(SERVICE_TYPE, { mass: 'holy-mass', pw: 'praise-worship' });
  // Back from a plan goes to that plan's own calendar.
  assert.equal(calendarForPlan({ kind: 'pw', id: 7 }), 'pw');
  assert.equal(calendarForPlan({ kind: 'mass', id: 1 }), 'mass');
  assert.equal(calendarForPlan(null), 'mass');
});

test('the Planner header switches between the two calendars and the Plan Editor', () => {
  assert.match(plannerView, /calendar: 'mass',\n\}\)\);/, 'opens on the Liturgical Calendar');
  assert.match(plannerView, /onClick=\{\(\) => showCalendar\('mass'\)\}[\s\S]*?\{t\('viewCalendar'\)\}/);
  assert.match(plannerView, /onClick=\{\(\) => showCalendar\('pw'\)\}[\s\S]*?\{t\('viewPwCalendar'\)\}/);
  assert.match(plannerView, /const shown = calendarPlans\(calendar, massPlans, sessions\);/);
  assert.match(plannerView, /massPlans=\{shown\.mass\}\n\s+pwSessions=\{shown\.pw\}/);
  assert.match(plannerView, /calendar: which \?\? \(active \? calendarForPlan\(active\) : calendar\)/);
  // Each calendar creates only its own kind of plan.
  assert.match(calendarView, /kinds=\{\[kind\]\}/);
  assert.match(calendarView, /\{kinds\.includes\('mass'\) && \(/);
  assert.match(calendarView, /\{kinds\.includes\('pw'\) && \(/);
});

// ── 5. Words ──

test('the new words exist in English, Tagalog and Cebuano', () => {
  for (const lang of ['en', 'tl', 'ceb']) {
    for (const key of ['songCategory', 'allCategories', 'clearCategory', 'songOnAir']) assert.notEqual(pwT(lang, key), key, `${key} in ${lang}`);
    for (const key of ['viewCalendar', 'viewPwCalendar', 'calHintMass', 'calHintPw', 'plannerSubtitleMass', 'plannerSubtitlePw']) assert.notEqual(plannerT(lang, key), key, `${key} in ${lang}`);
  }
  // Cebuano and Tagalog are their own words, not English fallbacks.
  for (const lang of ['tl', 'ceb']) {
    for (const key of ['songCategory', 'allCategories', 'clearCategory', 'songOnAir']) assert.notEqual(pwT(lang, key), pwT('en', key), `${key} in ${lang}`);
    assert.notEqual(plannerT(lang, 'viewPwCalendar'), plannerT('en', 'viewPwCalendar'));
  }
  assert.equal(plannerT('en', 'viewCalendar'), 'Liturgical Calendar');
  assert.equal(plannerT('en', 'viewPwCalendar'), 'Praise & Worship Calendar');
  assert.equal(pwT('en', 'allCategories'), 'All categories');
  assert.equal(pwT('en', 'songCategory'), 'Song category');
});
