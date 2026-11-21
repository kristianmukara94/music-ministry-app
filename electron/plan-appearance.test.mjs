// Plan Appearance storage, against the real schema: the appearance_json columns on Holy Mass plans and Praise & Worship plans, the service,
// duplication, the .apccmma export and import, and Cloud Sync leaving it alone. Synthetic names only.
// Run with: node --test electron/plan-appearance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, HYMN_FILING_MIGRATIONS, HYMN_FONT_SCALE_MIGRATIONS, HYMN_DEFAULT_SLIDES_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SCHEDULE_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS, PLAN_SLOT_TITLE_MIGRATIONS, createMassPlanService } =
  await import('./mass-plans.js');
const { PW_MIGRATIONS, createPwService } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS, applyImport, collectLibrary, decodeTransfer, encodeTransfer } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');
const { PLAN_APPEARANCE_MIGRATIONS, copyName, createPlanAppearanceService, hasAppearanceColumn } = await import('./plan-appearance.js');
const { sanitizePlanAppearance, PLAN_APPEARANCE_DEFAULT } = await import('../shared/plan-appearance.js');

const DAY = '2026-12-06';

const LOOK = sanitizePlanAppearance({
  enabled: true,
  background: { type: 'image', color: '#0F2A4A', mediaPath: 'apcc-media://media/1', dimOpacity: 0.4 },
  typography: { fontFamily: 'serif', fontSizeScale: 1.15, fontWeight: 'bold', textCase: 'upper', textAlign: 'center', textColor: '#FFFFFF', textShadow: true },
});

function open({ withAppearance = true } = {}) {
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
  for (const sql of [
    ...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...HYMN_FILING_MIGRATIONS, ...HYMN_FONT_SCALE_MIGRATIONS, ...HYMN_DEFAULT_SLIDES_MIGRATIONS,
    ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS, ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS,
    ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS, ...MASS_SLOT_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS,
    ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS, ...PLAN_SLOT_TITLE_MIGRATIONS, ...MASS_SCHEDULE_MIGRATIONS,
    ...(withAppearance ? PLAN_APPEARANCE_MIGRATIONS : []),
  ]) {
    db.exec(sql);
  }
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

/** A Holy Mass plan with one song row and a Praise & Worship plan with one prayer segment. */
function seed(db) {
  const hymn = Number(db.prepare("INSERT INTO hymns (title, composer, category, language) VALUES ('Sample Song Title', 'Sample Composer', 'Entrance', 'EN')").run().lastInsertRowid);
  db.prepare("INSERT INTO hymn_stanzas (hymn_id, stanza_type, lyrics_text, display_order) VALUES (?, 'Verse', 'Sample Song Line', 1)").run(hymn);
  const masses = createMassPlanService(db);
  const mass = masses.createPlan({ name: 'Sample Plan Title', liturgicalDate: DAY, massTime: '6:00 AM', massLanguage: 'English' });
  masses.savePlan(mass.id, [{ block: 'introductory', module: 'lyrics', sourceId: String(hymn), label: 'Sample Song Title', slot: null }]);
  const sessions = createPwService(db);
  sessions.seedDefaultTemplate();
  const session = sessions.createSession({ name: 'Sample Praise Plan', liturgicalDate: DAY });
  return { hymn, mass, session, masses, sessions };
}

test('the appearance columns are the last migrations: additive, nullable, one per plan table', () => {
  const list = readFileSync(new URL('./announcements.js', import.meta.url), 'utf8');
  assert.match(list, /\.\.\.HYMN_DEFAULT_SLIDES_MIGRATIONS,\s*\.\.\.PLAN_APPEARANCE_MIGRATIONS,\s*\];/);
  assert.deepEqual(PLAN_APPEARANCE_MIGRATIONS, ['ALTER TABLE mass_plans ADD COLUMN appearance_json TEXT;', 'ALTER TABLE pw_sessions ADD COLUMN appearance_json TEXT;']);
  const db = open();
  const { mass, session } = seed(db);
  assert.equal(hasAppearanceColumn(db, 'mass_plans'), true);
  assert.equal(hasAppearanceColumn(db, 'pw_sessions'), true);
  assert.equal(db.prepare('SELECT appearance_json AS j FROM mass_plans WHERE id = ?').get(mass.id).j, null, 'a plan made before keeps NULL');
  assert.equal(db.prepare('SELECT appearance_json AS j FROM pw_sessions WHERE id = ?').get(session.id).j, null);
});

