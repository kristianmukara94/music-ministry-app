import { ipcMain } from 'electron';
import { parseSourceId } from '../shared/bible-ref.js';
import { GOSPEL_ACCLAMATION } from './lectionary.js';
import { recordTombstone } from './plan-sync-schema.js';
import { copyName } from './plan-appearance.js';
import { isSlotId } from '../shared/mass-slots.js';
import { noteSource } from '../shared/notes.js';
import { announcementSource } from '../shared/flow-insert.js';
import { DEFAULT_MASS_LANGUAGE, isMassLanguage, massLanguageOf } from '../shared/mass-language.js';
import { findTimeConflict, normalizeMassLanguage, normalizeMassTime, planLanguageForSchedule, sortMassSchedules, timeConflictText } from '../shared/mass-schedule.js';

export const PLAN_BLOCKS = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];
export const PLAN_MODULES = ['lyrics', 'lectionary', 'announcements', 'media', 'mass_order', 'bible', 'custom', 'notes'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 120;
const MAX_LABEL = 200;
const MAX_CUSTOM = 300;
const MAX_ITEMS = 300;
// A built-in part (kyrie, agnus-dei) or a parish item (mass_order_custom_<uuid>, see electron/mass-order.js).
const MASS_PART = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * A Mass plan: an ordered list of items in fixed liturgical blocks. `source_id` is
 * text because it points at different tables (or at a Mass Order part key). Existence
 * is checked when a plan is saved; `label` is a snapshot so the plan reads well even
 * if the source is renamed later.
 */
export const MASS_PLAN_MIGRATIONS = [
  `
  CREATE TABLE mass_plans (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    liturgical_date  TEXT NOT NULL CHECK (liturgical_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE mass_plan_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id           INTEGER NOT NULL REFERENCES mass_plans(id) ON DELETE CASCADE,
    liturgical_block  TEXT NOT NULL CHECK (liturgical_block IN ('introductory', 'word', 'eucharist', 'concluding')),
    source_module     TEXT NOT NULL CHECK (source_module IN ('lyrics', 'lectionary', 'announcements', 'media', 'mass_order')),
    source_id         TEXT NOT NULL,
    label             TEXT NOT NULL,
    display_order     INTEGER NOT NULL
  );
  CREATE INDEX idx_mass_plan_items_order ON mass_plan_items (plan_id, liturgical_block, display_order);
  `,
];

/**
 * Rebuilds mass_plan_items so its CHECK constraint accepts 'bible'. SQLite cannot change a
 * CHECK in place, so the table is copied. Existing rows keep their ids and order.
 */
export const PLAN_BIBLE_MIGRATIONS = [
  `
  CREATE TABLE mass_plan_items_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id           INTEGER NOT NULL REFERENCES mass_plans(id) ON DELETE CASCADE,
    liturgical_block  TEXT NOT NULL CHECK (liturgical_block IN ('introductory', 'word', 'eucharist', 'concluding')),
    source_module     TEXT NOT NULL CHECK (source_module IN ('lyrics', 'lectionary', 'announcements', 'media', 'mass_order', 'bible')),
    source_id         TEXT NOT NULL,
    label             TEXT NOT NULL,
    display_order     INTEGER NOT NULL
  );
  INSERT INTO mass_plan_items_new (id, plan_id, liturgical_block, source_module, source_id, label, display_order)
    SELECT id, plan_id, liturgical_block, source_module, source_id, label, display_order FROM mass_plan_items;
  DROP TABLE mass_plan_items;
  ALTER TABLE mass_plan_items_new RENAME TO mass_plan_items;
  CREATE INDEX idx_mass_plan_items_order ON mass_plan_items (plan_id, liturgical_block, display_order);
  `,
];

/**
 * Adds the operator-only 'custom' note items (presider notes, prompts, reminders). Their text is the
 * source id, so the limit is longer than the other modules' ids. Copies the table like PLAN_BIBLE_MIGRATIONS.
 */
export const PLAN_CUSTOM_MIGRATIONS = [
  `
  CREATE TABLE mass_plan_items_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id           INTEGER NOT NULL REFERENCES mass_plans(id) ON DELETE CASCADE,
    liturgical_block  TEXT NOT NULL CHECK (liturgical_block IN ('introductory', 'word', 'eucharist', 'concluding')),
    source_module     TEXT NOT NULL CHECK (source_module IN ('lyrics', 'lectionary', 'announcements', 'media', 'mass_order', 'bible', 'custom')),
    source_id         TEXT NOT NULL,
    label             TEXT NOT NULL,
    display_order     INTEGER NOT NULL
  );
  INSERT INTO mass_plan_items_new (id, plan_id, liturgical_block, source_module, source_id, label, display_order)
    SELECT id, plan_id, liturgical_block, source_module, source_id, label, display_order FROM mass_plan_items;
  DROP TABLE mass_plan_items;
  ALTER TABLE mass_plan_items_new RENAME TO mass_plan_items;
  CREATE INDEX idx_mass_plan_items_order ON mass_plan_items (plan_id, liturgical_block, display_order);
  `,
];

/**
 * Rebuilds mass_plan_items so it also accepts 'notes': prayers pushed from the Notes & Prayers module.
 * The table is copied, as in the earlier rebuilds, so existing rows keep their ids and order.
 */
export const PLAN_NOTES_MIGRATIONS = [
  `
  CREATE TABLE mass_plan_items_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id           INTEGER NOT NULL REFERENCES mass_plans(id) ON DELETE CASCADE,
    liturgical_block  TEXT NOT NULL CHECK (liturgical_block IN ('introductory', 'word', 'eucharist', 'concluding')),
    source_module     TEXT NOT NULL CHECK (source_module IN ('lyrics', 'lectionary', 'announcements', 'media', 'mass_order', 'bible', 'custom', 'notes')),
    source_id         TEXT NOT NULL,
    label             TEXT NOT NULL,
    display_order     INTEGER NOT NULL
  );
  INSERT INTO mass_plan_items_new (id, plan_id, liturgical_block, source_module, source_id, label, display_order)
    SELECT id, plan_id, liturgical_block, source_module, source_id, label, display_order FROM mass_plan_items;
  DROP TABLE mass_plan_items;
  ALTER TABLE mass_plan_items_new RENAME TO mass_plan_items;
  CREATE INDEX idx_mass_plan_items_order ON mass_plan_items (plan_id, liturgical_block, display_order);
  `,
];

/**
 * Adds the fifth block, the Communion Rite (IV), between the Eucharist and the Concluding Rites. The table is copied as in
 * the earlier rebuilds, so existing rows keep their ids and order, and old plans keep their blocks.
 */
export const PLAN_COMMUNION_MIGRATIONS = [
  `
  CREATE TABLE mass_plan_items_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id           INTEGER NOT NULL REFERENCES mass_plans(id) ON DELETE CASCADE,
    liturgical_block  TEXT NOT NULL CHECK (liturgical_block IN ('introductory', 'word', 'eucharist', 'communion', 'concluding')),
    source_module     TEXT NOT NULL CHECK (source_module IN ('lyrics', 'lectionary', 'announcements', 'media', 'mass_order', 'bible', 'custom', 'notes')),
    source_id         TEXT NOT NULL,
    label             TEXT NOT NULL,
    display_order     INTEGER NOT NULL
  );
  INSERT INTO mass_plan_items_new (id, plan_id, liturgical_block, source_module, source_id, label, display_order)
    SELECT id, plan_id, liturgical_block, source_module, source_id, label, display_order FROM mass_plan_items;
  DROP TABLE mass_plan_items;
  ALTER TABLE mass_plan_items_new RENAME TO mass_plan_items;
  CREATE INDEX idx_mass_plan_items_order ON mass_plan_items (plan_id, liturgical_block, display_order);
  `,
];

/**
 * The Holy Mass order of slots (see shared/mass-slots.js). An item names the slot it fills in `slot`, or has none (an additional item, or an
 * item from before slots). Templates are plans the operator saved to load into another: a name and the items, as JSON. Appended to the end of
 * the migration list only.
 */
export const MASS_SLOT_MIGRATIONS = [
  `ALTER TABLE mass_plan_items ADD COLUMN slot TEXT;`,
  `
  CREATE TABLE mass_plan_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    items       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

/** The language each plan is celebrated in: EN, TL or CEB (see shared/mass-language.js). Plans made before it are English. */
export const PLAN_LANGUAGE_MIGRATIONS = [`ALTER TABLE mass_plans ADD COLUMN language TEXT NOT NULL DEFAULT 'EN';`];

/**
 * Whether a plan's slides show their slot title banner: 1 shows it, 0 hides it, NULL follows the projector setting (showSlotTitle).
 * Read and written by its own statements, prepared when first used, so a database built without this column still opens every other query.
 */
export const PLAN_SLOT_TITLE_MIGRATIONS = [`ALTER TABLE mass_plans ADD COLUMN show_slot_title INTEGER;`];

/**
 * Each Holy Mass plan's schedule: the time the operator typed ("6:00 AM") and its language ('English', 'Cebuano', 'Tagalog' or the
 * operator's own), so several Holy Masses can be planned on one day (see shared/mass-schedule.js). There is no unique key on the date. Plans
 * made before this have both blank and open as they always did. A database built without these columns still lists and opens plans: the
 * service checks for them (see hasScheduleColumns).
 */
export const MASS_SCHEDULE_MIGRATIONS = [
  `ALTER TABLE mass_plans ADD COLUMN mass_time TEXT DEFAULT '';`,
  `ALTER TABLE mass_plans ADD COLUMN mass_language TEXT DEFAULT '';`,
];

const MAX_TEMPLATE_NAME = 80;
const MAX_TEMPLATES = 100;

/** Plan data access. Pure: takes a database handle. */
export function createMassPlanService(db) {
  // Whether this database has the schedule columns (MASS_SCHEDULE_MIGRATIONS). A test database built from part of the migration list may not.
  const hasScheduleColumns = db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('mass_plans') WHERE name IN ('mass_time', 'mass_language')").get().n === 2;
  const SCHEDULE = hasScheduleColumns ? "COALESCE(p.mass_time, '') AS massTime, COALESCE(p.mass_language, '') AS massLanguage" : "'' AS massTime, '' AS massLanguage";
  const q = {
    // Each plan with how many items it holds and the slots they fill, so the planner's calendar can mark a day ready or draft without
    // reading every plan.
    plans: db.prepare(`
      SELECT p.id, p.name, p.liturgical_date AS liturgicalDate, p.language, p.created_at AS createdAt, ${SCHEDULE},
        (SELECT COUNT(*) FROM mass_plan_items i WHERE i.plan_id = p.id) AS itemCount,
        (SELECT GROUP_CONCAT(i.slot) FROM mass_plan_items i WHERE i.plan_id = p.id AND i.slot IS NOT NULL) AS slotList
      FROM mass_plans p ORDER BY p.liturgical_date DESC, p.id DESC`),
    plan: db.prepare(`SELECT p.id, p.name, p.liturgical_date AS liturgicalDate, p.language, ${SCHEDULE} FROM mass_plans p WHERE p.id = ?`),
    insertPlan: db.prepare('INSERT INTO mass_plans (name, liturgical_date, language) VALUES (?, ?, ?)'),
    sameDay: db.prepare(`SELECT p.id, p.name, p.liturgical_date AS liturgicalDate, ${SCHEDULE} FROM mass_plans p WHERE p.liturgical_date = ?`),
    ...(hasScheduleColumns ? { setSchedule: db.prepare('UPDATE mass_plans SET mass_time = ?, mass_language = ? WHERE id = ?') } : {}),
    setLanguage: db.prepare('UPDATE mass_plans SET language = ? WHERE id = ?'),
    deletePlan: db.prepare('DELETE FROM mass_plans WHERE id = ?'),
    planUuid: db.prepare('SELECT uuid FROM mass_plans WHERE id = ?'),
    items: db.prepare(`
      SELECT liturgical_block AS block, source_module AS module, source_id AS sourceId, label, slot
      FROM mass_plan_items WHERE plan_id = ?
      ORDER BY CASE liturgical_block
        WHEN 'introductory' THEN 0 WHEN 'word' THEN 1 WHEN 'eucharist' THEN 2 WHEN 'communion' THEN 3 ELSE 4 END,
        display_order`),
    clearItems: db.prepare('DELETE FROM mass_plan_items WHERE plan_id = ?'),
    insertItem: db.prepare(
      'INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order, slot) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    templates: db.prepare('SELECT id, name, items FROM mass_plan_templates ORDER BY name COLLATE NOCASE'),
    template: db.prepare('SELECT id, name, items FROM mass_plan_templates WHERE id = ?'),
    templateByName: db.prepare('SELECT id FROM mass_plan_templates WHERE name = ? COLLATE NOCASE'),
    templateCount: db.prepare('SELECT COUNT(*) AS n FROM mass_plan_templates'),
    insertTemplate: db.prepare('INSERT INTO mass_plan_templates (name, items) VALUES (?, ?)'),
    deleteTemplate: db.prepare('DELETE FROM mass_plan_templates WHERE id = ?'),
    // A live hymn is in the library. A deleted one is kept for undo, and the plan shows it as deleted rather than as present.
    liveHymn: db.prepare('SELECT 1 FROM hymns WHERE id = ? AND deleted_at IS NULL'),
    deletedHymn: db.prepare('SELECT 1 FROM hymns WHERE id = ? AND deleted_at IS NOT NULL'),
    slide: db.prepare('SELECT 1 FROM announcement_slides WHERE id = ?'),
    note: db.prepare('SELECT display FROM notes WHERE id = ?'),
    media: db.prepare('SELECT 1 FROM media_assets WHERE id = ?'),
    reading: db.prepare("SELECT 1 FROM lectionary_readings WHERE liturgical_date = ? AND reading_type = ? AND raw_text <> ''"),
    verse: db.prepare(`
      SELECT 1 FROM bible_verses v
      JOIN bible_books b ON b.translation_id = v.translation_id AND b.book_number = v.book_number
      WHERE v.translation_id = ? AND b.name = ? AND v.chapter = ? AND v.verse BETWEEN ? AND ?
      LIMIT 1`),
  };

  /**
   * A schedule from the planner, tidied, and checked against the day's other Holy Masses: a second plan at the same time on the same day
   * ("6:00 AM" and "06:00" are the same time), whatever its language, is refused, so two lineups are never confused on air. The planner
   * checks first and offers Open Existing (findTimeConflict in shared/mass-schedule.js); this is the last word. Blank times never clash.
   */
  const checkedSchedule = (date, input, exceptId = null) => {
    const schedule = { massTime: normalizeMassTime(input?.massTime), massLanguage: normalizeMassLanguage(input?.massLanguage) };
    const clash = findTimeConflict(q.sameDay.all(date), { date, massTime: schedule.massTime }, exceptId);
    if (clash) throw new Error(`${timeConflictText(clash)} Open the existing one, or pick another time.`);
    return schedule;
  };

  const requirePlan = (id) => {
    const plan = q.plan.get(id);
    if (!plan) throw new Error('That plan no longer exists.');
    return plan;
  };

  // The slot-title statements, prepared on first use (see PLAN_SLOT_TITLE_MIGRATIONS).
  let slotTitleQ = null;
  const slotTitleStatements = () =>
    (slotTitleQ ??= {
      get: db.prepare('SELECT show_slot_title AS v FROM mass_plans WHERE id = ?'),
      set: db.prepare('UPDATE mass_plans SET show_slot_title = ? WHERE id = ?'),
    });

  /** Whether a plan item's source still exists. Mass Order parts are built in, so they always do. */
  const sourceExists = (module, sourceId) => {
    if (module === 'lyrics') return Boolean(q.liveHymn.get(Number(sourceId)));
    if (module === 'announcements') {
      const source = announcementSource(sourceId);
      return Boolean(source && q.slide.get(source.slideId));
    }
    if (module === 'media') return Boolean(q.media.get(Number(sourceId)));
    if (module === 'lectionary') {
      const [date, readingType] = String(sourceId).split('|');
      return Boolean(q.reading.get(date, readingType));
    }
    if (module === 'custom') return true;
    // An operator-only note may sit in a plan as a private cue: Go Live shows it to the operator, and the projector never shows it
    // (src/notes/present.ts stages and takes only `full` and `lower` notes).
    if (module === 'notes') {
      const source = noteSource(sourceId);
      return Boolean(source && q.note.get(source.id));
    }
    if (module === 'bible') {
      const ref = parseSourceId(sourceId);
      return Boolean(ref && q.verse.get(ref.translationId, ref.bookName, ref.chapter, ref.from, ref.to));
    }
    return true;
  };

  /** Refuses an item whose source has been deleted, so plans never point at nothing. */
  const requireSource = (module, sourceId) => {
    if (!sourceExists(module, sourceId)) {
      throw new Error('One of the items in this plan no longer exists. Remove it and try again.');
    }
  };

  /**
   * The items as rows, checked: a known block and source kind, a source id of a usable length, a label, and a slot that is one of the 17 (or
   * none). A slot holds one item. `sources` is false for a template, which may name a song that is deleted later; a plan refuses a missing one.
   */
  // `kept` names the plan's saved items (module|sourceId). One whose source was deleted after it was added stays, shown as missing, so a later
  // save (an on-air edit, a reorder) never fails over a row the operator did not touch. A newly added item must still exist.
  const checkedItems = (list, { sources, kept = null }) => {
    if (list.length > MAX_ITEMS) throw new Error(`A plan can hold at most ${MAX_ITEMS} items.`);
    const counts = Object.fromEntries(PLAN_BLOCKS.map((b) => [b, 0]));
    const slots = new Set();
    return list.map((item) => {
      if (!PLAN_BLOCKS.includes(item.block)) throw new Error('Unknown liturgical block.');
      if (!PLAN_MODULES.includes(item.module)) throw new Error('Unknown item source.');
      const sourceId = String(item.sourceId ?? '').trim();
      const maxLength = item.module === 'custom' ? MAX_CUSTOM : 120;
      if (!sourceId || sourceId.length > maxLength) throw new Error('Item is missing its source.');
      if (item.module === 'mass_order' && !MASS_PART.test(sourceId)) throw new Error('Unknown Holy Mass part.');
      if (item.module === 'lectionary' && sourceId.split('|')[1] === GOSPEL_ACCLAMATION) {
        throw new Error('The Gospel Acclamation is for Praise & Worship. It cannot be added to a Holy Mass plan.');
      }
      if (sources && !kept?.has(`${item.module}|${sourceId}`)) requireSource(item.module, sourceId);
      const slot = item.slot == null || item.slot === '' ? null : String(item.slot);
      if (slot !== null) {
        if (!isSlotId(slot)) throw new Error('Unknown Holy Mass slot.');
        if (slots.has(slot)) throw new Error('Two items are in the same Holy Mass slot.');
        slots.add(slot);
      }
      const label = String(item.label ?? '').trim().slice(0, MAX_LABEL) || sourceId;
      counts[item.block] += 1;
      return { block: item.block, module: item.module, sourceId, label, order: counts[item.block], slot };
    });
  };

  return {
    /** Every plan, newest day first, and each day's Holy Masses in the order they are celebrated (shared/mass-schedule.js). */
    listPlans() {
      return sortMassSchedules(q.plans.all().map(({ slotList, ...plan }) => ({ ...plan, filledSlots: slotList ? String(slotList).split(',') : [] })));
    },

    createPlan(input = {}) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > MAX_NAME) throw new Error(`Plan name must be 1 to ${MAX_NAME} characters.`);
      const liturgicalDate = String(input.liturgicalDate ?? '');
      if (!DATE.test(liturgicalDate)) throw new Error('Date must be in the form YYYY-MM-DD.');
      const schedule = hasScheduleColumns ? checkedSchedule(liturgicalDate, input) : { massTime: '', massLanguage: '' };
      // A Tagalog or Cebuano Holy Mass drafts its texts in that language unless the planner asked for another.
      const language = input.language != null ? massLanguageOf(input.language) : (planLanguageForSchedule(schedule.massLanguage) ?? DEFAULT_MASS_LANGUAGE);
      const id = db.transaction(() => {
        const made = Number(q.insertPlan.run(name, liturgicalDate, language).lastInsertRowid);
        if (hasScheduleColumns) q.setSchedule.run(schedule.massTime, schedule.massLanguage, made);
        return made;
      })();
      return { id, name, liturgicalDate, language, ...schedule };
    },

    /** Sets a plan's time and language. Its items and its plan language (the texts) are not changed here. */
    setSchedule(id, input = {}) {
      const plan = requirePlan(id);
      if (!hasScheduleColumns) throw new Error('This database cannot keep Holy Mass times yet. Restart the app to update it.');
      const schedule = checkedSchedule(plan.liturgicalDate, input, id);
      q.setSchedule.run(schedule.massTime, schedule.massLanguage, id);
      return schedule;
    },

    /** Sets the language a plan is celebrated in. Its items are not changed here: the planner re-drafts and relabels them. */
    setLanguage(id, language) {
      requirePlan(id);
      if (!isMassLanguage(language)) throw new Error('The Holy Mass language must be EN, TL or CEB.');
      q.setLanguage.run(language, id);
      return language;
    },

    /** The plan's own slot-title choice: true, false, or null to follow the projector setting. */
    getSlotTitle(id) {
      requirePlan(id);
      const statements = slotTitleStatements();
      const v = statements.get.get(id)?.v;
      return v == null ? null : v === 1;
    },

    /** Sets the plan's slot-title choice: true shows the banner, false hides it, null follows the projector setting. */
    setSlotTitle(id, show) {
      requirePlan(id);
      if (show !== null && typeof show !== 'boolean') throw new Error('Show slot title must be on, off, or follow the setting.');
      const statements = slotTitleStatements();
      statements.set.run(show === null ? null : show ? 1 : 0, id);
      return show;
    },

    /**
     * Copies a plan: its items, language, slot-title choice and Plan Appearance, on the same day, named "<name> (Copy)". The copy keeps the
     * Holy Mass language but not the time, since two Holy Masses on one day may not share a time (see checkedSchedule); the operator sets it.
     * Resolves to the copy as createPlan does.
     */
    duplicatePlan(id) {
      const plan = requirePlan(id);
      const name = copyName(plan.name, MAX_NAME);
      const schedule = { massTime: '', massLanguage: plan.massLanguage ?? '' };
      const copied = (table, keyColumn) =>
        db.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name NOT IN ('id', '${keyColumn}', 'uuid', 'updated_at')`).all().map((c) => c.name);
      const planColumns = new Set(copied('mass_plans', 'id'));
      const itemColumns = copied('mass_plan_items', 'plan_id');
      const made = db.transaction(() => {
        const newId = Number(q.insertPlan.run(name, plan.liturgicalDate, plan.language).lastInsertRowid);
        if (hasScheduleColumns) q.setSchedule.run(schedule.massTime, schedule.massLanguage, newId);
        // The plan's own choices, where this database keeps them.
        for (const column of ['show_slot_title', 'appearance_json']) {
          if (planColumns.has(column)) db.prepare(`UPDATE mass_plans SET ${column} = (SELECT ${column} FROM mass_plans WHERE id = ?) WHERE id = ?`).run(id, newId);
        }
        const cols = itemColumns.join(', ');
        db.prepare(`INSERT INTO mass_plan_items (plan_id, ${cols}) SELECT ?, ${cols} FROM mass_plan_items WHERE plan_id = ? ORDER BY id`).run(newId, id);
        return newId;
      })();
      return { id: made, name, liturgicalDate: plan.liturgicalDate, language: plan.language, ...schedule };
    },

    deletePlan(id) {
      // The tombstone and the delete happen together, so a deleted plan is never pulled back on the next sync.
      return db.transaction(() => {
        const row = q.planUuid.get(id);
        if (row) recordTombstone(db, { uuid: row.uuid, kind: 'mass' });
        return q.deletePlan.run(id).changes > 0;
      })();
    },

    /**
     * Items carry `stale: true` when their source is gone. A hymn that was deleted but can still be undone is `deleted: true`, and is
     * stale too while it is deleted, so the planner shows it as "deleted (undo available)" and does not drop it.
     */
    getPlan(id) {
      const plan = requirePlan(id);
      const items = q.items.all(id).map((item) => {
        const deleted = item.module === 'lyrics' && Boolean(q.deletedHymn.get(Number(item.sourceId)));
        return { ...item, deleted, stale: !sourceExists(item.module, item.sourceId) };
      });
      return { ...plan, items };
    },

    /** Replaces the plan's items. Each block's order is the order of the items sent for it. */
    savePlan(id, items) {
      requirePlan(id);
      const kept = new Set(q.items.all(id).map((r) => `${r.module}|${r.sourceId}`));
      const rows = checkedItems(Array.isArray(items) ? items : [], { sources: true, kept });

      db.transaction(() => {
        q.clearItems.run(id);
        for (const r of rows) q.insertItem.run(id, r.block, r.module, r.sourceId, r.label, r.order, r.slot);
      })();
      return rows.length;
    },

    /** The saved templates, by name, with how many items each has. */
    listTemplates() {
      return q.templates.all().map((t) => ({ id: t.id, name: t.name, count: JSON.parse(t.items).length }));
    },

    /**
     * One template's items, ready to load into a plan. An item whose source was deleted since the template was saved is marked `stale`, so the
     * planner can leave it out instead of the whole load being refused.
     */
    getTemplate(id) {
      const row = q.template.get(id);
      if (!row) throw new Error('That template no longer exists.');
      const items = JSON.parse(row.items).map((item) => ({ ...item, stale: !sourceExists(item.module, item.sourceId) }));
      return { id: row.id, name: row.name, items };
    },

    /** Saves the given items as a template. A name already used (letter case aside) is refused, so one template never hides another. */
    saveTemplate(input = {}) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > MAX_TEMPLATE_NAME) throw new Error(`A template name must be 1 to ${MAX_TEMPLATE_NAME} characters.`);
      if (q.templateByName.get(name)) throw new Error(`A template named "${name}" already exists.`);
      if (q.templateCount.get().n >= MAX_TEMPLATES) throw new Error(`There can be at most ${MAX_TEMPLATES} templates.`);
      const rows = checkedItems(Array.isArray(input.items) ? input.items : [], { sources: false });
      if (rows.length === 0) throw new Error('A template needs at least one item.');
      const stored = rows.map(({ block, module, sourceId, label, slot }) => ({ block, module, sourceId, label, slot }));
      const { lastInsertRowid } = q.insertTemplate.run(name, JSON.stringify(stored));
      return { id: Number(lastInsertRowid), name, count: stored.length };
    },

    deleteTemplate(id) {
      return q.deleteTemplate.run(id).changes > 0;
    },
  };
}

/** Registers the `plans:*` IPC channels. Called once from the main process. */
export function setupMassPlans(db) {
  const service = createMassPlanService(db);
  const handle = (channel, fn) => ipcMain.handle(`plans:${channel}`, (_event, ...args) => fn(...args));

  handle('list', () => service.listPlans());
  handle('create', (input) => service.createPlan(input));
  handle('delete', (id) => service.deletePlan(Number(id)));
  handle('duplicate', (id) => service.duplicatePlan(Number(id)));
  handle('get', (id) => service.getPlan(Number(id)));
  handle('save', (id, items) => service.savePlan(Number(id), items));
  handle('setLanguage', (id, language) => service.setLanguage(Number(id), language));
  handle('setSchedule', (id, schedule) => service.setSchedule(Number(id), schedule));
  handle('slotTitle', (id) => service.getSlotTitle(Number(id)));
  handle('setSlotTitle', (id, show) => service.setSlotTitle(Number(id), show));
  handle('listTemplates', () => service.listTemplates());
  handle('getTemplate', (id) => service.getTemplate(Number(id)));
  handle('saveTemplate', (input) => service.saveTemplate(input));
  handle('deleteTemplate', (id) => service.deleteTemplate(Number(id)));
  return service;
}
