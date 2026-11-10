// Holy Mass slots and templates in the plan service, against the real schema: a slot is saved and read back, the rules that keep a slot to one
// item are enforced, and templates are saved, listed, loaded and deleted. Run with: node --test electron/mass-plan-slots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS, createMassPlanService } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS, applyImport, collectLibrary, decodeTransfer, encodeTransfer } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');

function open(withSlots = true) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.transaction = (work) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = work(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  for (const sql of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS,
    ...(withSlots ? MASS_SLOT_MIGRATIONS : []), ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS,
    ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS]) {
    db.exec(sql);
  }
  // The plan read only checks that an announcement slide exists, so a minimal table is enough.
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

function setup() {
  const db = open();
  const songs = createLyricsService(db);
  const plans = createMassPlanService(db);
  const hymn = (title) => songs.createHymn({ title, composer: '', language: 'EN', musicalKey: '', raw: 'A line', primaryCategory: 'MASS', songCategory: 'Gloria' }).id;
  const plan = plans.createPlan({ name: 'Sunday', liturgicalDate: '2026-11-08' });
  return { db, songs, plans, hymn, plan };
}

const item = (block, slot, sourceId, label = 'x', module = 'lyrics') => ({ block, module, sourceId: String(sourceId), label, slot });

test('a slot is saved with its item and read back, and an item with none reads back as none', () => {
  const { plans, hymn, plan } = setup();
  const a = hymn('Entrance song');
  plans.savePlan(plan.id, [item('introductory', 'entrance', a, 'Entrance song'), { block: 'introductory', module: 'custom', sourceId: 'Greeting', label: 'Greeting' }]);
  assert.deepEqual(plans.getPlan(plan.id).items.map((i) => [i.slot, i.label]), [['entrance', 'Entrance song'], [null, 'Greeting']]);
});

test('the same slot twice, or a slot that is not one of the 17, is refused and nothing is saved', () => {
  const { plans, hymn, plan } = setup();
  const a = hymn('One');
  plans.savePlan(plan.id, [item('introductory', 'entrance', a)]);
  assert.throws(() => plans.savePlan(plan.id, [item('introductory', 'entrance', a), item('introductory', 'entrance', a)]), /same Holy Mass slot/);
  assert.throws(() => plans.savePlan(plan.id, [item('introductory', 'nope', a)]), /Unknown Holy Mass slot/);
  assert.deepEqual(plans.getPlan(plan.id).items.map((i) => i.slot), ['entrance'], 'the saved plan is as it was');
});

test('a plan saved without slots, as an earlier version of the app did, still saves and reads back', () => {
  const { plans, hymn, plan } = setup();
  const a = hymn('Old');
  plans.savePlan(plan.id, [{ block: 'introductory', module: 'lyrics', sourceId: String(a), label: 'Old' }]);
  assert.equal(plans.getPlan(plan.id).items[0].slot, null);
});

test('a template is saved under a name, listed with its count, and loaded with its slots', () => {
  const { plans, hymn, plan } = setup();
  const a = hymn('Solemn entrance');
  const saved = plans.saveTemplate({ name: 'Sunday Solemn', items: [item('introductory', 'entrance', a, 'Solemn entrance'), item('introductory', 'kyrie', 'kyrie', 'Kyrie', 'mass_order')] });
  assert.equal(saved.count, 2);
  assert.deepEqual(plans.listTemplates(), [{ id: saved.id, name: 'Sunday Solemn', count: 2 }]);
  const loaded = plans.getTemplate(saved.id);
  assert.deepEqual(loaded.items.map((i) => [i.slot, i.module, i.stale]), [['entrance', 'lyrics', false], ['kyrie', 'mass_order', false]]);
  plans.savePlan(plan.id, loaded.items);
  assert.equal(plans.getPlan(plan.id).items.length, 2, 'a loaded template saves as a plan');
});

test('a template item whose song was deleted since is marked stale, so the planner can leave it out', () => {
  const { songs, plans, hymn } = setup();
  const a = hymn('Soon gone');
  const saved = plans.saveTemplate({ name: 'T', items: [item('introductory', 'entrance', a), item('introductory', 'kyrie', 'kyrie', 'Kyrie', 'mass_order')] });
  assert.deepEqual(plans.getTemplate(saved.id).items.map((i) => i.stale), [false, false]);
  songs.deleteHymn(a);
  assert.deepEqual(plans.getTemplate(saved.id).items.map((i) => i.stale), [true, false], 'only the deleted song is stale');
});

