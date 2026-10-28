// A start-up check on the open database: how many songs, plans and sessions it holds. A table a backup does not have is reported as
// missing, not as zero, so an old backup shows what it lacks. Only fixed table names are read, never user input.

const COUNTED = { hymns: 'hymns', massPlans: 'mass_plans', massPlanItems: 'mass_plan_items', pwSessions: 'pw_sessions' };

/** Row counts for the tables the lineup and the songs live in. `db` is an open better-sqlite3 handle. */
export function databaseCounts(db) {
  const counts = {};
  for (const [label, table] of Object.entries(COUNTED)) {
    try {
      counts[label] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch {
      counts[label] = 'missing';
    }
  }
  return counts;
}
