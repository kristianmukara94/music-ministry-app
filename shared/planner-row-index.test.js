// The Mass Planner shows each song with its current title and status laid over the saved plan. Those rows are copies of the saved items, so a
// row's position must be looked up in the list the rows came from. Looked up in the saved list, the copy is not found (-1): Delete removed nothing,
// and Play and the move arrows read the item at position -1 ("Cannot read properties of undefined (reading 'stale')").
// Run with: node --test shared/planner-row-index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { overlayLyricsItems } from './hymn-cache.js';

const planner = readFileSync(fileURLToPath(new URL('../src/planner/MassPlanner.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const saved = [
  { block: 'introductory', module: 'lyrics', sourceId: '1', label: 'Adlaw-Adlaw' },
  { block: 'introductory', module: 'lyrics', sourceId: '2', label: 'Hosanna' },
  { block: 'word', module: 'bible', sourceId: 'WEB:Amos:2:1', label: 'Amos 2:1 (WEB)' },
];
const hymnNow = { 1: { title: 'Adlaw-Adlaw (new title)', deleted: false } };

test('a song with a fresh title is a copy, so it is not found in the saved list', () => {
  const shown = overlayLyricsItems(saved, hymnNow);
  assert.equal(shown.length, saved.length, 'one entry for every saved item');
  assert.equal(shown[0].label, 'Adlaw-Adlaw (new title)', 'the row shows the current title');
  assert.equal(saved.indexOf(shown[0]), -1, 'the copy is not in the saved list: this was the bug');
  assert.equal(shown.indexOf(shown[0]), 0, 'it is found in the list it came from');
  assert.equal(shown.indexOf(shown[1]), 1, 'a song with no fresh title is the saved item itself');
});

test('every position in the shown list is the same position in the saved list', () => {
  const shown = overlayLyricsItems(saved, hymnNow);
  shown.forEach((row, i) => {
    assert.equal(row.sourceId, saved[i].sourceId, `row ${i} is the saved item ${i}`);
    assert.equal(row.block, saved[i].block);
  });
});

test('the planner looks a row up in the list the rows came from', () => {
  assert.doesNotMatch(planner, /items\.indexOf\(row\)/, 'no lookup of a shown row in the saved list');
  assert.match(planner, /const shown = overlayLyricsItems\(items, hymnNow\);/, 'the overlaid list is made once');
  assert.match(planner, /blockRows\(shown, block\.id\)/, 'the rows come from it');
  assert.match(planner, /const index = shown\.indexOf\(row\);/, 'and so does their position');
});

test('Delete, Play and the move arrows refuse a position that is not in the plan', () => {
  assert.match(planner, /const removeAt = \(index: number\) => \{\n\s+if \(index < 0 \|\| index >= items\.length\) return;/);
  assert.match(planner, /const nudge = \(index: number, delta: -1 \| 1\) => \{\n\s+if \(index < 0 \|\| index >= items\.length\) return;/);
  assert.match(planner, /planId == null \|\| index < 0 \|\| index >= items\.length/, 'staging a row checks its position');
});
