// Stanza ids through an edit: one edited line keeps every id; a new stanza is the only one with a new id; a removed stanza is the only one
// that loses its id; a stanza whose text is unchanged keeps its id when it moves. Run with: node --test shared/stanza-ids.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchStanzaIds } from './stanza-ids.js';

const old = (...texts) => texts.map((lyricsText, i) => ({ id: 100 + i, lyricsText }));
const next = (...texts) => texts.map((lyricsText) => ({ lyricsText }));

test('editing one line keeps every stanza id', () => {
  const before = old('alpha one', 'beta one', 'gamma one');
  const ids = matchStanzaIds(before, next('alpha one', 'beta one, edited', 'gamma one'));
  assert.deepEqual(ids, [100, 101, 102]);
});

test('adding a stanza gives only the new stanza a new id', () => {
  const before = old('alpha', 'beta');
  assert.deepEqual(matchStanzaIds(before, next('alpha', 'beta', 'gamma')), [100, 101, null]);
});

test('adding a stanza at the start keeps the ids of the others', () => {
  const before = old('alpha', 'beta');
  assert.deepEqual(matchStanzaIds(before, next('new first', 'alpha', 'beta')), [null, 100, 101]);
});

test('removing a stanza loses only its id', () => {
  const before = old('alpha', 'beta', 'gamma');
  const ids = matchStanzaIds(before, next('alpha', 'gamma'));
  assert.deepEqual(ids, [100, 102]);
  assert.ok(!ids.includes(101), 'the removed stanza no longer has its id');
});

test('a stanza whose text is unchanged keeps its id when it moves', () => {
  const before = old('alpha', 'beta', 'gamma');
  assert.deepEqual(matchStanzaIds(before, next('gamma', 'alpha', 'beta')), [102, 100, 101]);
});

test('an empty song matches nothing, so every stanza is new', () => {
  assert.deepEqual(matchStanzaIds([], next('alpha', 'beta')), [null, null]);
});

test('each old id is used at most once', () => {
  const before = old('same', 'same');
  const ids = matchStanzaIds(before, next('same', 'same', 'same'));
  assert.deepEqual(ids, [100, 101, null]);
  assert.equal(new Set(ids.filter((x) => x !== null)).size, ids.filter((x) => x !== null).length);
});
