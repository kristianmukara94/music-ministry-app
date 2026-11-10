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
  for (const id of ['section-bars', 'status-pill', 'print', 'setlist-print']) assert.match(page, new RegExp(`id="${id}"`));
  // The time bars are drawn for the plan's own sections, so the laptop's lineup and the earlier layout each get theirs.
  assert.match(script, /id="bar-fill-\$\{esc\(section\.group\)\}"/);
});

// ---- The laptop's lineup ----

const lineup = await load('lineup-templates.js');
const desktopPw = await import(pathToFileURL(path.join(here, '..', '..', 'shared', 'pw.js')).href);
const LINEUP_SEGS = model.praiseSegments(model.PRAISE_TEMPLATE);
const SONG_2 = '20000000-0000-4000-8000-00000000000b';
const SONG_3 = '20000000-0000-4000-8000-00000000000c';

test("a new plan has the church laptop's twelve slots: the same keys, names, groups, minutes and order", () => {
  const laptop = desktopPw.DEFAULT_TEMPLATE;
  assert.deepEqual(model.PRAISE_TEMPLATE.sections.map((s) => [s.group, s.title]), laptop.groups.map((g) => [g.key, g.name]));
  assert.deepEqual(model.PRAISE_TEMPLATE.sections.map((s) => s.rows.length), [4, 4, 4]);
  assert.deepEqual(
    LINEUP_SEGS.map((s) => [s.id, s.name, s.group, s.defaultMinutes]),
    desktopPw.groupOrdered(laptop.segments, laptop.groups).map((s) => [s.key, s.name, s.group, s.minutes]),
  );
  assert.deepEqual(LINEUP_SEGS.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(LINEUP_SEGS.map((s) => s.kind), ['rite', 'rite', 'song', 'reading', 'song', 'song', 'song', 'song', 'reading', 'song', 'song', 'song']);
  assert.equal(model.praiseBreakdown(model.PRAISE_TEMPLATE, LINEUP_SEGS, { segments: {}, notes: {} }, []).total, desktopPw.totalMinutes(laptop.segments));
});

test('each song slot opens the picker on its own category, and the title and lectionary slots never count as unfilled', () => {
  assert.deepEqual(
    LINEUP_SEGS.filter((s) => s.kind === 'song').map((s) => [s.id, s.pickerCategory]),
    [['marian_song', 'marian'], ['joyful_song', 'joyful'], ['worship', 'worship'], ['repentance', 'repentance'], ['holy_spirit', 'holy_spirit'], ['offertory', 'offertory'], ['thanksgiving', 'thanksgiving'], ['finale', 'finale']],
  );
  for (const seg of LINEUP_SEGS.filter((s) => s.kind === 'song')) assert.ok(lineup.pickerCategoryOf('praise_worship', seg.pickerCategory), seg.id);
  const view = model.praiseBreakdown(model.PRAISE_TEMPLATE, LINEUP_SEGS, { segments: {}, notes: {} }, SONGS);
  assert.equal(view.checks.length, 2, 'the lineup has no teaching step, so there is no speaker check');
  assert.equal(view.checks[0].text, '8 steps still need a song or reading', 'the eight song slots; Bible Enthronement and Gospel Acclamation fill themselves');
  assert.equal(view.songsTotal, 8);
});

test('a plan in the earlier layout opens each song step on its category too: Opening praise song on Joyful / Fast Praise', () => {
  assert.deepEqual(
    SEGS.filter((s) => s.kind === 'song').map((s) => [s.name, s.pickerCategory]),
    [['Opening praise song', 'joyful'], ['Praise set', 'joyful'], ['Worship song', 'worship'], ['Response song', ''], ['Offering song', 'offertory'], ['Closing song', 'finale']],
  );
  assert.ok(SEGS.filter((s) => s.kind !== 'song').every((s) => s.pickerCategory === undefined), 'only song steps have a category');
});

test('the song list is drawn inside the step panel, opened on the step’s tab and category, with no button to open it first', () => {
  const picker = read('web/js/song-picker.js');
  assert.match(picker, /export function mountSongPicker\(root,/);
  assert.doesNotMatch(picker, /showModal|createElement\('dialog'\)/, 'no dialog');
  assert.match(picker, /Show all songs \(\$\{inTab\}\)/, 'an empty category offers every song of the tab');
  for (const [file, type] of [['web/js/praise.js', 'praise_worship'], ['web/js/mass.js', 'mass']]) {
    const page = read(file);
    assert.match(page, /data-inline-picker=/, `${file} has the picker in its panel`);
    assert.match(page, new RegExp(`serviceType: '${type}',\\s*category: \\w+\\.pickerCategory \\|\\| 'all'`), `${file} opens on its tab and the step's category`);
    assert.doesNotMatch(page, /data-add-song|open-picker|openSongPicker/, `${file} has no Add song button`);
    // A song saved on the laptop while the plan is open shows without a reload.
    assert.match(page, /const songWatch = watchSongList\(/, `${file} reads the song list again`);
    assert.match(page, /songWatch\.seen\(list\)/, `${file} records the list it loaded`);
  }
});

test("a new plan saves as the laptop's lineup: its keys and groups, and the reading name that fills the Gospel Acclamation from the lectionary", () => {
  const items = model.praiseToItems({ segments: {}, notes: {}, extra: [], present: new Set() }, LINEUP_SEGS);
  assert.deepEqual(items.map((i) => i.key), lineup.PW_SEGMENT_KEYS);
  assert.deepEqual([...new Set(items.map((i) => i.group))], ['opening', 'praise', 'word']);
  assert.deepEqual(items.map((i) => i.kind), LINEUP_SEGS.map((s) => s.kind));
  assert.deepEqual(items.find((i) => i.key === 'gospel_acclamation'), { key: 'gospel_acclamation', group: 'word', order: 9, kind: 'reading', minutes: 3, slotId: 'gospel_acclamation', text: 'Gospel Acclamation' });
  assert.equal('text' in items.find((i) => i.key === 'bible_enthronement'), false, 'a title slide carries no words');
  // Read back, the reading's name is the slot's default, not something chosen for it.
  const again = model.praiseFromItems(items, LINEUP_SEGS);
  assert.equal(model.praiseRow(LINEUP_SEGS.find((s) => s.id === 'gospel_acclamation'), again, SONGS).value, '');
  assert.equal(again.present.size, 12);
});

test("a plan pushed by the laptop fills the same slots, with a segment's songs together and in order", () => {
  // The laptop numbers every song of a segment ("worship.1"), and sends a prayer and a title slide with no words.
  const pushed = [
    { key: 'prayer_authority', group: 'opening', order: 1, kind: 'rite', minutes: 3 },
    { key: 'marian_song.1', group: 'opening', order: 2, kind: 'song', songId: SONG, minutes: 5 },
    { key: 'bible_enthronement', group: 'opening', order: 3, kind: 'reading', minutes: 4 },
    { key: 'worship.1', group: 'praise', order: 4, kind: 'song', songId: SONG_2, minutes: 15 },
    { key: 'worship.2', group: 'praise', order: 5, kind: 'song', songId: SONG_3 },
    { key: 'gospel_acclamation', group: 'word', order: 6, kind: 'reading', text: 'Gospel Acclamation', minutes: 3 },
    { key: 'custom_abc123', group: 'word', order: 7, kind: 'rite', minutes: 5 },
  ];
  assert.equal(model.isLegacyPraisePlan(pushed), false);
  const state = model.praiseFromItems(pushed, LINEUP_SEGS);
  assert.deepEqual(model.slotEntries(state.segments.marian_song).map((e) => e.songId), [SONG]);
  assert.deepEqual(model.slotEntries(state.segments.worship).map((e) => e.songId), [SONG_2, SONG_3]);
  assert.equal(state.segments.worship.minutes, 15);
  assert.deepEqual(state.extra.map((i) => i.key), ['custom_abc123'], 'a card the operator added on the laptop is kept, though the editor has no slot for it');
  // Saved again, each item keeps the key the laptop knows it by, and the cards the laptop took out stay out.
  const items = model.praiseToItems(state, LINEUP_SEGS);
  assert.deepEqual(items.map((i) => i.key), pushed.map((i) => i.key));
  assert.deepEqual(items.filter((i) => i.songId).map((i) => i.slotId), ['marian_song', 'worship', 'worship']);
});

test('a further item of a long segment key still gets a key the server accepts', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ text: `Note ${i + 1}` }));
  let segments = {};
  for (const entry of entries) segments = model.withEntry(segments, 'gospel_acclamation', entry);
  const items = model.praiseToItems({ segments, notes: {}, extra: [], present: new Set() }, LINEUP_SEGS).filter((i) => i.slotId === 'gospel_acclamation');
  assert.equal(items.length, 12);
  assert.equal(new Set(items.map((i) => i.key)).size, 12);
  assert.ok(items.every((i) => i.key.length <= 20), items.map((i) => i.key).join(' '));
  assert.deepEqual(model.slotEntries(model.praiseFromItems(items, LINEUP_SEGS).segments.gospel_acclamation).map((e) => e.text), entries.map((e) => e.text));
});

