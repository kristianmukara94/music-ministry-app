// The shared lineups and the song picker's categories: the laptop's template is built from them, the website has the same file, the Holy
// Mass parts match the slots, and the picker keeps Holy Mass and Praise & Worship songs apart.
// Run with: node --test shared/lineup-templates.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL_CATEGORIES,
  MASS_LINEUP,
  PICKER_CATEGORIES,
  PW_LINEUP,
  PW_SEGMENT_KEYS,
  SERVICE_TYPES,
  filterPickerSongs,
  pickerCategoryForName,
  pickerCategoryLabel,
  pickerFilterOf,
  pickerPillsFor,
  scopesOfServiceType,
  serviceTypeOfPlanKind,
  songInPickerCategory,
  songInServiceType,
} from './lineup-templates.js';
import { DEFAULT_TEMPLATE, GOSPEL_ACCLAMATION, typesFor } from './pw.js';
import { MASS_SECTIONS, MASS_SLOTS, slotsOfSection } from './mass-slots.js';
import { MASS_PART_NAMES, THEME_CATEGORIES, scopesShownBy } from './song-taxonomy.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// ---- One definition ----

test('the website has the same file, byte for byte', () => {
  assert.equal(read('web/js/lineup-templates.js'), read('shared/lineup-templates.js'), 'copy shared/lineup-templates.js over web/js/lineup-templates.js');
  assert.doesNotMatch(read('shared/lineup-templates.js'), /^\s*import\s/m, 'it imports nothing, so the copy runs on the website as it is');
});

