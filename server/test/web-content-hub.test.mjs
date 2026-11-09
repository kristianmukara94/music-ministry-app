// The web planners' Content Hub, several items in a step, any song in any step, and the fields a laptop push must not strip.
// Run with: node --test server/test/web-content-hub.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const load = (...rel) => import(pathToFileURL(path.join(root, ...rel)).href);

const model = await load('web', 'js', 'plan-model.js');
const hub = await load('web', 'js', 'content-hub.js');
const sample = await load('web', 'js', 'sample-data.js');
const schedule = await load('web', 'js', 'mass-schedule.js');
const { MASS_ORDER_TEMPLATES } = await load('shared', 'mass-order-text.js');
const server = await load('server', 'lib', 'plan-sync.js');

const SONG_A = '6f1c2b3a-0000-4000-8000-00000000000a';
const SONG_B = '6f1c2b3a-0000-4000-8000-00000000000b';
const songIds = new Set([SONG_A, SONG_B]);
const SONGS = [{ id: SONG_A, title: 'Song A', key: 'G' }, { id: SONG_B, title: 'Song B', key: 'D' }];
const ROWS = model.massRows(sample.MASS_PLAN);
const SEGS = model.praiseSegments(sample.PRAISE_PLAN);
const HUB_ENTRY = { id: 'hub-1', type: 'prayer', title: 'Fiesta prayer', category: 'Community Prayer', text: 'The words.', speakerNote: 'Commentator' };
const massState = (segments, over = {}) => ({ segments, notes: {}, extra: [], meta: {}, contentHubItems: [HUB_ENTRY], ...over });

test('the Nicene Creed template is the text the laptop ships, in English and Cebuano', () => {
  const web = hub.HUB_TEMPLATES.find((t) => t.id === 'nicene-creed');
  const laptop = MASS_ORDER_TEMPLATES.find((t) => t.id === 'nicene-creed');
  assert.equal(web.text.EN, laptop.entries.en.text);
  assert.equal(web.text.CEB, laptop.entries.ceb.text);
});

test('a template with no text in the plan\'s language falls back to English and says so, and no translation is invented', () => {
  const confiteor = hub.HUB_TEMPLATES.find((t) => t.id === 'confiteor');
  assert.deepEqual(Object.keys(confiteor.text), ['EN']);
  assert.deepEqual(hub.templateText(confiteor, 'TL'), { text: confiteor.text.EN, fellBack: true });
  assert.equal(hub.templateText(confiteor, 'EN').fellBack, false);
});

test('the Universal Prayer template is a structure with places to fill, not fixed words', () => {
  assert.match(hub.HUB_TEMPLATES.find((t) => t.id === 'universal-prayer').text.EN, /\[intention\]/);
});

test('the Hub form needs a type and a title, and keeps to the limits', () => {
  assert.equal(hub.checkHubDraft({ type: 'x', title: 'A' }).error, 'Choose a type for this entry.');
  assert.equal(hub.checkHubDraft({ type: 'note', title: '  ' }).error, 'Enter a title for this entry.');
  assert.deepEqual(hub.checkHubDraft({ id: '', type: 'note', title: ' A ', category: 'Liturgical Cue', text: ' B ', speakerNote: '' }).entry, { id: '', type: 'note', title: 'A', category: 'Liturgical Cue', text: 'B', speakerNote: '' });
  assert.match(hub.checkHubDraft({ type: 'note', title: 'A', text: 'x'.repeat(hub.MAX_HUB_TEXT + 1) }).error, /can be up to/);
});

test('the web and the server agree on the Hub\'s types and limits', () => {
  assert.deepEqual(hub.HUB_TYPES.map((t) => t.value), server.HUB_TYPES);
  assert.equal(hub.MAX_HUB_ITEMS, server.MAX_HUB_ITEMS);
  assert.equal(hub.MAX_HUB_TEXT, server.MAX_HUB_TEXT);
});

test('adding to a step keeps what is there, removing moves the next up, and keys stay with their song', () => {
  let segments = model.withEntry({}, 's16', { songId: SONG_A });
  segments = model.withEntry(segments, 's16', { songId: SONG_B });
  segments = model.withEntry(segments, 's16', { contentHubId: 'hub-1', text: 'Fiesta prayer' });
  assert.deepEqual(model.slotEntries(segments.s16).map((e) => e.songId ?? e.contentHubId), [SONG_A, SONG_B, 'hub-1']);
  segments = model.withEntryKey(segments, 's16', 1, 'Bb');
  assert.equal(model.slotEntries(segments.s16)[1].keyTransposed, 'Bb');
  segments = model.withoutEntry(segments, 's16', 0);
  assert.equal(segments.s16.songId, SONG_B);
  assert.equal(segments.s16.keyTransposed, 'Bb');
  segments = model.withEntryKey(segments, 's16', 0, '');
  assert.equal(segments.s16.keyTransposed, undefined, 'an empty key goes back to the song\'s own');
});

