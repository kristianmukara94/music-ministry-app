// Tests for the Praise & Worship editor's rules: a song's key for one plan, a reading's type and tag, the time breakdown and the readiness checks.
// Run with: node --test server/test/web-praise-editor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as desktop from '../../shared/setlist-tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (file) => import(pathToFileURL(path.join(here, '..', '..', 'web', 'js', file)).href);
const model = await load('plan-model.js');
const sample = await load('sample-data.js');
const keys = await load('song-keys.js');
const read = (file) => fs.readFileSync(path.join(here, '..', '..', file), 'utf8');

const SONG = '20000000-0000-4000-8000-00000000000a';
const SONGS = [{ id: SONG, title: 'Be still and know', key: 'G' }];
const SEGS = model.praiseSegments(sample.PRAISE_PLAN);
const breakdown = (state = {}) => model.praiseBreakdown(sample.PRAISE_PLAN, SEGS, { segments: {}, notes: {}, ...state }, SONGS);

test('the website moves a key exactly as the desktop key stepper does', () => {
  for (const key of ['C', 'Db', 'F#', 'Bb', 'B', 'Am', 'F#m', 'Ebm', 'C minor', 'D major', 'F♯', '', 'H', 'not a key']) {
    assert.deepEqual(keys.parseKey(key), desktop.parseKey(key), key);
    for (let step = -6; step <= 6; step += 1) assert.equal(keys.transposeKey(key, step), desktop.transposeKey(key, step), `${key} ${step}`);
  }
});

test("the key list offers each key of the mode once, with the song's own key as the empty choice", () => {
  const choices = keys.keyChoices('G');
  assert.equal(choices.length, 12);
  assert.equal(new Set(choices.map((c) => c.value)).size, 12);
  assert.deepEqual(choices.find((c) => c.value === ''), { value: '', label: "G (song's key)" });
  assert.deepEqual(choices.find((c) => c.value === 'A'), { value: 'A', label: 'A (+2)' });
  assert.ok(keys.keyChoices('Em').filter((c) => c.value).every((c) => c.value.endsWith('m')), 'a minor song stays minor');
});

test('a song with no readable key can still be given one, and a saved key is never dropped from the list', () => {
  assert.equal(keys.keyChoices('').length, 25);
  assert.equal(keys.keyChoices('')[0].label, 'No key set');
  assert.ok(keys.keyChoices('G', 'Bbm').some((c) => c.value === 'Bbm'));
});

test('every key the list offers is one the server accepts', () => {
  const source = /const MUSICAL_KEY = \/(.*)\/;/.exec(read('server/lib/plan-sync.js'))[1];
  const pattern = new RegExp(source);
  for (const original of ['', 'G', 'F#m', 'C minor', 'Bb major']) {
    for (const { value } of keys.keyChoices(original)) if (value) assert.match(value, pattern, `${original} -> ${value}`);
  }
});

test('a key and a reading type survive the trip through the save and load', () => {
  const state = {
    segments: { 5: { songId: SONG, keyTransposed: 'A' }, 6: { text: 'Opening prayer', contentType: 'prayer' } },
    notes: {},
    extra: [],
  };
  const items = model.praiseToItems(state, SEGS);
  assert.equal(items.find((i) => i.key === '5').keyTransposed, 'A');
  assert.equal(items.find((i) => i.key === '6').contentType, 'prayer');
  const again = model.praiseFromItems(items, SEGS);
  assert.equal(again.segments['5'].keyTransposed, 'A');
  assert.equal(again.segments['6'].contentType, 'prayer');
});

test('nothing extra is sent for a step that does not use a key or a type', () => {
  const items = model.praiseToItems({ segments: { 5: { text: 'typed', keyTransposed: 'A' }, 6: { contentType: 'prayer' } }, notes: {}, extra: [] }, SEGS);
  assert.equal('keyTransposed' in items.find((i) => i.key === '5'), false, 'typed text has no key');
  assert.equal('contentType' in items.find((i) => i.key === '6'), false, 'an empty reading has no type');
});

test("a step shows the plan's key when there is one, and the song's own key otherwise", () => {
  const seg = SEGS.find((s) => s.id === '5');
  const own = model.praiseRow(seg, { segments: { 5: { songId: SONG } }, notes: {} }, SONGS);
  assert.deepEqual([own.key, own.keyTransposed, own.originalKey], ['G', '', 'G']);
  const moved = model.praiseRow(seg, { segments: { 5: { songId: SONG, keyTransposed: 'A' } }, notes: {} }, SONGS);
  assert.deepEqual([moved.key, moved.keyTransposed, moved.originalKey], ['A', 'A', 'G']);
  assert.equal(SONGS[0].key, 'G', 'the song in the list is untouched');
});