test("the laptop's Praise & Worship template is the lineup, with the content each slot starts with", () => {
  // The template as it was written out before it was built from the shared lineup. Nothing about it may move.
  assert.deepEqual(DEFAULT_TEMPLATE, {
    name: 'Praise & Worship Night',
    groups: [
      { key: 'opening', name: 'Opening' },
      { key: 'praise', name: 'Praise & Worship' },
      { key: 'word', name: 'Word & Offering' },
    ],
    segments: [
      { key: 'prayer_authority', group: 'opening', name: 'Prayer to Take Authority', type: 'prayer', minutes: 3, content: { kind: 'prayer', noteId: null } },
      { key: 'consecration_mary', group: 'opening', name: 'Consecration to Mary, Our Lady of Nazareth', type: 'prayer', minutes: 3, content: { kind: 'prayer', noteId: null } },
      { key: 'marian_song', group: 'opening', name: 'Marian Song', type: 'song', minutes: 5, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
      { key: 'bible_enthronement', group: 'opening', name: 'Bible Enthronement', type: 'scripture', types: ['scripture', 'song'], minutes: 4, content: { kind: 'title' } },
      { key: 'joyful_song', group: 'praise', name: 'Joyful Song', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
      { key: 'worship', group: 'praise', name: 'Worship', type: 'song', minutes: 15, content: { kind: 'song', hymnIds: [], maxSongs: 3, category: null } },
      { key: 'repentance', group: 'praise', name: 'Repentance', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
      { key: 'holy_spirit', group: 'praise', name: 'Holy Spirit', type: 'song', minutes: 8, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
      { key: 'gospel_acclamation', group: 'word', name: 'Gospel Acclamation', type: 'scripture', types: ['scripture', 'song'], minutes: 3, content: { kind: 'lectionary', readingType: GOSPEL_ACCLAMATION } },
      { key: 'offertory', group: 'word', name: 'Offertory', type: 'song', minutes: 6, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: 'Offertory' } },
      { key: 'thanksgiving', group: 'word', name: 'Thanksgiving', type: 'song', minutes: 6, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
      { key: 'finale', group: 'word', name: 'Finale', type: 'song', minutes: 5, content: { kind: 'song', hymnIds: [], maxSongs: 1, category: null } },
    ],
  });
  assert.deepEqual(typesFor({ key: 'bible_enthronement', type: 'scripture' }), ['scripture', 'song']);
  // The template is its own copy: changing one never changes the shared lineup.
  assert.notEqual(DEFAULT_TEMPLATE.groups[0], PW_LINEUP.groups[0]);
});

test('the Praise & Worship lineup is twelve slots in three groups of four, each with a key the website can number further items after', () => {
  assert.equal(PW_LINEUP.segments.length, 12);
  assert.deepEqual(PW_LINEUP.groups.map((g) => PW_LINEUP.segments.filter((s) => s.group === g.key).length), [4, 4, 4]);
  assert.equal(new Set(PW_SEGMENT_KEYS).size, 12);
  // A plan item's key is at most 20 characters on the server, and a second item is "<key>.2".
  for (const key of PW_SEGMENT_KEYS) assert.ok(key.length <= 18 && /^[a-z_]+$/.test(key), key);
  for (const slot of PW_LINEUP.segments.filter((s) => s.type === 'song')) {
    assert.ok(PICKER_CATEGORIES.praise_worship.some((c) => c.id === slot.pickerCategory), `${slot.key} opens on a category the picker has`);
  }
});

test('the Holy Mass lineup is the four parts of the Mass, with every slot once and in the order the planner shows', () => {
  assert.deepEqual(MASS_LINEUP.map((part) => [part.number, part.name]), MASS_SECTIONS.map((section) => [section.number, section.name]));
  assert.deepEqual(MASS_LINEUP.map((part) => part.slots), MASS_SECTIONS.map((section) => slotsOfSection(section.id).map((slot) => slot.number)));
  assert.deepEqual(MASS_LINEUP.flatMap((part) => part.slots), MASS_SLOTS.map((slot) => slot.number));
  // The website's own copy of the slots follows the same order.
  const web = read('web/js/mass-slots.js');
  const webNumbers = [...web.matchAll(/^\s*\{ number: (\d+), group:/gm)].map((m) => Number(m[1]));
  assert.deepEqual(webNumbers, MASS_LINEUP.flatMap((part) => part.slots));
});

// ---- The song picker ----

const SONGS = [
  { id: 'a', title: 'Come, Now Is the Time', category: 'Joyful Song', scope: 'PRAISE_AND_WORSHIP' },
  { id: 'b', title: 'Here I Am to Worship', category: 'Worship Song', scope: 'PRAISE_AND_WORSHIP' },
  { id: 'c', title: 'Healing Rain', category: 'Healing Song', scope: 'PRAISE_AND_WORSHIP' },
  { id: 'd', title: 'Gloria, setting one', category: 'Gloria', scope: 'MASS' },
  { id: 'e', title: 'Take and Receive', category: 'Preparation of the Gifts', scope: 'MASS' },
  { id: 'f', title: 'Joyful, Joyful', category: 'Entrance Procession', scope: 'GENERAL' },
  { id: 'g', title: 'An older song', category: 'General' },
];
const ids = (list) => list.map((song) => song.id).join('');

test('a plan opens the picker on its own service type', () => {
  assert.deepEqual(SERVICE_TYPES.map((t) => [t.id, t.planKind, t.label]), [['mass', 'mass', 'Holy Mass'], ['praise_worship', 'pw', 'Praise & Worship']]);
  assert.equal(serviceTypeOfPlanKind('pw'), 'praise_worship');
  assert.equal(serviceTypeOfPlanKind('mass'), 'mass');
  assert.equal(serviceTypeOfPlanKind(null), 'mass', 'a plan with no kind opens as a Holy Mass plan');
});

test('the two tabs never mix: each lists its own songs and the General ones, as the laptop library does', () => {
  for (const type of SERVICE_TYPES) assert.deepEqual(scopesOfServiceType(type.id), scopesShownBy(type.scope));
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'mass' })), 'defg');
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'praise_worship' })), 'abcfg');
  assert.equal(songInServiceType({ scope: 'MASS' }, 'praise_worship'), false);
  assert.equal(songInServiceType({}, 'praise_worship'), true, 'a song with no scope is General');
});

test('a category narrows the tab, and the search narrows the category', () => {
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'praise_worship', category: 'joyful' })), 'a');
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'mass', category: 'offertory' })), 'e');
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'mass', category: 'entrance' })), 'f', 'a General song is under its own category in each tab');
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'praise_worship', category: ALL_CATEGORIES, query: 'JOYFUL' })), 'f');
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'praise_worship', category: 'joyful', query: 'joyful' })), '', 'the title is searched, not the category');
  assert.equal(ids(filterPickerSongs(SONGS, { serviceType: 'praise_worship', category: 'Healing Song' })), 'c', "a song category's own name works as a category");
  assert.equal(songInPickerCategory({ category: '  worship song ' }, 'praise_worship', 'worship'), true, 'letter case and spaces do not matter');
});

