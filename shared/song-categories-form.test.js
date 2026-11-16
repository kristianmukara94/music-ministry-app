// The Song categories form keeps the new-name field typable: after Add (a click or Enter) focus stays in the field and the next name can be
// typed at once. Before this, the clicked Add button was disabled during the save, which threw focus out of the form, and the keys that
// followed were lost until the field was clicked again. Run with: node --test shared/song-categories-form.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/lyrics/SongCategoriesEditor.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const form = source.slice(source.indexOf('<form onSubmit={add}'), source.indexOf('</form>', source.indexOf('<form onSubmit={add}')));

test('the field is cleared and focused before the save returns', () => {
  assert.match(source, /setNewName\(''\);\s+setError\(null\);\s+newInput\.current\?\.focus\(\);\s+try \{\s+const created = await api\.createSongCategory/);
  assert.match(form, /ref=\{newInput\}/);
});

test('nothing in the add form is disabled while a save runs', () => {
  assert.doesNotMatch(form, /disabled=\{busy/);
  // Any plain `disabled=` prop (aria-disabled, which keeps focus, is allowed).
  assert.doesNotMatch(form, /(?<![-\w])disabled=/);
  assert.match(form, /<button type="submit" aria-disabled=\{!newName\.trim\(\) \|\| undefined\}/);
});

test('the new category joins the list at once, and a refused name comes back into the field', () => {
  assert.match(source, /setCategories\(\(list\) => \(list\.some\(\(c\) => c\.id === created\.id\) \? list : \[\.\.\.list, created\]\)\)/);
  assert.match(source, /setNewName\(\(now\) => \(now === '' \? name : now\)\)/);
});
