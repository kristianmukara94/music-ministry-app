import { ipcMain } from 'electron';

/**
 * A record of every song the operator put on the projector straight from search, without it being in the lineup. Kept for the service
 * history and for reporting song use. New migrations go at the end of ALL_MIGRATIONS only.
 */
export const SPONTANEOUS_LOG_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS spontaneous_logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     song_id TEXT NOT NULL,
     song_title TEXT NOT NULL,
     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
     service_date TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_spontaneous_logs_date ON spontaneous_logs (service_date);`,
];

const MAX_TITLE = 300;

/** The local calendar day, as YYYY-MM-DD: a service on Sunday evening is Sunday's, whatever the time in UTC. */
export function serviceDateOf(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function createSpontaneousLog(db, { now = () => new Date() } = {}) {
  const insert = db.prepare('INSERT INTO spontaneous_logs (song_id, song_title, service_date) VALUES (?, ?, ?)');
  const byDate = db.prepare('SELECT id, song_id AS songId, song_title AS title, timestamp, service_date AS serviceDate FROM spontaneous_logs WHERE service_date = ? ORDER BY id');
  return {
    /** Records one song. Returns the saved row's id. A song id or title that is not usable is refused. */
    log(input) {
      const songId = String(input?.songId ?? '').trim();
      const title = String(input?.title ?? '').trim().slice(0, MAX_TITLE);
      if (!songId || !title) throw new Error('A song id and a title are needed to log a song.');
      return Number(insert.run(songId, title, serviceDateOf(now())).lastInsertRowid);
    },
    /** The songs logged for one service day (YYYY-MM-DD), oldest first. */
    forDate(serviceDate) {
      return byDate.all(String(serviceDate));
    },
  };
}

/** Registers the log's IPC channel. `isProjectorOpen` answers whether the projector window exists. */
export function setupSpontaneousLog(db, { isProjectorOpen }) {
  const service = createSpontaneousLog(db);
  ipcMain.handle('log-spontaneous-song', (_event, input) => service.log(input));
  ipcMain.handle('check-projector-window', () => Boolean(isProjectorOpen()));
  return service;
}
