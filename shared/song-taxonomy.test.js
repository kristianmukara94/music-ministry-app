// The song taxonomy: which scopes a song category is suggested for, how a dropdown groups the names, and which songs a filter lets through.
// Run with: node --test shared/song-taxonomy.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MASS_PART_NAMES,
  PRIMARY_CATEGORIES,
  THEME_NAMES,
  groupCategories,
  normalizePrimary,
  scopesOfCategory,
  scopesShownBy,
  songShownIn,
  suggestedFor,
} from './song-taxonomy.js';
import { lyT } from './lyrics-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the scopes are General, Mass and Praise & Worship, and the shipped themes are the seven the ministry uses', () => {
  assert.deepEqual(PRIMARY_CATEGORIES, ['GENERAL', 'MASS', 'PRAISE_AND_WORSHIP']);
  assert.deepEqual(THEME_NAMES, ['Joyful Song', 'Worship Song', 'Repentance Song', 'Thanksgiving Song', 'Healing Song', 'Offertory Song', 'Marian Song']);
  assert.ok(MASS_PART_NAMES.includes('Entrance Procession') && MASS_PART_NAMES.includes('Recessional'));
});

test('a scope suggests its own categories: Mass the Mass parts, Offertory and Marian songs; Praise & Worship the joyful, worship, repentance and healing ones', () => {
  for (const name of ['Offertory Song', 'Marian Song', 'Communion Procession', 'Gloria']) assert.ok(suggestedFor('MASS', name), name);
  for (const name of ['Joyful Song', 'Worship Song', 'Repentance Song', 'Healing Song']) assert.ok(suggestedFor('PRAISE_AND_WORSHIP', name), name);
  assert.equal(suggestedFor('PRAISE_AND_WORSHIP', 'Marian Song'), false);
  assert.equal(suggestedFor('MASS', 'Joyful Song'), false);
  assert.equal(suggestedFor('MASS', 'gloria'), true, 'letter case does not count');
});

test('General suggests every category, and a category the operator added suits every scope', () => {
  assert.ok(THEME_NAMES.every((name) => suggestedFor('GENERAL', name)));
  assert.deepEqual(scopesOfCategory('Youth Night'), PRIMARY_CATEGORIES);
  assert.ok(suggestedFor('MASS', 'Youth Night') && suggestedFor('PRAISE_AND_WORSHIP', 'Youth Night'));
});

test('the dropdown groups the suggested names first and drops none', () => {
  const names = ['Joyful Song', 'Marian Song', 'Gloria', 'Healing Song', 'Youth Night'];
  const mass = groupCategories(names, 'MASS');
  assert.deepEqual(mass.suggested, ['Marian Song', 'Gloria', 'Youth Night']);
  assert.deepEqual(mass.other, ['Joyful Song', 'Healing Song']);
  assert.deepEqual(groupCategories(names, 'GENERAL').other, []);
  for (const scope of PRIMARY_CATEGORIES) {
    const g = groupCategories(names, scope);
    assert.equal(g.suggested.length + g.other.length, names.length);
  }
});

test('a filter keeps Mass and Praise & Worship apart, lets General songs through, and General shows all', () => {
  assert.deepEqual(scopesShownBy('MASS'), ['MASS', 'GENERAL']);
  assert.deepEqual(scopesShownBy('PRAISE_AND_WORSHIP'), ['PRAISE_AND_WORSHIP', 'GENERAL']);
  assert.equal(scopesShownBy('GENERAL'), null);
  assert.equal(songShownIn('MASS', 'PRAISE_AND_WORSHIP'), false);
  assert.equal(songShownIn('PRAISE_AND_WORSHIP', 'MASS'), false);
  assert.equal(songShownIn('MASS', 'GENERAL'), true);
  assert.equal(songShownIn('GENERAL', 'MASS'), true);
  assert.equal(songShownIn('MASS', 'garbage'), true, 'an unreadable stored scope counts as General');
  assert.equal(normalizePrimary('nope'), 'GENERAL');
});

test('the pages: one dropdown pair is used in the song form, the batch import, both filters, and scopes are labelled in all three languages', () => {
  assert.match(read('src/lyrics/AddSongModal.tsx'), /<CategorySelectGroup/);
  assert.match(read('src/lyrics/BatchImportView.tsx'), /<CategorySelectGroup/);
  assert.match(read('src/lyrics/SongLyrics.tsx'), /<SongFilterBar/);
  assert.match(read('src/lyrics/SongFilterBar.tsx'), /<CategorySelectGroup/);
  assert.match(read('src/praise-worship/Library.tsx'), /<CategorySelectGroup/);
  assert.match(read('src/lyrics/SongLyrics.tsx'), /useSongFilter\(/);
  assert.match(read('src/praise-worship/Library.tsx'), /useSongFilter\(/);
  assert.match(read('src/lyrics/CategorySelectGroup.tsx'), /<optgroup/);
  for (const lang of ['en', 'tl', 'ceb']) {
    for (const key of ['scope_GENERAL', 'scope_MASS', 'scope_PRAISE_AND_WORSHIP', 'scopeField', 'suggestedFor', 'otherCategories']) {
      assert.notEqual(lyT(lang, key, { scope: 'x' }), key, `${lang}.${key}`);
    }
  }
});