test('a filled reading shows a tag, and one saved before types existed reads as scripture', () => {
  assert.equal(model.contentTag('scripture', 'Psalm 100:1-5'), '📖 Psalm 100:1-5');
  assert.equal(model.contentTag('prayer', 'Prayer for vocations'), '🙏 Prayer for vocations');
  assert.equal(model.contentTag('announcement', 'Parish fiesta'), '📢 Parish fiesta');
  assert.equal(model.contentTag(undefined, 'Psalm 63:1-8'), '📖 Psalm 63:1-8');
  assert.equal(model.contentTag('prayer', ''), '');
});

test("the template adds up to 1 h 17 min, with each section's share of the 90 minute slot", () => {
  const view = breakdown();
  assert.equal(model.durationLabel(view.total), '1 h 17 min');
  assert.deepEqual(view.sections.map((s) => [s.group, s.minutes, s.percent]), [['opening', 25, 28], ['word', 30, 33], ['closing', 22, 24]]);
  assert.equal(model.durationLabel(45), '45 min');
  assert.equal(model.durationLabel(65), '1 h 05 min');
});

test('more minutes move the section, the total and the fit check', () => {
  const over = breakdown({ segments: { 1: { minutes: 19 } } });
  assert.equal(over.sections[0].minutes, 39);
  assert.equal(over.total, 91);
  assert.equal(over.checks[1].ok, false);
  assert.equal(over.checks[1].text, 'Runs 1 min over the 90 minute slot');
  const fits = breakdown({ segments: { 1: { minutes: 18 } } });
  assert.equal(fits.checks[1].ok, true, 'exactly 90 minutes fits');
  assert.equal(fits.checks[1].text, 'Fits the 90 minute slot (1 h 30 min)');
});

test('a section longer than the slot fills its bar and stops there', () => {
  const minutes = Object.fromEntries(['1', '2', '3', '4'].map((id) => [id, { minutes: 60 }]));
  assert.equal(breakdown({ segments: minutes }).sections[0].percent, 100);
});

test('the count of unfilled steps leaves out rites and optional steps, and reads properly for one', () => {
  assert.equal(breakdown().checks[0].text, '6 steps still need a song or reading', 'songs 2, 3, 5, 8, 11 and reading 6; song 10 is optional');
  const filled = Object.fromEntries(['2', '3', '5', '8'].map((id) => [id, { songId: SONG }]));
  const one = breakdown({ segments: { ...filled, 6: { text: 'Psalm 100:1-5' } } });
  assert.equal(one.checks[0].text, '1 step still needs a song or reading');
  assert.equal(one.checks[0].sub, 'Closing song');
  assert.equal(one.songsDone, 4);
  assert.equal(one.songsTotal, 6);
});

test('the speaker check follows the note on the teaching step, so a plan can become ready', () => {
  assert.equal(breakdown().checks[2].ok, false);
  assert.equal(breakdown({ notes: { 7: '   ' } }).checks[2].ok, false, 'spaces are not a note');
  const filled = Object.fromEntries(['2', '3', '5', '8', '11'].map((id) => [id, { songId: SONG }]));
  const view = breakdown({ segments: { ...filled, 6: { text: 'Psalm 100:1-5' } }, notes: { 7: 'Fr. Santos' } });
  assert.ok(view.checks.every((c) => c.ok));
});

test("the printed setlist and the Plans page export use the plan's key", () => {
  const entries = model.setlistEntries({ segments: { 5: { songId: SONG, keyTransposed: 'A' } } }, SEGS, SONGS);
  assert.deepEqual(entries, [{ label: 'Worship song', title: 'Be still and know', key: 'A' }]);
});

test("the page meets the site's security policy: no inline handlers, scripts or eval", () => {
  const page = read('web/plan/praise.html');
  const script = read('web/js/praise.js');
  assert.doesNotMatch(page, /\son[a-z]+\s*=/i, 'no inline event handlers');
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)[^>]*>/i, 'no inline scripts');
  assert.doesNotMatch(script, /\beval\(|new Function|\son[a-z]+="/, 'no eval and no handlers in generated markup');
  for (const id of ['bar-fill-opening', 'bar-fill-word', 'bar-fill-closing', 'status-pill', 'print', 'setlist-print']) assert.match(page, new RegExp(`id="${id}"`));
});
