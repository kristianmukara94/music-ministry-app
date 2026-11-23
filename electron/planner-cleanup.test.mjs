// Annual Planner Cleanup against the real schema: one atomic delete of a year's or chosen months' Holy Mass plans and Praise & Worship sessions,
// the plan on air in Go Live kept, cloud deletions recorded as sync tombstones, and a backup holding exactly the matching plans. Synthetic names
// only. Run with: node --test electron/planner-cleanup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, HYMN_FILING_MIGRATIONS, HYMN_FONT_SCALE_MIGRATIONS, HYMN_DEFAULT_SLIDES_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SCHEDULE_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS, PLAN_SLOT_TITLE_MIGRATIONS, createMassPlanService } = await import('./mass-plans.js');
const { PW_MIGRATIONS, createPwService } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS, decodeTransfer } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');
const { checkCleanupRequest, createPlannerCleanupService } = await import('./planner-cleanup.js');

function open() {
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
  for (const sql of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...HYMN_FILING_MIGRATIONS, ...HYMN_FONT_SCALE_MIGRATIONS, ...HYMN_DEFAULT_SLIDES_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS,
    ...MASS_SLOT_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS, ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS,
    ...PLAN_SLOT_TITLE_MIGRATIONS, ...MASS_SCHEDULE_MIGRATIONS]) {
    db.exec(sql);
  }
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

/** A parish with plans in 2025 (Jan x2 and Dec Mass, Jan and Jun Worship) and 2026 (one of each). */
function seed() {
  const db = open();
  const masses = createMassPlanService(db);
  const pws = createPwService(db);
  pws.seedDefaultTemplate();
  const mass = {
    jan1: masses.createPlan({ name: 'Sample Mass Plan', liturgicalDate: '2025-01-05' }).id,
    jan2: masses.createPlan({ name: 'Sample Mass Plan', liturgicalDate: '2025-01-26' }).id,
    dec: masses.createPlan({ name: 'Sample Mass Plan', liturgicalDate: '2025-12-25' }).id,
    now: masses.createPlan({ name: 'Sample Mass Plan', liturgicalDate: '2026-03-01' }).id,
  };
  const pw = {
    jan: pws.createSession({ name: 'Sample Worship Plan', liturgicalDate: '2025-01-12' }).id,
    jun: pws.createSession({ name: 'Sample Worship Plan', liturgicalDate: '2025-06-15' }).id,
    now: pws.createSession({ name: 'Sample Worship Plan', liturgicalDate: '2026-03-08' }).id,
  };
  return { db, masses, pws, mass, pw, cleanup: createPlannerCleanupService(db) };
}

const num = (a, b) => a - b;
const massIds = (s) => s.masses.listPlans().map((p) => p.id).sort(num);
const pwIds = (s) => s.pws.listSessions().map((p) => p.id).sort(num);
const sorted = (...ids) => ids.sort(num);
const count = (db, sql) => db.prepare(sql).get().n;

test('an entire year is deleted, and only that year', () => {
  const s = seed();
  const result = s.cleanup.bulkDelete({ year: 2025, months: null, planType: 'all' });
  assert.equal(result.deleted, 5);
  assert.equal(result.deletedMass, 3);
  assert.equal(result.deletedPw, 2);
  assert.deepEqual(massIds(s), [s.mass.now]);
  assert.deepEqual(pwIds(s), [s.pw.now]);
});

test('selected months delete only those months', () => {
  const s = seed();
  const result = s.cleanup.bulkDelete({ year: 2025, months: [0], planType: 'all' });
  assert.equal(result.deleted, 3);
  assert.deepEqual(massIds(s), sorted(s.mass.dec, s.mass.now));
  assert.deepEqual(pwIds(s), sorted(s.pw.jun, s.pw.now));
});

test('the plan type limits a cleanup to Holy Mass or to Praise & Worship', () => {
  const a = seed();
  a.cleanup.bulkDelete({ year: 2025, planType: 'mass' });
  assert.deepEqual(massIds(a), [a.mass.now]);
  assert.equal(pwIds(a).length, 3);

  const b = seed();
  b.cleanup.bulkDelete({ year: 2025, planType: 'pw' });
  assert.equal(massIds(b).length, 4);
  assert.deepEqual(pwIds(b), [b.pw.now]);
});

test('a month scope with no month picked, or a year with no plans, deletes nothing', () => {
  const s = seed();
  assert.equal(s.cleanup.bulkDelete({ year: 2025, months: [] }).deleted, 0);
  assert.equal(s.cleanup.bulkDelete({ year: 2019, months: null }).deleted, 0);
  assert.equal(massIds(s).length, 4);
  assert.equal(pwIds(s).length, 3);
});