test('any song can fill any Holy Mass slot, even one saved as a rite, and the server takes it', () => {
  const state = massState({ s2: { songId: SONG_A }, s20: { songId: SONG_B } }, { meta: { s2: { key: 'old', kind: 'rite', slot: 2 } } });
  const items = model.massToItems(state, ROWS);
  assert.deepEqual(items.map((i) => [i.key, i.kind, i.slot]), [['old', 'song', 2], ['s20', 'song', 20]]);
  assert.equal(server.checkItems(items, songIds).length, 2);
});

test('several items in a slot are saved in order with the extended fields, and read back the same', () => {
  const segments = { s16: { songId: SONG_A, keyTransposed: 'Eb', more: [{ songId: SONG_B, keyTransposed: 'G' }, { contentHubId: 'hub-1', text: 'old title' }, { text: 'Instrumental' }] } };
  const items = model.massToItems(massState(segments), ROWS);
  assert.deepEqual(items.map((i) => [i.key, i.kind, i.slot, i.slotId, i.contentType]), [
    ['s16', 'song', 16, 's16', 'song'],
    ['s16.2', 'song', 16, 's16', 'song'],
    ['s16.3', 'rite', 16, 's16', 'hub_item'],
    ['s16.4', 'rite', 16, 's16', 'text_note'],
  ]);
  assert.equal(items[2].text, 'Fiesta prayer', 'a Hub item is sent by its current title');
  assert.equal(items[2].contentHubId, 'hub-1');
  assert.equal('The words.' === items[2].text, false, 'the words are not on the item');
  const clean = server.checkItems(items, songIds);
  assert.deepEqual(clean, items);
  const back = model.massFromItems(clean, ROWS);
  const saved = model.massToItems({ ...back, contentHubItems: [HUB_ENTRY] }, ROWS);
  assert.deepEqual(saved, items, 'a view and a save changes nothing');
  assert.deepEqual(model.describeEntries(back.segments.s16, SONGS, [HUB_ENTRY]).map((e) => [e.title, e.source, e.key]), [['Song A', 'list', 'Eb'], ['Song B', 'list', 'G'], ['Fiesta prayer', 'hub', ''], ['Instrumental', 'text', '']]);
});

test('a further typed item in a reading slot is a rite, so the laptop keeps it and does not hold the plan', () => {
  const items = model.massToItems(massState({ s20: { text: 'First Reading', more: [{ text: 'Read slowly' }] } }), ROWS);
  assert.deepEqual(items.map((i) => i.kind), ['reading', 'rite']);
  assert.equal('contentType' in items[0], false);
});

test('a Praise & Worship segment holds several items, minutes on the first, and a laptop\'s numbered keys read back into it', () => {
  const id = SEGS.find((s) => s.kind === 'song').id;
  const items = model.praiseToItems({ segments: { [id]: { minutes: 7, songId: SONG_A, more: [{ songId: SONG_B, keyTransposed: 'A' }] } }, notes: {}, extra: [], contentHubItems: [] }, SEGS).filter((i) => i.slotId === id);
  assert.deepEqual(items.map((i) => [i.key, i.minutes, i.songId, i.keyTransposed]), [[id, 7, SONG_A, undefined], [`${id}.2`, undefined, SONG_B, 'A']]);
  const fromLaptop = [
    { key: `${id}.1`, group: 'opening', order: 1, kind: 'song', songId: SONG_A, minutes: 7 },
    { key: `${id}.2`, group: 'opening', order: 2, kind: 'song', songId: SONG_B },
  ];
  const read = model.praiseFromItems(fromLaptop, SEGS);
  assert.deepEqual(read.extra, []);
  assert.deepEqual(model.slotEntries(read.segments[id]).map((e) => e.songId), [SONG_A, SONG_B]);
  assert.deepEqual(model.praiseToItems({ ...read, contentHubItems: [] }, SEGS).filter((i) => i.slotId === id).map((i) => i.key), [`${id}.1`, `${id}.2`], 'the laptop\'s keys go back as they came');
});

