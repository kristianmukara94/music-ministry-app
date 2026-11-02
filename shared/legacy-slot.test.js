// The legacy Mass slot follows from a song's scope and song category, so the song form asks for two dropdowns, not three.
// Run with: node --test shared/legacy-slot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MASS_SLOTS, deriveLegacyMassSlot, legacyCategoryFor, scopeForLegacy } from './song-taxonomy.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the Mass slot follows from the scope and the song category, and a song with none gets General', () => {
  assert.deepEqual(MASS_SLOTS, ['Entrance', 'Offertory', 'Communion', 'Recessional']);
  assert.equal(deriveLegacyMassSlot('MASS', 'Entrance Procession'), 'Entrance');
  assert.equal(deriveLegacyMassSlot('MASS', 'Offertory Song'), 'Offertory');
  assert.equal(deriveLegacyMassSlot('MASS', 'Preparation of the Gifts'), 'Offertory');
  assert.equal(deriveLegacyMassSlot('MASS', 'Communion Procession'), 'Communion');
  assert.equal(deriveLegacyMassSlot('MASS', 'recessional'), 'Recessional', 'letter case does not count');
  assert.equal(deriveLegacyMassSlot('MASS', 'Gloria'), null, 'a Mass part with no slot of its own');
  assert.equal(deriveLegacyMassSlot('MASS', 'Marian Song'), null);
  assert.equal(deriveLegacyMassSlot('MASS', ''), null);
  assert.equal(deriveLegacyMassSlot('GENERAL', 'Recessional'), 'Recessional', 'General songs are sung at Mass too');
  assert.equal(deriveLegacyMassSlot('PRAISE_AND_WORSHIP', 'Offertory Song'), null, 'a Praise & Worship song fits no Mass slot');
  assert.equal(legacyCategoryFor('MASS', 'Gloria'), 'General');
  assert.equal(legacyCategoryFor('MASS', 'Recessional'), 'Recessional');
});

test('a song from a file or library with no scope is read as Mass when it has a Mass slot or part, else General', () => {
  assert.equal(scopeForLegacy('Entrance', ''), 'MASS');
  assert.equal(scopeForLegacy('General', 'Gloria'), 'MASS');
  assert.equal(scopeForLegacy('General', 'Youth Night'), 'GENERAL');
  assert.equal(scopeForLegacy('General', ''), 'GENERAL');
  assert.equal(scopeForLegacy(undefined, undefined), 'GENERAL');
});

test('the song form asks for two category dropdowns: the Mass slot dropdown is gone from the form and the batch import', () => {
  const modal = read('src/lyrics/AddSongModal.tsx');
  assert.doesNotMatch(modal, /set\('category'/);
  assert.doesNotMatch(modal, /fieldCategory/);
  assert.match(modal, /<CategorySelectGroup/);
  assert.doesNotMatch(read('src/lyrics/BatchImportView.tsx'), /defaults\.category/);
  assert.doesNotMatch(read('src/lyrics/useSongEditor.ts'), /^\s+category: HymnCategory;/m);
});

test('a category is listed under one scope in a grouped dropdown: its first suggested scope, or General for one the operator added', async () => {
  const { homeScopeOfCategory } = await import('./song-taxonomy.js');
  assert.equal(homeScopeOfCategory('Joyful Song'), 'PRAISE_AND_WORSHIP');
  assert.equal(homeScopeOfCategory('Repentance Song'), 'PRAISE_AND_WORSHIP');
  assert.equal(homeScopeOfCategory('Marian Song'), 'MASS');
  assert.equal(homeScopeOfCategory('Offertory Song'), 'MASS');
  assert.equal(homeScopeOfCategory('Gloria'), 'MASS');
  assert.equal(homeScopeOfCategory('Youth Night'), 'GENERAL');
});