test('template names are unique ignoring letter case, limited in length, and a template needs items', () => {
  const { plans, hymn } = setup();
  const a = hymn('A');
  plans.saveTemplate({ name: 'Feast', items: [item('introductory', 'entrance', a)] });
  assert.throws(() => plans.saveTemplate({ name: 'feast', items: [item('introductory', 'entrance', a)] }), /already exists/);
  assert.throws(() => plans.saveTemplate({ name: '   ', items: [item('introductory', 'entrance', a)] }), /1 to 80/);
  assert.throws(() => plans.saveTemplate({ name: 'x'.repeat(81), items: [item('introductory', 'entrance', a)] }), /1 to 80/);
  assert.throws(() => plans.saveTemplate({ name: 'Empty', items: [] }), /at least one item/);
  assert.throws(() => plans.saveTemplate({ name: 'Bad', items: [item('introductory', 'entrance', a), item('introductory', 'entrance', a)] }), /same Holy Mass slot/);
});

test('deleting a template removes it, and a missing one is reported', () => {
  const { plans, hymn } = setup();
  const saved = plans.saveTemplate({ name: 'Gone', items: [item('introductory', 'entrance', hymn('A'))] });
  assert.equal(plans.deleteTemplate(saved.id), true);
  assert.deepEqual(plans.listTemplates(), []);
  assert.equal(plans.deleteTemplate(saved.id), false);
  assert.throws(() => plans.getTemplate(saved.id), /no longer exists/);
});

test('a slot goes through export and import with its plan, and a file from before slots imports its items as additional ones', () => {
  const { db, plans, hymn, plan } = setup();
  plans.savePlan(plan.id, [item('introductory', 'entrance', hymn('Exported'), 'Exported')]);
  const data = decodeTransfer(encodeTransfer(collectLibrary(db, { plans: true, songs: true, lyrics: true }, { laptop: 'PC1', exportedAt: '2026-11-03T05:00:00.000Z' })));
  assert.equal(data.plans[0].items[0].slot, 'entrance');
  const other = open();
  applyImport(other, data);
  assert.equal(other.prepare('SELECT slot FROM mass_plan_items').get().slot, 'entrance');
  for (const it of data.plans[0].items) delete it.slot;
  const older = open();
  applyImport(older, data);
  assert.equal(older.prepare('SELECT slot FROM mass_plan_items').get().slot, null);
});

test('the slot column and the templates table are added by the migration, and are the last in the list', () => {
  const db = open(false);
  assert.throws(() => db.prepare('SELECT slot FROM mass_plan_items').all());
  for (const sql of MASS_SLOT_MIGRATIONS) db.exec(sql);
  assert.deepEqual(db.prepare('SELECT slot FROM mass_plan_items').all(), []);
  assert.deepEqual(db.prepare('SELECT * FROM mass_plan_templates').all(), []);
});

test('the plan list counts each plan\'s items and names the slots they fill, for the planner calendar', () => {
  const { plans, hymn, plan } = setup();
  const empty = plans.createPlan({ name: 'Weekday', liturgicalDate: '2026-11-10' });
  plans.savePlan(plan.id, [
    item('introductory', 'entrance', hymn('Entrance song')),
    item('introductory', 'gloria', hymn('Gloria')),
    { block: 'introductory', module: 'custom', sourceId: 'Greeting', label: 'Greeting' },
  ]);
  const list = plans.listPlans();
  const saved = list.find((p) => p.id === plan.id);
  assert.equal(saved.itemCount, 3);
  assert.deepEqual([...saved.filledSlots].sort(), ['entrance', 'gloria']);
  assert.equal('slotList' in saved, false);
  const none = list.find((p) => p.id === empty.id);
  assert.equal(none.itemCount, 0);
  assert.deepEqual(none.filledSlots, []);
});

test('a plan keeps the language it is celebrated in: English unless made or set otherwise, and only EN, TL or CEB', () => {
  const { plans, plan } = setup();
  assert.equal(plan.language, 'EN');
  assert.equal(plans.getPlan(plan.id).language, 'EN');
  const tagalog = plans.createPlan({ name: 'Misa', liturgicalDate: '2026-11-08', language: 'TL' });
  assert.equal(plans.listPlans().find((p) => p.id === tagalog.id).language, 'TL');
  assert.equal(plans.setLanguage(plan.id, 'CEB'), 'CEB');
  assert.equal(plans.getPlan(plan.id).language, 'CEB');
  assert.throws(() => plans.setLanguage(plan.id, 'FR'), /EN, TL or CEB/);
  assert.equal(plans.getPlan(plan.id).language, 'CEB', 'a refused language changes nothing');
  assert.throws(() => plans.setLanguage(9999, 'EN'), /no longer exists/);
});