test("a plan the earlier editor laid out keeps its layout, and every other plan opens in the laptop's lineup", () => {
  const legacy = [{ key: '2', group: 'opening', order: 1, kind: 'song', songId: SONG, minutes: 5 }, { key: '5.2', slotId: '5', group: 'word', order: 2, kind: 'song', songId: SONG_2 }];
  assert.equal(model.isLegacyPraisePlan(legacy), true);
  assert.equal(model.praiseTemplateFor(legacy, sample.PRAISE_PLAN), sample.PRAISE_PLAN);
  // The laptop renumbers that plan's songs ("2.1") when it sends it back, and it is still the earlier layout.
  assert.equal(model.isLegacyPraisePlan([{ key: '2.1', group: 'opening', order: 1, kind: 'song', songId: SONG }]), true);
  assert.equal(model.praiseTemplateFor([], sample.PRAISE_PLAN), model.PRAISE_TEMPLATE, 'a new plan');
  assert.equal(model.praiseTemplateFor([{ key: 'worship.1', group: 'praise', order: 1, kind: 'song' }], sample.PRAISE_PLAN), model.PRAISE_TEMPLATE);
  assert.equal(model.praiseTemplateFor([{ key: 'custom_abc123', group: 'word', order: 1, kind: 'rite' }], sample.PRAISE_PLAN), model.PRAISE_TEMPLATE);
});

test('every item the lineup saves is one the server accepts', async () => {
  const { checkItems } = await import(pathToFileURL(path.join(here, '..', 'lib', 'plan-sync.js')).href);
  const segments = model.withEntry(model.withEntry({}, 'worship', { songId: SONG }), 'worship', { songId: SONG_2 });
  const items = model.praiseToItems({ segments, notes: { prayer_authority: 'Led by the prayer leader' }, extra: [], present: new Set() }, LINEUP_SEGS);
  const clean = checkItems(items, new Set([SONG, SONG_2]));
  assert.equal(clean.length, 13);
  assert.deepEqual(clean.filter((i) => i.slotId === 'worship').map((i) => i.key), ['worship', 'worship.2']);
});