test('a plan has its slots and segments removed with it, and the other plans keep theirs', () => {
  const s = seed();
  const item = "INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, 'word', 'announcements', '1', 'Sample item', 0)";
  s.db.prepare(item).run(s.mass.jan1);
  s.db.prepare(item).run(s.mass.now);
  assert.ok(count(s.db, `SELECT COUNT(*) AS n FROM pw_segments WHERE session_id = ${s.pw.jan}`) > 0, 'a new session starts with its segments');
  s.cleanup.bulkDelete({ year: 2025 });
  assert.equal(count(s.db, `SELECT COUNT(*) AS n FROM mass_plan_items WHERE plan_id = ${s.mass.jan1}`), 0);
  assert.equal(count(s.db, `SELECT COUNT(*) AS n FROM mass_plan_items WHERE plan_id = ${s.mass.now}`), 1);
  assert.equal(count(s.db, `SELECT COUNT(*) AS n FROM pw_segments WHERE session_id = ${s.pw.jan}`), 0);
  assert.ok(count(s.db, `SELECT COUNT(*) AS n FROM pw_segments WHERE session_id = ${s.pw.now}`) > 0);
});

test('the delete is atomic: a failure part-way leaves every plan in place and no tombstone', () => {
  const s = seed();
  // A later Holy Mass plan cannot be deleted, so the whole cleanup must roll back, including the ones already removed.
  s.db.exec(`CREATE TRIGGER block_one BEFORE DELETE ON mass_plans WHEN OLD.id = ${s.mass.dec} BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);
  assert.throws(() => s.cleanup.bulkDelete({ year: 2025, deleteFromCloud: true }), /blocked/);
  assert.equal(massIds(s).length, 4);
  assert.equal(pwIds(s).length, 3);
  assert.equal(count(s.db, 'SELECT COUNT(*) AS n FROM sync_tombstones'), 0);
});

test('a plan loaded on air in Go Live is kept and reported, and the rest still go', () => {
  const s = seed();
  const result = s.cleanup.bulkDelete({ year: 2025, protectedMassIds: [s.mass.jan1], protectedPwIds: [s.pw.jun] });
  assert.equal(result.deleted, 3);
  assert.deepEqual(result.skipped.map((p) => `${p.kind}:${p.id}`).sort(), [`mass:${s.mass.jan1}`, `pw:${s.pw.jun}`].sort());
  assert.deepEqual(massIds(s), sorted(s.mass.jan1, s.mass.now));
  assert.deepEqual(pwIds(s), sorted(s.pw.jun, s.pw.now));
  assert.equal(count(s.db, 'SELECT COUNT(*) AS n FROM sync_tombstones'), 0);
});

test('with cloud deletion on, every removed plan leaves a tombstone of its kind, so the website drops it and it is not pulled back', () => {
  const s = seed();
  const uuids = {
    mass: s.db.prepare("SELECT uuid FROM mass_plans WHERE liturgical_date LIKE '2025-%'").all().map((r) => r.uuid).sort(),
    praise: s.db.prepare("SELECT uuid FROM pw_sessions WHERE liturgical_date LIKE '2025-%'").all().map((r) => r.uuid).sort(),
  };
  const result = s.cleanup.bulkDelete({ year: 2025, deleteFromCloud: true });
  assert.equal(result.deletedFromCloud, true);
  const stones = s.db.prepare('SELECT uuid, plan_kind AS kind FROM sync_tombstones').all();
  assert.deepEqual(stones.filter((t) => t.kind === 'mass').map((t) => t.uuid).sort(), uuids.mass);
  assert.deepEqual(stones.filter((t) => t.kind === 'praise').map((t) => t.uuid).sort(), uuids.praise);
  assert.equal(stones.length, 5);
});

test('with cloud deletion off, nothing is queued for the cloud', () => {
  const s = seed();
  s.cleanup.bulkDelete({ year: 2025, deleteFromCloud: false });
  assert.equal(count(s.db, 'SELECT COUNT(*) AS n FROM sync_tombstones'), 0);
});

test('the request is checked: a year is required, and the type, months and cloud flag are cleaned', () => {
  assert.throws(() => checkCleanupRequest({}), /year/);
  assert.throws(() => checkCleanupRequest({ year: 'soon' }), /year/);
  const ok = checkCleanupRequest({ year: '2025', months: [3, 3, 99], planType: 'bogus', deleteFromCloud: 'yes' });
  assert.equal(ok.year, 2025);
  assert.deepEqual(ok.months, [3]);
  assert.equal(ok.planType, 'all');
  assert.equal(ok.deleteFromCloud, false);
});

test('the backup holds exactly the matching plans, none of the others, and deletes nothing', () => {
  const s = seed();
  const backup = s.cleanup.backupText({ year: 2025, months: [0], planType: 'all' });
  const data = decodeTransfer(backup.text);
  assert.equal(data.plans.length, 2);
  assert.equal(data.praiseWorship.length, 1);
  assert.ok(data.plans.every((p) => p.liturgicalDate.startsWith('2025-01')));
  assert.equal(data.praiseWorship[0].liturgicalDate, '2025-01-12');
  assert.equal(massIds(s).length, 4);
  assert.equal(s.cleanup.backupText({ year: 2019 }), null);
});

test('the backup of a Holy Mass only cleanup leaves Praise & Worship out', () => {
  const s = seed();
  const data = decodeTransfer(s.cleanup.backupText({ year: 2025, planType: 'mass' }).text);
  assert.equal(data.plans.length, 3);
  assert.equal(data.praiseWorship?.length ?? 0, 0);
});
