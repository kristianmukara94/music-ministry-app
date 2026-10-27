// Tests for the Create and Edit Hymn form's song category check. The form has no rendering test setup in this repo, so these read its source:
// the check runs before anything is sent, the prompt is shown beside the field, the typed title and lyrics are not cleared, and the
// prompt text exists in English, Tagalog and Cebuano. Run with: node --test netlify/functions/test/hymn-category-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lyT } from '../../../shared/lyrics-i18n.js';
import { SONG_CATEGORY_REQUIRED_EN } from '../../../shared/hymn-category.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const modal = fs.readFileSync(path.join(here, '..', '..', '..', 'src', 'lyrics', 'CreateHymnModal.tsx'), 'utf8');
const saveBody = modal.slice(modal.indexOf('const save = async'), modal.indexOf('const save = async') + 1200);

test('the save checks for a song category before anything is sent, for both create and edit', () => {
  const check = saveBody.indexOf('isSongCategoryMissing(songCategory)');
  const send = saveBody.indexOf('api.editHymn');
  assert.ok(check > 0, 'the save checks the category');
  assert.ok(send > check, 'the check comes before the save is sent');
  assert.ok(saveBody.includes('api.createHymn'), 'create goes through the same save');
  assert.match(saveBody.slice(check, check + 120), /setCategoryPrompt\(true\);\s*return;/, 'a missing category shows the prompt and stops');
});

test('the check stops before the form goes busy, so nothing is marked as saving', () => {
  assert.ok(saveBody.indexOf('isSongCategoryMissing(songCategory)') < saveBody.indexOf('setBusy(true)'));
});

test('a refusal from the service shows the same prompt, and keeps the form open with the typed text', () => {
  assert.match(saveBody, /isSongCategoryRefusal\(message\)\)\s*setCategoryPrompt\(true\)/, 'the service refusal shows the prompt');
  assert.match(saveBody, /else setError\(message\)/, 'other errors still show as before');
  // The save path never clears the title, the composer or the lyrics. Only the category prompt changes.
  for (const setter of ['setTitle(', 'setRaw(', 'setComposer(']) {
    assert.equal(saveBody.includes(setter), false, `the save path does not call ${setter}`);
  }
});

test('the prompt is shown beside the category field, and clears when a category is chosen', () => {
  assert.match(modal, /\{categoryPrompt && <span role="alert"[^>]*>\{t\('chooseSongCategory'\)\}<\/span>\}/, 'the prompt sits in the field');
  assert.match(modal, /if \(e\.target\.value\) setCategoryPrompt\(false\)/, 'choosing a category clears it');
  assert.equal(modal.includes(SONG_CATEGORY_REQUIRED_EN), false, 'the English sentence is not hard-coded in the form');
});

test('the prompt text exists in English, Tagalog and Cebuano, and none falls back to English', () => {
  const en = lyT('en', 'chooseSongCategory');
  assert.equal(en, SONG_CATEGORY_REQUIRED_EN);
  for (const lang of ['tl', 'ceb']) {
    const text = lyT(lang, 'chooseSongCategory');
    assert.ok(text && text !== 'chooseSongCategory', `${lang} has the prompt`);
    assert.notEqual(text, en, `${lang} is not the English text`);
  }
});

test('the new Tagalog and Cebuano prompt carries the review marker', () => {
  const strings = fs.readFileSync(path.join(here, '..', '..', '..', 'shared', 'lyrics-i18n.js'), 'utf8');
  const tl = strings.indexOf("chooseSongCategory: 'Pumili");
  const ceb = strings.indexOf("chooseSongCategory: 'Pagpili");
  assert.ok(tl > 0 && ceb > 0);
  assert.match(strings.slice(tl - 200, tl), /Drafted without a native-speaker check/);
  assert.match(strings.slice(ceb - 200, ceb), /Drafted without a native-speaker check/);
});
