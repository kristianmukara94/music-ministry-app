import { ipcMain } from 'electron';
import { parseSourceId } from '../shared/bible-ref.js';
import { GOSPEL_ACCLAMATION } from './lectionary.js';
import { recordTombstone } from './plan-sync-schema.js';

export const PLAN_BLOCKS = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];
export const PLAN_MODULES = ['lyrics', 'lectionary', 'announcements', 'media', 'mass_order', 'bible', 'custom', 'notes'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 120;
const MAX_LABEL = 200;
const MAX_CUSTOM = 300;
const MAX_ITEMS = 300;
const MASS_PART = /^[a-z][a-z-]*$/;

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

/** Plan data access. Pure: takes a database handle. */
export function createMassPlanService(db) {
  const q = {
    plans: db.prepare(`
      SELECT id, name, liturgical_date AS liturgicalDate, created_at AS createdAt
      FROM mass_plans ORDER BY liturgical_date DESC, id DESC`),
    plan: db.prepare('SELECT id, name, liturgical_date AS liturgicalDate FROM mass_plans WHERE id = ?'),
    insertPlan: db.prepare('INSERT INTO mass_plans (name, liturgical_date) VALUES (?, ?)'),
    deletePlan: db.prepare('DELETE FROM mass_plans WHERE id = ?'),
    planUuid: db.prepare('SELECT uuid FROM mass_plans WHERE id = ?'),
    items: db.prepare(`
      SELECT liturgical_block AS block, source_module AS module, source_id AS sourceId, label
      FROM mass_plan_items WHERE plan_id = ?
      ORDER BY CASE liturgical_block
        WHEN 'introductory' THEN 0 WHEN 'word' THEN 1 WHEN 'eucharist' THEN 2 WHEN 'communion' THEN 3 ELSE 4 END,
        display_order`),
    clearItems: db.prepare('DELETE FROM mass_plan_items WHERE plan_id = ?'),
    insertItem: db.prepare(
      'INSERT INTO mass_plan_items (plan_id, liturgical_block, source_module, source_id, label, display_order) VALUES (?, ?, ?, ?, ?, ?)',
    ),
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

  const requirePlan = (id) => {
    const plan = q.plan.get(id);
    if (!plan) throw new Error('That plan no longer exists.');
    return plan;
  };

  /** Whether a plan item's source still exists. Mass Order parts are built in, so they always do. */
  const sourceExists = (module, sourceId) => {
    if (module === 'lyrics') return Boolean(q.liveHymn.get(Number(sourceId)));
    if (module === 'announcements') return Boolean(q.slide.get(Number(sourceId)));
    if (module === 'media') return Boolean(q.media.get(Number(sourceId)));
    if (module === 'lectionary') {
      const [date, readingType] = String(sourceId).split('|');
      return Boolean(q.reading.get(date, readingType));
    }
    if (module === 'custom') return true;
    // Operator-only notes are private, so they are never valid queue sources.
    if (module === 'notes') {
      const row = q.note.get(Number(sourceId));
      return Boolean(row) && row.display !== 'operator';
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

  return {
    listPlans() {
      return q.plans.all();
    },

    createPlan(input = {}) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > MAX_NAME) throw new Error(`Plan name must be 1 to ${MAX_NAME} characters.`);
      const liturgicalDate = String(input.liturgicalDate ?? '');
      if (!DATE.test(liturgicalDate)) throw new Error('Date must be in the form YYYY-MM-DD.');
      const { lastInsertRowid } = q.insertPlan.run(name, liturgicalDate);
      return { id: Number(lastInsertRowid), name, liturgicalDate };
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
      const list = Array.isArray(items) ? items : [];
      if (list.length > MAX_ITEMS) throw new Error(`A plan can hold at most ${MAX_ITEMS} items.`);

      const counts = Object.fromEntries(PLAN_BLOCKS.map((b) => [b, 0]));
      const rows = list.map((item) => {
        if (!PLAN_BLOCKS.includes(item.block)) throw new Error('Unknown liturgical block.');
        if (!PLAN_MODULES.includes(item.module)) throw new Error('Unknown item source.');
        const sourceId = String(item.sourceId ?? '').trim();
        const maxLength = item.module === 'custom' ? MAX_CUSTOM : 120;
        if (!sourceId || sourceId.length > maxLength) throw new Error('Item is missing its source.');
        if (item.module === 'mass_order' && !MASS_PART.test(sourceId)) throw new Error('Unknown Mass part.');
        if (item.module === 'notes' && q.note.get(Number(sourceId))?.display === 'operator') {
          throw new Error('Operator-only notes cannot go to the Service Queue.');
        }
        if (item.module === 'lectionary' && sourceId.split('|')[1] === GOSPEL_ACCLAMATION) {
          throw new Error('The Gospel Acclamation is for Praise & Worship. It cannot be added to a Mass plan.');
        }
        requireSource(item.module, sourceId);
        const label = String(item.label ?? '').trim().slice(0, MAX_LABEL) || sourceId;
        counts[item.block] += 1;
        return { block: item.block, module: item.module, sourceId, label, order: counts[item.block] };
      });

      db.transaction(() => {
        q.clearItems.run(id);
        for (const r of rows) q.insertItem.run(id, r.block, r.module, r.sourceId, r.label, r.order);
      })();
      return rows.length;
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
  handle('get', (id) => service.getPlan(Number(id)));
  handle('save', (id, items) => service.savePlan(Number(id), items));
  return service;
}
