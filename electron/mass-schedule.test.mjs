// Several Holy Mass plans on one day, told apart by their time and language (mass_time, mass_language), against the real schema. Synthetic
// names only. Run with: node --test electron/mass-schedule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, HYMN_FILING_MIGRATIONS, HYMN_FONT_SCALE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, MASS_SCHEDULE_MIGRATIONS, MASS_SLOT_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS, PLAN_SLOT_TITLE_MIGRATIONS, createMassPlanService } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_CATEGORY_MODE_MIGRATIONS, SONG_SCOPE_MIGRATIONS } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { LECTIONARY_MIGRATIONS } = await import('./lectionary.js');
const { MEDIA_MIGRATIONS } = await import('./media.js');
const { BIBLE_MIGRATIONS } = await import('./bible-seed.js');
const { PRAYER_NOTES_MIGRATIONS } = await import('./notes.js');
import { readFileSync } from 'node:fs';

const DAY = '2026-12-06';

function open({ withSchedule = true } = {}) {
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
  for (const sql of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...HYMN_FILING_MIGRATIONS, ...HYMN_FONT_SCALE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...SONG_CATEGORY_MODE_MIGRATIONS,
    ...MASS_SLOT_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS, ...LECTIONARY_MIGRATIONS, ...MEDIA_MIGRATIONS, ...BIBLE_MIGRATIONS, ...PRAYER_NOTES_MIGRATIONS,
    ...PLAN_SLOT_TITLE_MIGRATIONS, ...(withSchedule ? MASS_SCHEDULE_MIGRATIONS : [])]) {
    db.exec(sql);
  }
  db.exec('CREATE TABLE IF NOT EXISTS announcement_slides (id INTEGER PRIMARY KEY)');
  return db;
}

const onDay = (plans, iso = DAY) => plans.listPlans().filter((p) => p.liturgicalDate === iso);

test('the schedule columns are appended to the end of the migration list, additive and defaulting to blank', () => {
  const list = readFileSync(new URL('./announcements.js', import.meta.url), 'utf8');
  assert.match(list, /\.\.\.HYMN_FONT_SCALE_MIGRATIONS,\s*\.\.\.MASS_SCHEDULE_MIGRATIONS,\s*\];/);
  for (const sql of MASS_SCHEDULE_MIGRATIONS) assert.match(sql, /^ALTER TABLE mass_plans ADD COLUMN mass_(time|language) TEXT DEFAULT '';$/);
});

test('three Holy Masses save on the same day and load in the order they are celebrated, whatever order they were made in', () => {
  const plans = createMassPlanService(open());
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '9:30 AM', massLanguage: 'Tagalog' });
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '6:00 AM', massLanguage: 'English' });
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '08:00', massLanguage: 'cebuano' });
  plans.createPlan({ name: 'Sample Liturgical Title', liturgicalDate: '2026-12-13', massTime: '6:00 AM', massLanguage: 'English' });

  const day = onDay(plans);
  assert.deepEqual(day.map((p) => [p.massTime, p.massLanguage]), [['6:00 AM', 'English'], ['08:00', 'Cebuano'], ['9:30 AM', 'Tagalog']]);
  // Days stay newest first, as before.
  assert.equal(plans.listPlans()[0].liturgicalDate, '2026-12-13');
  // Each opens on its own: the editor reads its schedule.
  const tagalog = plans.getPlan(day[2].id);
  assert.equal(tagalog.massTime, '9:30 AM');
  assert.equal(tagalog.massLanguage, 'Tagalog');
});

test('a Tagalog or Cebuano Holy Mass drafts its texts in that language unless the planner names one', () => {
  const plans = createMassPlanService(open());
  assert.equal(plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '8:00 AM', massLanguage: 'Cebuano' }).language, 'CEB');
  assert.equal(plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '9:30 AM', massLanguage: 'Tagalog' }).language, 'TL');
  assert.equal(plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '5:00 PM', massLanguage: 'Sample Language' }).language, 'EN');
  assert.equal(plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '7:00 PM', massLanguage: 'Tagalog', language: 'EN' }).language, 'EN');
});

test('a second Holy Mass at the same time on the same day is refused, whatever its language; another time or another day is fine', () => {
  const plans = createMassPlanService(open());
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '6:00 AM', massLanguage: 'English' });
  assert.throws(() => plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '06:00', massLanguage: 'english' }), /A Holy Mass at 6:00 AM \(English\) already exists on this date\./);
  assert.throws(() => plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '6 am', massLanguage: 'Cebuano' }), /already exists on this date/);
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '8:00 AM', massLanguage: 'Cebuano' });
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: '2026-12-13', massTime: '6:00 AM', massLanguage: 'English' });
  assert.equal(onDay(plans).length, 2);
});

test('a plan from before schedules stays readable and editable, and is listed after the timed Holy Masses of its day', () => {
  const db = open();
  // Made the old way: no schedule columns written at all.
  db.prepare("INSERT INTO mass_plans (name, liturgical_date, language) VALUES ('Sample Liturgical Title', ?, 'EN')").run(DAY);
  const plans = createMassPlanService(db);
  const [legacy] = plans.listPlans();
  assert.equal(legacy.massTime, '');
  assert.equal(legacy.massLanguage, '');
  assert.equal(plans.getPlan(legacy.id).massTime, '');
  assert.equal(plans.savePlan(legacy.id, [{ block: 'introductory', module: 'custom', sourceId: 'Sample Mass Item', label: 'Sample Mass Item' }]), 1);

  // Untimed plans never clash, and sort after a timed Holy Mass on the same day.
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY });
  plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '5:00 PM', massLanguage: 'English' });
  assert.deepEqual(onDay(plans).map((p) => p.massTime), ['5:00 PM', '', '']);
  assert.equal(onDay(plans)[1].id, legacy.id, 'blank times keep the order they were made in');

  // Its schedule can be set later.
  assert.deepEqual(plans.setSchedule(legacy.id, { massTime: ' 6:00  AM ', massLanguage: 'TL' }), { massTime: '6:00 AM', massLanguage: 'Tagalog' });
  assert.equal(onDay(plans)[0].id, legacy.id);
  assert.equal(plans.getPlan(legacy.id).items.length, 1, 'its items are untouched');
});

test('editing a schedule into one another plan on the day already has is refused; keeping its own is fine', () => {
  const plans = createMassPlanService(open());
  const six = plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '6:00 AM', massLanguage: 'English' });
  const eight = plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '8:00 AM', massLanguage: 'Cebuano' });
  assert.throws(() => plans.setSchedule(eight.id, { massTime: '06:00', massLanguage: 'Cebuano' }), /already exists on this date/);
  assert.deepEqual(plans.setSchedule(six.id, { massTime: '6:00 AM', massLanguage: 'English' }), { massTime: '6:00 AM', massLanguage: 'English' });
  assert.deepEqual(plans.setSchedule(six.id, { massTime: '', massLanguage: '' }), { massTime: '', massLanguage: '' });
});

test('a database built without the schedule columns still lists, makes and opens plans', () => {
  const plans = createMassPlanService(open({ withSchedule: false }));
  const made = plans.createPlan({ name: 'Sample Mass Item', liturgicalDate: DAY, massTime: '6:00 AM', massLanguage: 'English' });
  assert.equal(made.massTime, '');
  assert.equal(plans.listPlans()[0].massLanguage, '');
  assert.equal(plans.getPlan(made.id).name, 'Sample Mass Item');
  assert.throws(() => plans.setSchedule(made.id, { massTime: '6:00 AM', massLanguage: 'English' }), /cannot keep Holy Mass times/);
});
