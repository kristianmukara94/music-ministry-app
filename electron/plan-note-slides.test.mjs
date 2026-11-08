// Holy Mass rows that play some of a Liturgical Content Hub entry's slides, against the real schema: the row's source id carries the note
// (`note_id`) and the slides (`slide_indices`), it saves and reads back as it was put in, two rows can play different slides of one entry,
// and a deleted entry marks its rows stale. Run with: node --test electron/plan-note-slides.test.mjs
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
const { NOTES_SLOT_MIGRATIONS, PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');
const { dividedNote, noteSource, noteSourceId } = await import('../shared/notes.js');
const { insertIntoMassFlow } = await import('../shared/flow-insert.js');

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
    ...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS, ...NOTES_SLOT_MIGRATIONS]) {
    db.exec(sql);
  }
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  const notes = createNotesService(db);
  const plans = createMassPlanService(db);
  const plan = plans.createPlan({ name: 'Sunday', liturgicalDate: '2026-11-08' });
  return { notes, plans, plan };
}

const novena = (notes) => {
  const { body, split } = dividedNote(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].join('\n---\n'));
  return notes.save({ title: 'Novena', category: 'Novena', body, split, display: 'full', style: null });
};

test('slides 2 and 3 of a prayer go into a slot as one row that remembers the note and the slides', () => {
  const { notes, plans, plan } = setup();
  const note = novena(notes);
  const row = { module: 'notes', sourceId: noteSourceId(note.id, [1, 2]), label: 'Novena · Slides 2–3' };
  const placed = insertIntoMassFlow([], [row], { kind: 'slot', slot: 'prayer-faithful' });
  plans.savePlan(plan.id, placed.items);
  const [item] = plans.getPlan(plan.id).items;
  assert.equal(item.slot, 'prayer-faithful');
  assert.equal(item.stale, false);
  assert.deepEqual(noteSource(item.sourceId), { id: note.id, slides: [1, 2] });
});

test('two rows can play different slides of one entry, beside the whole entry', () => {
  const { notes, plans, plan } = setup();
  const note = novena(notes);
  const rows = [String(note.id), noteSourceId(note.id, [0]), noteSourceId(note.id, [4, 5, 6])].map((sourceId) => ({ block: 'word', module: 'notes', sourceId, label: 'Novena', slot: null }));
  plans.savePlan(plan.id, rows);
  assert.deepEqual(
    plans.getPlan(plan.id).items.map((i) => [i.sourceId, Boolean(i.stale)]),
    [[String(note.id), false], [`${note.id}:0`, false], [`${note.id}:4-6`, false]],
  );
});

test('an entry deleted from the Hub marks its partial rows stale, and a plan cannot be saved pointing at it', () => {
  const { notes, plans, plan } = setup();
  const note = novena(notes);
  const row = { block: 'word', module: 'notes', sourceId: noteSourceId(note.id, [1, 2]), label: 'Novena', slot: null };
  plans.savePlan(plan.id, [row]);
  notes.remove(note.id);
  assert.equal(plans.getPlan(plan.id).items[0].stale, true);
  assert.throws(() => plans.savePlan(plan.id, [row]), /no longer exists/);
});

test('a source id that names no note is refused', () => {
  const { plans, plan } = setup();
  assert.throws(() => plans.savePlan(plan.id, [{ block: 'word', module: 'notes', sourceId: 'abc:1', label: 'X', slot: null }]), /no longer exists/);
});
