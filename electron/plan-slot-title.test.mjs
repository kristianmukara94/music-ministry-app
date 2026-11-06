// A Holy Mass plan's own choice for the slot title banner on its slides, against the real schema. Run with: node --test electron/plan-slot-title.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS, PLAN_SLOT_TITLE_MIGRATIONS, createMassPlanService } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');

function open(withSlots = true, withSlotTitle = true) {
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
    ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS, ...(withSlotTitle ? PLAN_SLOT_TITLE_MIGRATIONS : [])]) {
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

test('a plan follows the projector setting until it is given its own choice', () => {
  const { plans, plan } = setup();
  assert.equal(plans.getSlotTitle(plan.id), null);
  assert.equal(plans.setSlotTitle(plan.id, false), false);
  assert.equal(plans.getSlotTitle(plan.id), false);
  plans.setSlotTitle(plan.id, true);
  assert.equal(plans.getSlotTitle(plan.id), true);
  plans.setSlotTitle(plan.id, null);
  assert.equal(plans.getSlotTitle(plan.id), null);
});

test('only on, off or follow is saved, and only for a plan that exists', () => {
  const { plans, plan } = setup();
  assert.throws(() => plans.setSlotTitle(plan.id, 'hide'), /on, off, or follow/);
  assert.throws(() => plans.setSlotTitle(9999, true), /no longer exists/);
  assert.throws(() => plans.getSlotTitle(9999), /no longer exists/);
});

test('a database without the column still opens the plan service and its other queries', () => {
  const db = open(true, false);
  const plans = createMassPlanService(db);
  const plan = plans.createPlan({ name: 'Old', liturgicalDate: '2026-11-08' });
  assert.equal(plans.getPlan(plan.id).name, 'Old');
});
