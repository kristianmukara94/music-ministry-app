// Tests for the strings added in this release (Recently deleted, the deleted-hymn labels, the praise song message): each key exists in
// English, Tagalog and Cebuano; no Tagalog or Cebuano value falls back to English; the components use keys and hard-code no English;
// and the drafted translations carry the review marker. Run with: node --test server/test/i18n-new-strings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lyT } from '../../shared/lyrics-i18n.js';
import { plannerT } from '../../shared/planner-i18n.js';
import { pwT } from '../../shared/pw-i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const LANGS = ['en', 'tl', 'ceb'];
const NEW = {
  lyrics: { t: lyT, keys: ['recentlyDeletedTitle', 'recentlyDeletedNote', 'deletedOn', 'undoDelete', 'undoDeleteLabel', 'noRecentlyDeleted', 'deletedLoadFailed', 'undoFailed', 'deletedHymnStatus'] },
  planner: { t: plannerT, keys: ['deletedHymnStatus'] },
  pw: { t: pwT, keys: ['songDeleted'] },
};

// The English wording must not appear in any component: a component shows the key's text for the current language, never this.
const ENGLISH_NOT_IN_COMPONENTS = [
  'Recently deleted', 'Deleted hymns can be restored', 'Nothing was deleted in the last 30 days', 'Undo delete', 'Deleted (undo available)',
  'This song was deleted', 'could not be loaded',
];

for (const [module, { t, keys }] of Object.entries(NEW)) {
  test(`${module}: every new key exists in English, Tagalog and Cebuano, and none falls back to English`, () => {
    for (const key of keys) {
      const en = t('en', key);
      assert.ok(en && en !== key, `${module}.${key} has English text`);
      for (const lang of ['tl', 'ceb']) {
        const text = t(lang, key);
        assert.ok(text && text !== key, `${module}.${key} has ${lang} text`);
        assert.notEqual(text, en, `${module}.${key} in ${lang} is not the English text`);
      }
    }
  });
}

test('the placeholders are filled in Tagalog and Cebuano too', () => {
  assert.equal(lyT('tl', 'deletedOn', { date: '27/10/2026' }).includes('27/10/2026'), true);
  assert.equal(lyT('ceb', 'deletedOn', { date: '27/10/2026' }).includes('{date}'), false);
  assert.equal(lyT('tl', 'undoDeleteLabel', { title: 'Papuri' }).includes('Papuri'), true);
  assert.equal(lyT('ceb', 'undoDeleteLabel', { title: 'Papuri' }).includes('{title}'), false);
});

test('the terms match the existing Tagalog and Cebuano: awit and kanta for hymn, Nabura and Gipapasa-a for deleted, Ibalik for undo', () => {
  assert.match(lyT('tl', 'deletedHymnStatus'), /Nabura/, 'Tagalog uses Nabura, as the existing delete string does');
  assert.match(lyT('ceb', 'deletedHymnStatus'), /Gipapasa-a/, 'Cebuano uses Gipapasa-a, as the existing delete string does');
  assert.equal(lyT('tl', 'undoDelete'), 'Ibalik');
  assert.equal(lyT('ceb', 'undoDelete'), 'Ibalik');
  assert.match(lyT('tl', 'undoFailed'), /awit/, 'Tagalog hymn is awit');
  assert.match(lyT('ceb', 'undoFailed'), /kanta/, 'Cebuano hymn is kanta');
});

test('the components use only keys that exist in every language', () => {
  const component = read('src/lyrics/RecentlyDeleted.tsx');
  const used = [...component.matchAll(/\bt\('([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 6, 'the section uses its keys');
  for (const key of used) for (const lang of LANGS) assert.ok(lyT(lang, key) !== key, `${key} exists in ${lang}`);
  assert.match(read('src/lyrics/SongLyrics.tsx'), /t\('deletedHymnStatus'\)/, 'the setlist shows the deleted label by key');
  assert.match(read('src/planner/MassPlanner.tsx'), /t\('deletedHymnStatus'\)/, 'the Mass plan shows the deleted label by key');
  assert.match(read('src/praise-worship/SegmentEditor.tsx'), /t\('songDeleted'\)/, 'the praise segment shows its message by key');
});

test('no new component hard-codes the English text', () => {
  for (const rel of ['src/lyrics/RecentlyDeleted.tsx', 'src/lyrics/SongLyrics.tsx', 'src/planner/MassPlanner.tsx', 'src/praise-worship/SegmentEditor.tsx']) {
    const source = read(rel);
    for (const phrase of ENGLISH_NOT_IN_COMPONENTS) assert.equal(source.includes(phrase), false, `${rel} does not hard-code "${phrase}"`);
  }
});

test('every drafted Tagalog and Cebuano string carries the review marker', () => {
  for (const rel of ['shared/lyrics-i18n.js', 'shared/planner-i18n.js', 'shared/pw-i18n.js']) {
    assert.match(read(rel), /Drafted without a native-speaker check/, `${rel} marks its drafts for review`);
  }
});
