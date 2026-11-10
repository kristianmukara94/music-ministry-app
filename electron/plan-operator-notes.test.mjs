// Notes & Prayers rows in a Holy Mass plan, against the real schema: a prayer and a private operator note can both fill a slot or follow
// one (the Liturgical Plan's Notes & Prayers tab drags either in), they read back as saved, and a deleted note is marked stale rather than
// dropped. The projector never shows an operator note; that is src/notes/present.ts, not the plan.
// Run with: node --test electron/plan-operator-notes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS, createMassPlanService } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { NOTES_COPY_MIGRATIONS, NOTES_SLOT_MIGRATIONS, PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');

function setup() {
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
    ...MASS_SLOT_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS, ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS,
    ...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS, ...NOTES_SLOT_MIGRATIONS, ...NOTES_COPY_MIGRATIONS]) {
    db.exec(sql);
  }
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  const notes = createNotesService(db);
  const plans = createMassPlanService(db);
  const plan = plans.createPlan({ name: 'Sunday', liturgicalDate: '2026-11-08' });
  return { notes, plans, plan };
}

const row = (note, slot = null) => ({ block: 'word', module: 'notes', sourceId: String(note.id), label: note.title, slot });

test('a private operator note can fill a slot and follow one, next to a prayer', () => {
  const { notes, plans, plan } = setup();
  const prayer = notes.save({ title: 'For the sick', category: 'Mass Intention', body: 'Lord, heal…', display: 'full', style: null });
  const cue = notes.save({ title: 'Ring the bell', category: 'Liturgical Cue', body: '', display: 'operator', style: null });
  plans.savePlan(plan.id, [row(prayer, 'prayer-faithful'), row(cue)]);
  const items = plans.getPlan(plan.id).items;
  assert.deepEqual(items.map((i) => [i.module, i.label, i.slot ?? null, Boolean(i.stale)]), [
    ['notes', 'For the sick', 'prayer-faithful', false],
    ['notes', 'Ring the bell', null, false],
  ]);
  // The cue alone in a slot is kept too.
  plans.savePlan(plan.id, [row(cue, 'prayer-faithful')]);
  assert.equal(plans.getPlan(plan.id).items[0].slot, 'prayer-faithful');
});

test('a note deleted from Notes & Prayers is marked stale in the plan, not dropped', () => {
  const { notes, plans, plan } = setup();
  const cue = notes.save({ title: 'Ring the bell', category: 'Liturgical Cue', body: '', display: 'operator', style: null });
  plans.savePlan(plan.id, [row(cue)]);
  notes.remove(cue.id);
  const [item] = plans.getPlan(plan.id).items;
  assert.equal(item.label, 'Ring the bell');
  assert.equal(item.stale, true);
  // The plan still saves with the row it already had, so an unrelated edit never fails over it; the row stays marked missing.
  plans.savePlan(plan.id, [row(cue)]);
  assert.equal(plans.getPlan(plan.id).items[0].stale, true);
  // A plan without it cannot add it back.
  plans.savePlan(plan.id, []);
  assert.throws(() => plans.savePlan(plan.id, [row(cue)]), /no longer exists/);
});
