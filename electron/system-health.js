// System health for the dashboard: the laptop's CPU and memory, the app's own share of them, how the crash-recovery database's last write
// went, and the newest automatic database snapshot. Read on request (the dashboard polls it every few seconds), never pushed.
// The helpers take their inputs as arguments, so the tests can feed them fixed numbers.

/** Idle and total CPU time across every core, from os.cpus(). */
export function cpuTimes(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus ?? []) {
    const t = cpu?.times ?? {};
    idle += t.idle ?? 0;
    total += (t.user ?? 0) + (t.nice ?? 0) + (t.sys ?? 0) + (t.idle ?? 0) + (t.irq ?? 0);
  }
  return { idle, total };
}

/** Busy share of the CPU between two samples, 0–100, rounded. Null when the samples are the same or out of order. */
export function cpuPercent(prev, next) {
  if (!prev || !next) return null;
  const total = next.total - prev.total;
  const idle = next.idle - prev.idle;
  if (!(total > 0) || idle < 0) return null;
  return Math.round(Math.min(100, Math.max(0, (1 - idle / total) * 100)));
}

/**
 * Times the crash-recovery writes. `time(fn)` runs one write and records how long it took, so the dashboard can show the WAL database is
 * keeping up. An error is recorded and thrown on, so the caller's own error handling is unchanged.
 */
export function createWriteMeter(clock = () => performance.now(), wallClock = Date.now) {
  let last = null;
  let writes = 0;
  let error = null;
  return {
    time(fn) {
      const start = clock();
      try {
        const result = fn();
        last = { ms: clock() - start, at: wallClock() };
        writes += 1;
        error = null;
        return result;
      } catch (err) {
        error = { message: err?.message ?? String(err), at: wallClock() };
        throw err;
      }
    },
    status() {
      return {
        lastWriteMs: last ? Math.round(last.ms * 100) / 100 : null,
        lastWriteAt: last?.at ?? null,
        writes,
        error: error?.message ?? null,
      };
    },
  };
}

/** The newest snapshot from listBackups() (newest first), as `{ name, at, preMigration }`, or null when there is none. */
export function latestBackup(list) {
  const newest = Array.isArray(list) ? list[0] : null;
  return newest ? { name: newest.name, at: Math.round(newest.mtimeMs), preMigration: Boolean(newest.preMigration) } : null;
}

/** The app's CPU share and memory, summed over its processes, from app.getAppMetrics(). Working set is reported in kilobytes. */
export function appUsage(metrics) {
  let cpu = 0;
  let memoryKb = 0;
  for (const m of metrics ?? []) {
    cpu += m?.cpu?.percentCPUUsage ?? 0;
    memoryKb += m?.memory?.workingSetSize ?? 0;
  }
  return { cpuPercent: Math.round(cpu * 10) / 10, memoryBytes: memoryKb * 1024 };
}

/**
 * A health reader. Each call compares the CPU with the previous call, so the first answer has `cpuPercent: null` until a second sample.
 * Every source is passed in: `cpus`, `totalmem` and `freemem` (os), `appMetrics` (app.getAppMetrics), `address` (the LAN address),
 * `backups` (listBackups of the snapshot folder), `session` (the write meter's status plus the journal mode).
 */
export function createHealthReader({ cpus, totalmem, freemem, appMetrics, address, backups, session, now = Date.now }) {
  let previous = null;
  return function read() {
    const sample = cpuTimes(cpus());
    const cpu = cpuPercent(previous, sample);
    previous = sample;
    const total = totalmem();
    const free = freemem();
    let backupList = [];
    try {
      backupList = backups();
    } catch {
      // The folder may be missing on a first run.
    }
    let app = { cpuPercent: 0, memoryBytes: 0 };
    try {
      app = appUsage(appMetrics());
    } catch {
      // Metrics are not available outside Electron.
    }
    return {
      at: now(),
      address: address() ?? null,
      cpuPercent: cpu,
      memory: { totalBytes: total, usedBytes: Math.max(0, total - free) },
      app,
      session: session(),
      latestBackup: latestBackup(backupList),
    };
  };
}