test('the category buttons are All, the picker categories, then the categories only this church uses, each with its count', () => {
  const pills = pickerPillsFor(SONGS, 'praise_worship');
  assert.deepEqual(pills.map((p) => p.id), ['all', 'joyful', 'worship', 'repentance', 'holy_spirit', 'marian', 'offertory', 'thanksgiving', 'finale', 'General', 'Healing Song']);
  assert.deepEqual(pills.filter((p) => p.count).map((p) => [p.label, p.count]), [['All Praise & Worship', 5], ['Joyful / Fast Praise', 1], ['Worship / Slow Worship', 1], ['General', 1], ['Healing Song', 1]]);
  // A General song filed under a part of the Mass is under All here, and has its button under Holy Mass, so the Mass categories stay out of this tab.
  assert.equal(pills.some((p) => p.id === 'Entrance Procession'), false);
  assert.equal(pickerPillsFor(SONGS, 'mass').find((p) => p.id === 'entrance').count, 1);
  // Every song is under a button besides All in at least one tab.
  for (const song of SONGS) {
    const found = SERVICE_TYPES.some((type) => songInServiceType(song, type.id)
      && pickerPillsFor(SONGS, type.id).some((p) => p.id !== ALL_CATEGORIES && songInPickerCategory(song, type.id, p.id)));
    assert.ok(found, song.title);
  }
  assert.deepEqual(pickerPillsFor(SONGS, 'mass', { query: 'gloria' }).filter((p) => p.count).map((p) => [p.id, p.count]), [['all', 1], ['gloria', 1]], 'the counts follow the search');
  assert.equal(pickerCategoryLabel('mass', 'memorial_acclamation'), 'Anamnesis / Acclamation');
  assert.equal(pickerCategoryLabel('mass', 'all'), 'All Holy Mass');
  assert.equal(pickerCategoryLabel('praise_worship', 'Healing Song'), 'Healing Song');
});

test('every song category the laptop ships with has its picker category, so a Holy Mass slot always finds its songs', () => {
  for (const name of MASS_PART_NAMES) assert.ok(pickerCategoryForName('mass', name), `Holy Mass: ${name}`);
  for (const slot of MASS_SLOTS.filter((s) => s.kind === 'song')) assert.ok(pickerCategoryForName('mass', slot.songCategory), slot.name);
  const expected = { 'Joyful Song': 'joyful', 'Worship Song': 'worship', 'Repentance Song': 'repentance', 'Thanksgiving Song': 'thanksgiving', 'Offertory Song': 'offertory', 'Marian Song': 'marian' };
  for (const [name, id] of Object.entries(expected)) assert.equal(pickerCategoryForName('praise_worship', name), id);
  assert.ok(THEME_CATEGORIES.some((c) => c.name === 'Healing Song'));
  assert.equal(pickerCategoryForName('praise_worship', 'Healing Song'), null, 'Healing has no slot in the lineup; it is offered under its own name');
  assert.equal(pickerCategoryForName('mass', ''), null);
  // No name is claimed by two categories of one tab, so a song is under one button only.
  for (const [type, categories] of Object.entries(PICKER_CATEGORIES)) {
    const names = categories.flatMap((c) => c.names);
    assert.equal(new Set(names).size, names.length, type);
    assert.ok(names.every((n) => n === n.toLowerCase().trim()), `${type}: names are lower case`);
  }
});

test('the song API filter: scopes and category names for a service type and a category, and null for a service type that is not one', () => {
  assert.deepEqual(pickerFilterOf(), { scopes: null, names: null }, 'no filter is the whole list');
  assert.deepEqual(pickerFilterOf('praise_worship'), { scopes: ['PRAISE_AND_WORSHIP', 'GENERAL'], names: null });
  assert.deepEqual(pickerFilterOf('praise_worship', 'all'), { scopes: ['PRAISE_AND_WORSHIP', 'GENERAL'], names: null });
  assert.deepEqual(pickerFilterOf('praise_worship', 'joyful').names, PICKER_CATEGORIES.praise_worship[0].names);
  assert.deepEqual(pickerFilterOf('mass', 'Healing Song'), { scopes: ['MASS', 'GENERAL'], names: ['healing song'] });
  assert.equal(pickerFilterOf('vespers', 'joyful'), null);
});
