// Annual Planner Cleanup, main-process side: deletes the Holy Mass plans and Praise & Worship sessions a year (or chosen months of it) holds,
// in one transaction, and can write them to a .apccmma backup first. The matching rules are shared/planner-cleanup.js, the same ones the
// Planner's modal previews with, so what it showed is what is deleted. A plan loaded on air in Go Live is never deleted: it is skipped and
// reported, so the projection is never cut from under the operator.
import fs from 'node:fs';
import os from 'node:os';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { cleanupMonths, cleanupPlanType, matchCleanup } from '../shared/planner-cleanup.js';
import { recordTombstone } from './plan-sync-schema.js';
import { collectLibrary, defaultExportName, encodeTransfer, TRANSFER_EXTENSION } from './transfer.js';

const ids = (value) => new Set((Array.isArray(value) ? value : []).map(Number).filter(Number.isInteger));

/** Checks a request from the Planner. Throws a message the operator can read when the year is not one. */
export function checkCleanupRequest(input) {
  const year = Number(input?.year);
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('Choose a year to clean up.');
  return {
    year,
    months: cleanupMonths(input?.months),
    planType: cleanupPlanType(input?.planType),
    deleteFromCloud: input?.deleteFromCloud === true,
    // Plans loaded on air (Go Live) in the renderer, which the main process cannot see. They are never deleted.
    protectedMass: ids(input?.protectedMassIds),
    protectedPw: ids(input?.protectedPwIds),
  };
}

export function createPlannerCleanupService(db) {
  const readMass = () => db.prepare('SELECT id, uuid, name, liturgical_date AS liturgicalDate FROM mass_plans').all();
  const readPw = () => db.prepare('SELECT id, uuid, name, liturgical_date AS liturgicalDate FROM pw_sessions').all();

  /** The plans the request matches, split into those that go and those held back because they are on air. */
  function resolve(request) {
    const matched = matchCleanup({ mass: readMass(), pw: readPw() }, request);
    const held = (kind, plans, protectedIds) =>
      plans.filter((p) => protectedIds.has(p.id)).map((p) => ({ kind, id: p.id, name: p.name, liturgicalDate: p.liturgicalDate }));
    return {
      mass: matched.mass.filter((p) => !request.protectedMass.has(p.id)),
      pw: matched.pw.filter((p) => !request.protectedPw.has(p.id)),
      skipped: [...held('mass', matched.mass, request.protectedMass), ...held('pw', matched.pw, request.protectedPw)],
    };
  }

  return {
    resolve,

    /** Deletes the matching plans and their slots / segments in one transaction: all of them or, on a failure, none. */
    bulkDelete(input) {
      const request = checkCleanupRequest(input);
      const found = resolve(request);
      db.transaction(() => {
        for (const plan of found.mass) {
          // The tombstone stops the plan coming back at the next sync, and tells the website to delete it. Without it the delete is local only.
          if (request.deleteFromCloud) recordTombstone(db, { uuid: plan.uuid, kind: 'mass' });
          db.prepare('DELETE FROM mass_plans WHERE id = ?').run(plan.id);
        }
        for (const plan of found.pw) {
          if (request.deleteFromCloud) recordTombstone(db, { uuid: plan.uuid, kind: 'praise' });
          db.prepare('DELETE FROM pw_sessions WHERE id = ?').run(plan.id);
        }
      })();
      return {
        year: request.year,
        months: request.months,
        deletedMass: found.mass.length,
        deletedPw: found.pw.length,
        deleted: found.mass.length + found.pw.length,
        skipped: found.skipped,
        deletedFromCloud: request.deleteFromCloud,
        massIds: found.mass.map((p) => p.id),
        pwIds: found.pw.map((p) => p.id),
      };
    },

    /** The library file text holding exactly the plans the request matches (on-air ones included: it is a backup). Null when none match. */
    backupText(input) {
      const request = checkCleanupRequest({ ...input, protectedMassIds: [], protectedPwIds: [] });
      const found = resolve(request);
      if (found.mass.length + found.pw.length === 0) return null;
      const data = collectLibrary(
        db,
        { plans: found.mass.length > 0, praiseWorship: found.pw.length > 0, setlists: false, songs: false, lyrics: false, massOrder: false },
        { laptop: os.hostname(), only: { planIds: found.mass.map((p) => p.id), sessionIds: found.pw.map((p) => p.id) } },
      );
      return { text: encodeTransfer(data), counts: data.counts };
    },
  };
}

/** Registers `plannerCleanup:*`. `afterDelete(result)` runs once a cleanup has deleted plans (the sync uses it to send the cloud deletions now). */
export function setupPlannerCleanup(db, { afterDelete } = {}) {
  const service = createPlannerCleanupService(db);
  ipcMain.handle('plannerCleanup:delete', (_event, input) => {
    const result = service.bulkDelete(input);
    if (result.deleted > 0) {
      try {
        afterDelete?.(result);
      } catch (err) {
        console.error('Planner cleanup follow-up failed:', err);
      }
    }
    return result;
  });
  ipcMain.handle('plannerCleanup:exportBackup', async (event, input) => {
    const backup = service.backupText(input);
    if (!backup) return null;
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Export a backup of the plans to delete',
      defaultPath: defaultExportName(),
      filters: [{ name: 'APCCMMA library', extensions: [TRANSFER_EXTENSION.slice(1)] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, backup.text, 'utf8');
    return { path: picked.filePath, counts: backup.counts };
  });
  return service;
}
