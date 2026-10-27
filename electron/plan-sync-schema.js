// Plan sync's local tables. A plan already has a stable `uuid` and an `updated_at` (see transfer.js), so the sync uses those rather
// than adding its own. What is added here is the server's version of each plan, the laptop's stamp at its last sync (a plan is
// dirty when the two differ), the pull cursor, and the tombstones that stop a deleted plan coming back.
// Pure of Electron: the tests run this under plain Node.

export const PLAN_SYNC_MIGRATIONS = [
  `
  ALTER TABLE mass_plans ADD COLUMN server_updated_at TEXT;
  ALTER TABLE mass_plans ADD COLUMN synced_updated_at TEXT;
  ALTER TABLE pw_sessions ADD COLUMN server_updated_at TEXT;
  ALTER TABLE pw_sessions ADD COLUMN synced_updated_at TEXT;
  CREATE TABLE sync_state (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  CREATE TABLE sync_tombstones (
    uuid        TEXT PRIMARY KEY,
    plan_kind   TEXT NOT NULL CHECK (plan_kind IN ('mass', 'praise')),
    deleted_at  TEXT NOT NULL
  );
  `,
];

/** Records a deleted plan so the next pull does not bring it back. Called before the row is deleted, while its uuid is known. */
export function recordTombstone(db, { uuid, kind }) {
  if (!uuid) return;
  db.prepare(`INSERT OR REPLACE INTO sync_tombstones (uuid, plan_kind, deleted_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
    .run(uuid, kind);
}