test('a database built without the columns still opens every other plan query, and says so for the appearance', () => {
  const db = open({ withAppearance: false });
  const { masses, mass, sessions, session } = seed(db);
  assert.equal(masses.getPlan(mass.id).items.length, 1);
  assert.equal(sessions.getSession(session.id).name, 'Sample Praise Plan');
  assert.throws(() => createPlanAppearanceService(db).get('mass', mass.id), /Restart the app/);
});

test('Holy Mass and Praise & Worship plans save and read their appearance; the default is stored as NULL', () => {
  const db = open();
  const { mass, session } = seed(db);
  const looks = createPlanAppearanceService(db);
  assert.deepEqual(looks.get('mass', mass.id), sanitizePlanAppearance(PLAN_APPEARANCE_DEFAULT), 'Use Global Default until set');

  assert.deepEqual(looks.set('mass', mass.id, LOOK), LOOK);
  assert.deepEqual(looks.get('mass', mass.id), LOOK);
  const pwLook = { ...LOOK, background: { type: 'motion', color: '#000000', mediaPath: 'apcc-media://media/2', dimOpacity: 0.6 } };
  looks.set('pw', session.id, pwLook);
  assert.equal(looks.get('pw', session.id).background.type, 'motion');
  assert.equal(looks.get('mass', mass.id).background.type, 'image', 'each plan keeps its own');

  // A fresh service (an app restart) reads the same.
  assert.deepEqual(createPlanAppearanceService(db).get('mass', mass.id), LOOK);

  looks.set('mass', mass.id, PLAN_APPEARANCE_DEFAULT);
  assert.equal(db.prepare('SELECT appearance_json AS j FROM mass_plans WHERE id = ?').get(mass.id).j, null, 'Reset to Default clears the column');
});

test('bad input is cleaned, and a plan that is gone or a kind that is unknown is refused', () => {
  const db = open();
  const { mass } = seed(db);
  const looks = createPlanAppearanceService(db);
  const kept = looks.set('mass', mass.id, { enabled: true, background: { type: 'image', mediaPath: 'C:/sample.png' }, typography: { fontFamily: 'Unknown' }, extra: 1 });
  assert.deepEqual(kept, { enabled: true, background: { type: 'image', color: '#000000', dimOpacity: 0 }, typography: {} });
  assert.throws(() => looks.get('mass', 999), /no longer exists/);
  assert.throws(() => looks.set('other', mass.id, LOOK), /Holy Mass plan or a Praise & Worship plan/);
});

test('Duplicate copies a Holy Mass plan with its lineup, language and appearance, on the same day with no time', () => {
  const db = open();
  const { masses, mass } = seed(db);
  const looks = createPlanAppearanceService(db);
  looks.set('mass', mass.id, LOOK);
  masses.setSlotTitle(mass.id, false);
  const copy = masses.duplicatePlan(mass.id);
  assert.notEqual(copy.id, mass.id);
  assert.equal(copy.name, 'Sample Plan Title (Copy)');
  assert.equal(copy.liturgicalDate, DAY);
  assert.equal(copy.massTime, '', 'two Holy Masses on one day may not share a time');
  assert.equal(copy.massLanguage, 'English');
  assert.deepEqual(looks.get('mass', copy.id), LOOK);
  assert.equal(masses.getSlotTitle(copy.id), false);
  assert.deepEqual(masses.getPlan(copy.id).items.map((i) => i.label), ['Sample Song Title']);
  const uuids = db.prepare('SELECT uuid FROM mass_plans').all().map((r) => r.uuid);
  assert.equal(new Set(uuids).size, uuids.length, 'the copy is a plan of its own for sync and transfer');
  // The copy is independent.
  looks.set('mass', copy.id, PLAN_APPEARANCE_DEFAULT);
  assert.deepEqual(looks.get('mass', mass.id), LOOK);
});

test('Duplicate copies a Praise & Worship plan with its segments and appearance', () => {
  const db = open();
  const { sessions, session } = seed(db);
  const looks = createPlanAppearanceService(db);
  looks.set('pw', session.id, LOOK);
  const copy = sessions.duplicateSession(session.id);
  assert.equal(copy.name, 'Sample Praise Plan (Copy)');
  assert.equal(copy.liturgicalDate, DAY);
  assert.deepEqual(copy.segments.map((s) => s.segmentKey), sessions.getSession(session.id).segments.map((s) => s.segmentKey));
  assert.deepEqual(looks.get('pw', copy.id), LOOK);
  assert.equal(copyName('x'.repeat(200), 120).length, 120, 'a long name stays within the limit');
});

