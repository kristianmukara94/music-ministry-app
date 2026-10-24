import fs from 'node:fs';
import path from 'node:path';

// Tiny file in userData. It records which plan is loaded and where the operator was in it.
// The queue itself is rebuilt from the plan in the database, so it never goes stale.
const FILE = 'queue-state.json';
const EMPTY = { active_mass_plan_id: null, current_queue_index: -1 };

export function readQueueState(userData) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(userData, FILE), 'utf8'));
    return {
      active_mass_plan_id: Number.isInteger(data.active_mass_plan_id) ? data.active_mass_plan_id : null,
      current_queue_index: Number.isInteger(data.current_queue_index) ? data.current_queue_index : -1,
    };
  } catch {
    // Missing or unreadable (first run, or a crash mid-write): start with an empty queue.
    return { ...EMPTY };
  }
}

/** Writes via a temp file and a rename, so a crash mid-write cannot leave half a file behind. */
export function writeQueueState(userData, state) {
  const file = path.join(userData, FILE);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
}

/** Plan items to Service Queue entries. Must match the renderer's queueFromPlan ids. */
export function queueFromPlanItems(items) {
  return items.map((it, i) => ({
    id: `${i}:${it.module}:${it.sourceId}`,
    label: it.label,
    block: it.block,
    module: it.module,
    sourceId: it.sourceId,
    stale: Boolean(it.stale),
  }));
}
