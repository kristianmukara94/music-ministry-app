// Plan Appearance storage: each plan's own default look for its slides (shared/plan-appearance.js), kept as JSON on the plan's row:
// `mass_plans.appearance_json` for a Holy Mass plan and `pw_sessions.appearance_json` for a Praise & Worship plan. NULL is Use Global Default.
//
// It is the laptop's own: Cloud Sync never sends or overwrites it (the sync payloads name their columns, and this is not one of them), so a
// Media Library id that exists only on this laptop never reaches the website. Its statements are prepared on first use and check for the
// column, so a database built from part of the migration list (the tests) still opens every other plan query.

import { ipcMain } from 'electron';
import { parsePlanAppearance, serializePlanAppearance } from '../shared/plan-appearance.js';

/**
 * One nullable column per plan table. A new column on an existing row reads NULL, the default look, so every plan made before keeps the
 * Global Appearance. Appended to the end of ALL_MIGRATIONS (electron/announcements.js), which runs each entry once (user_version).
 */
export const PLAN_APPEARANCE_MIGRATIONS = [
  `ALTER TABLE mass_plans ADD COLUMN appearance_json TEXT;`,
  `ALTER TABLE pw_sessions ADD COLUMN appearance_json TEXT;`,
];

const TABLES = { mass: 'mass_plans', pw: 'pw_sessions' };

/** The name of a duplicated plan: "<name> (Copy)", shortened so it stays within `max` characters. Used by both plan kinds. */
export function copyName(name, max) {
  const suffix = ' (Copy)';
  return `${String(name).trim().slice(0, max - suffix.length).trimEnd()}${suffix}`;
}

/** Whether `table` has the appearance column. */
export function hasAppearanceColumn(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = 'appearance_json'`).get().n === 1;
}

/** The table for a plan kind, or an error the Planner can show. */
function tableOf(kind) {
  const table = TABLES[kind];
  if (!table) throw new Error('A plan is a Holy Mass plan or a Praise & Worship plan.');
  return table;
}

/** Plan Appearance data access. Pure: takes a database handle. */
export function createPlanAppearanceService(db) {
  const statements = new Map();
  const q = (kind) => {
    let s = statements.get(kind);
    if (!s) {
      const table = tableOf(kind);
      if (!hasAppearanceColumn(db, table)) throw new Error('This database has no plan appearance yet. Restart the app to update it.');
      s = {
        exists: db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`),
        get: db.prepare(`SELECT appearance_json AS json FROM ${table} WHERE id = ?`),
        set: db.prepare(`UPDATE ${table} SET appearance_json = ? WHERE id = ?`),
      };
      statements.set(kind, s);
    }
    return s;
  };
  const requirePlan = (kind, id) => {
    if (!q(kind).exists.get(id)) throw new Error('That plan no longer exists.');
  };

  return {
    /** The plan's appearance, sanitized. A plan with none saved reads as the default (Use Global Default). */
    get(kind, id) {
      requirePlan(kind, id);
      return parsePlanAppearance(q(kind).get.get(id)?.json ?? null);
    },

    /** Saves the plan's appearance and returns it as kept. The default is stored as NULL. */
    set(kind, id, appearance) {
      requirePlan(kind, id);
      const json = serializePlanAppearance(appearance);
      q(kind).set.run(json, id);
      return parsePlanAppearance(json);
    },

    /** Copies one plan's appearance onto another of the same kind (a duplicated plan). */
    copy(kind, fromId, toId) {
      const json = q(kind).get.get(fromId)?.json ?? null;
      q(kind).set.run(json, toId);
    },
  };
}

/** Registers the `planAppearance:*` IPC channels. Called once from the main process. */
export function setupPlanAppearance(db) {
  const service = createPlanAppearanceService(db);
  ipcMain.handle('planAppearance:get', (_event, kind, id) => service.get(kind, Number(id)));
  ipcMain.handle('planAppearance:set', (_event, kind, id, appearance) => service.set(kind, Number(id), appearance));
  return service;
}