test('.apccmma export and import carry each plan’s appearance; a picture this laptop lacks falls back to its colour', () => {
  const source = open();
  const { mass, session } = seed(source);
  const looks = createPlanAppearanceService(source);
  looks.set('mass', mass.id, LOOK);
  looks.set('pw', session.id, { ...LOOK, background: { type: 'color', color: '#4A1E2E', dimOpacity: 0.1 } });
  const data = decodeTransfer(encodeTransfer(collectLibrary(source, { plans: true, setlists: true, praiseWorship: true, songs: true, lyrics: true }, { laptop: 'PC1' })));
  assert.deepEqual(data.plans[0].appearance, LOOK);
  assert.equal(data.praiseWorship[0].appearance.background.color, '#4A1E2E');

  const target = open();
  // This laptop has media id 1, so the picture is kept.
  target.prepare("INSERT INTO media_assets (id, filename, file_path, media_type) VALUES (1, 'sample.png', 'media/sample.png', 'image')").run();
  applyImport(target, data);
  const targetLooks = createPlanAppearanceService(target);
  const planId = target.prepare('SELECT id FROM mass_plans').get().id;
  const sessionId = target.prepare('SELECT id FROM pw_sessions').get().id;
  assert.deepEqual(targetLooks.get('mass', planId), LOOK);
  assert.equal(targetLooks.get('pw', sessionId).background.color, '#4A1E2E');

  const bare = open();
  applyImport(bare, data);
  const bareLook = createPlanAppearanceService(bare).get('mass', bare.prepare('SELECT id FROM mass_plans').get().id);
  assert.deepEqual(bareLook.background, { type: 'color', color: '#0F2A4A', dimOpacity: 0.4 }, 'no such picture here');
  assert.deepEqual(bareLook.typography, LOOK.typography);
});

test('an import keeps the local look when the file is from before Plan Appearance, and follows the file when it says Global', () => {
  const source = open();
  seed(source);
  const data = decodeTransfer(encodeTransfer(collectLibrary(source, { plans: true, setlists: false, praiseWorship: true, songs: true, lyrics: true }, { laptop: 'PC1' })));
  assert.equal(data.plans[0].appearance, null, 'a plan on the Global Appearance writes null, not nothing');

  const target = open();
  applyImport(target, data);
  const planId = target.prepare('SELECT id FROM mass_plans').get().id;
  createPlanAppearanceService(target).set('mass', planId, LOOK);

  // An older file: no appearance key at all. Taking its version of the plan keeps this laptop's look.
  const older = structuredClone(data);
  delete older.plans[0].appearance;
  older.plans[0].updatedAt = '2099-01-01T00:00:00.000Z';
  applyImport(target, older, { [`plans:${older.plans[0].id}`]: 'use' });
  assert.deepEqual(createPlanAppearanceService(target).get('mass', planId), LOOK);

  // A newer file that says the plan follows the Global Appearance.
  const global = structuredClone(data);
  global.plans[0].updatedAt = '2099-02-01T00:00:00.000Z';
  applyImport(target, global, { [`plans:${global.plans[0].id}`]: 'use' });
  assert.equal(createPlanAppearanceService(target).get('mass', planId).enabled, false);
});

test('Cloud Sync never reads or writes the appearance, and its pull updates name their columns, so the look is kept', () => {
  const store = readFileSync(new URL('./plan-sync-store.js', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('./plan-sync.js', import.meta.url), 'utf8');
  const map = readFileSync(new URL('./plan-sync-map.js', import.meta.url), 'utf8');
  for (const source of [store, sync, map]) assert.doesNotMatch(source, /appearance/i);
  assert.doesNotMatch(store, /INSERT OR REPLACE INTO (mass_plans|pw_sessions)/);
  assert.match(store, /UPDATE mass_plans SET name = \?, liturgical_date = \?, updated_at = \? WHERE id = \?/);

  // The pull's own update, run on a plan with a look: the look stays.
  const db = open();
  const { mass } = seed(db);
  createPlanAppearanceService(db).set('mass', mass.id, LOOK);
  db.prepare('UPDATE mass_plans SET name = ?, liturgical_date = ?, updated_at = ? WHERE id = ?').run('Sample Plan Title Two', DAY, '2099-01-01T00:00:00.000Z', mass.id);
  assert.deepEqual(createPlanAppearanceService(db).get('mass', mass.id), LOOK);
});