test('the setlist lists every item in a step', () => {
  const id = SEGS[0].id;
  const entries = model.setlistEntries({ segments: { [id]: { songId: SONG_A, more: [{ songId: SONG_B, keyTransposed: 'A' }] } } }, SEGS, SONGS);
  assert.deepEqual(entries.map((e) => [e.title, e.key]), [['Song A', 'G'], ['Song B', 'A']]);
});

test('the server keeps the extended item fields and refuses bad ones', () => {
  const base = { key: 'a', group: 'word', order: 1, kind: 'rite' };
  const good = { ...base, slotId: 's2', title: 'T', text: 'T', contentType: 'hub_item', contentHubId: 'hub-1', durationMinutes: 0 };
  assert.deepEqual(server.checkItems([good], songIds)[0], good);
  for (const bad of [{ slotId: '<b>' }, { title: 'x'.repeat(201) }, { contentHubId: 'a b' }, { durationMinutes: 61 }, { durationMinutes: 1.5 }, { contentType: 'hub_item' }, { contentType: 'homily', text: 'x' }]) {
    assert.throws(() => server.checkItems([{ ...base, ...bad }], songIds), undefined, JSON.stringify(bad));
  }
  assert.throws(() => server.checkItems([{ ...base, kind: 'song', songId: SONG_A, contentHubId: 'hub-1' }], songIds), /not both/);
  assert.throws(() => server.checkItems([{ ...base, lyrics: 'the words' }], songIds), /never leave the laptop/, 'a field that would carry words is still refused');
});

test('the Hub is checked by field, by size and by the steps that name it', () => {
  assert.deepEqual(server.checkContentHubItems([HUB_ENTRY]), [HUB_ENTRY]);
  assert.throws(() => server.checkContentHubItems([{ ...HUB_ENTRY, secret: 'x' }]), /does not accept/);
  assert.throws(() => server.checkContentHubItems([HUB_ENTRY, HUB_ENTRY]), /no valid id/);
  assert.throws(() => server.checkContentHubItems([{ ...HUB_ENTRY, title: ' ' }]), /title/);
  assert.throws(() => server.checkContentHubItems([{ ...HUB_ENTRY, text: 'x'.repeat(server.MAX_HUB_TEXT + 1) }]), /can be up to/);
  assert.throws(() => server.checkContentHubItems(Array.from({ length: server.MAX_HUB_ITEMS + 1 }, (_, i) => ({ ...HUB_ENTRY, id: `h${i}` }))), /up to/);
  assert.throws(() => server.checkHubReferences([{ contentHubId: 'gone' }], [HUB_ENTRY]), /does not have/);
});

test('a laptop that changed an item keeps its change: another song loses the old key, other words lose the Hub link', () => {
  const stored = [
    { key: 's1', group: 'introductory', order: 1, kind: 'song', songId: SONG_A, slot: 1, keyTransposed: 'A', slotId: 's1' },
    { key: 's2', group: 'introductory', order: 2, kind: 'rite', text: 'Prayer', slot: 2, contentHubId: 'hub-1', contentType: 'hub_item' },
  ];
  const [song, note] = server.restoreWebFields([
    { key: 's1', group: 'introductory', order: 1, kind: 'song', songId: SONG_B, slot: 1 },
    { key: 's2', group: 'introductory', order: 2, kind: 'rite', note: 'Different words', slot: 2 },
  ], stored);
  assert.equal(song.keyTransposed, undefined);
  assert.equal(song.slotId, undefined);
  assert.equal(note.contentHubId, undefined);
  assert.equal(note.note, 'Different words');
});

test('an item the laptop took out of a slot, with nothing else in it, stays out', () => {
  const stored = [{ key: 'a', group: 'word', order: 1, kind: 'song', songId: SONG_A, slot: 4 }];
  const [item] = server.restoreWebFields([{ key: 'a', group: 'word', order: 1, kind: 'song', songId: SONG_A }], stored);
  assert.equal(item.slot, undefined);
});

test('a prayer segment that comes back from the laptop with no words is still the web\'s entry', () => {
  const stored = [{ key: '6', group: 'word', order: 1, kind: 'rite', text: 'Prayer', contentHubId: 'hub-1', contentType: 'hub_item' }];
  const [item] = server.restoreWebFields([{ key: '6', group: 'word', order: 1, kind: 'rite' }], stored);
  assert.deepEqual([item.text, item.contentHubId, item.contentType], ['Prayer', 'hub-1', 'hub_item']);
});

test('a copied plan brings its Hub with it, and a plan as the API returns it carries the Hub for the laptop', () => {
  const plan = { id: 'p', name: 'P', date: '2026-11-01', kind: 'mass', items: [], contentHubItems: [HUB_ENTRY] };
  assert.deepEqual(model.duplicateRequest(plan, 'q').contentHubItems, [HUB_ENTRY]);
  assert.equal('contentHubItems' in model.duplicateRequest({ ...plan, contentHubItems: undefined }, 'q'), false);
  const out = server.planOut({ id: 'p', name: 'P', liturgical_date: '2026-11-01', updated_at: new Date(), body: { kind: 'mass', items: [], contentHubItems: [HUB_ENTRY] } });
  assert.deepEqual(out.contentHubItems, [HUB_ENTRY]);
  const deleted = server.planOut({ id: 'p', name: 'P', liturgical_date: '2026-11-01', updated_at: new Date(), body: { kind: 'mass', deleted: true, items: [], contentHubItems: [HUB_ENTRY] } });
  assert.equal('contentHubItems' in deleted, false);
});

test('a page of plans stops before the response limit and says more is waiting, and always holds at least one plan', async () => {
  const row = (n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name: 'P', liturgical_date: '2026-11-01', updated_at: new Date(Date.UTC(2026, 10, 1, n)), body: { kind: 'mass', items: [], contentHubItems: [{ ...HUB_ENTRY, text: 'x'.repeat(400) }] } });
  const rows = [row(1), row(2), row(3)];
  const sql = async () => rows;
  const page = await server.pullPlans(sql, 'church', null, 900);
  assert.equal(page.plans.length, 1);
  assert.equal(page.more, true);
  assert.ok(page.cursor.endsWith(rows[0].id), 'the next page starts after the last plan sent');
  assert.equal((await server.pullPlans(sql, 'church', null, 10)).plans.length, 1, 'a plan larger than the limit still goes');
  assert.equal((await server.pullPlans(sql, 'church', null)).more, false);
});

test('a laptop that sends a Hub entry under a new key is matched to the stored one, and a reference it cannot send is kept', () => {
  const stored = [
    { key: 's2', group: 'introductory', order: 1, kind: 'rite', text: 'Prayer', slot: 2, slotId: 's2', contentHubId: 'hub-1', contentType: 'hub_item' },
    { key: 'r1', group: 'word', order: 2, kind: 'reading', text: 'Matthew 5:1-12a', contentType: 'scripture' },
  ];
  const [hubItem, reading] = server.restoreWebFields([
    { key: 'notes.12.intro.1', group: 'introductory', order: 1, kind: 'rite', text: 'Prayer', slot: 2, contentHubId: 'hub-1' },
    { key: 'r1', group: 'word', order: 2, kind: 'reading' },
  ], stored);
  assert.equal(hubItem.slotId, 's2');
  assert.deepEqual([reading.text, reading.contentType], ['Matthew 5:1-12a', 'scripture']);
});

test('every Hub entry the website can make is a valid note on the laptop, and a Holy Mass intention can never land in the sealed category', async () => {
  const { MAX_NOTE_BODY, NOTE_CATEGORIES } = await load('shared', 'notes.js');
  const { webHubNote } = await load('electron', 'web-hub-notes.js');
  assert.equal(server.MAX_HUB_TEXT, MAX_NOTE_BODY);
  for (const { value: type } of hub.HUB_TYPES) {
    for (const category of hub.HUB_CATEGORIES[type]) {
      const note = webHubNote({ type, title: 'T', category, text: 'x'.repeat(server.MAX_HUB_TEXT) });
      assert.ok(NOTE_CATEGORIES.includes(note.category), category);
      assert.equal(note.display, type === 'note' ? 'operator' : 'full');
      if (type === 'prayer' || type === 'announcement' || type === 'note') assert.equal(note.category, category, 'the web category is kept');
    }
  }
  assert.equal(webHubNote({ type: 'prayer', title: 'T', category: 'Mass Intention', text: 'x' }).category, 'Community Prayer');
});

test('the parish schedule offers the named Sunday Holy Masses', () => {
  const labels = schedule.massTimesFor('2026-11-01').map((t) => t.label);
  for (const label of ['6:00 AM · Early Sunday Holy Mass', '10:00 AM · Solemn Holy Mass', '5:30 PM · Youth Holy Mass']) assert.ok(labels.includes(label), label);
});
