// Wording and numbers for Settings → Backup & restore, shared by the main process (file names, the saved record) and the settings page
// (the Last Backup badge, the storage sizes). Dates are formatted by hand rather than with Intl, so the text is the same on every machine
// and in the tests (ICU puts a narrow no-break space before AM/PM in some versions).

/** A backup older than this many days turns the Last Backup badge amber. */
export const BACKUP_STALE_DAYS = 14;

/** The kinds of backup the operator makes. Restores and the automatic snapshots are not recorded. */
export const BACKUP_KINDS = ['snapshot', 'full'];

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UNITS = ['KB', 'MB', 'GB', 'TB'];
const pad = (n) => String(n).padStart(2, '0');

/**
 * A size as Windows Explorer shows it (1 KB = 1024 bytes): "0 B", "512 B", "3.4 MB", "12.5 MB", "456 MB", "1.2 GB".
 * One decimal below 100 of a unit, none from 100 up. Anything that is not a size reads "—".
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 99.96 MB would round to "100.0 MB": round first, then pick the format.
  const rounded = Math.round(value * 10) / 10;
  if (rounded >= 1024 && unit < UNITS.length - 1) return `1.0 ${UNITS[unit + 1]}`;
  return rounded >= 100 ? `${Math.round(value)} ${UNITS[unit]}` : `${rounded.toFixed(1)} ${UNITS[unit]}`;
}

/** "1 file", "0 files", "1,234 files". */
export function formatFileCount(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${n === 1 ? 'file' : 'files'}`;
}

/** YYYYMMDD-HHMMSS in local time, for file names that sort by the moment they were made. */
export function compactTimestamp(now = new Date()) {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** The saved record of the last backup, or null when `raw` is not one: { at: ISO time, kind: 'snapshot' | 'full' }. */
export function sanitizeLastBackup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) return null;
  if (!BACKUP_KINDS.includes(raw.kind)) return null;
  return { at: new Date(raw.at).toISOString(), kind: raw.kind };
}

/** What the badge calls each kind. */
export function backupKindLabel(kind) {
  return kind === 'full' ? 'Full backup (DB + media)' : 'Quick DB snapshot (.db)';
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function clock(date) {
  const hours = date.getHours() % 12 || 12;
  return `${hours}:${pad(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

/**
 * When a backup was made, in local time: "Today, 9:05 AM", "Yesterday, 4:30 PM", or "Nov 12, 2026, 10:15 AM". Null for a missing or
 * unreadable time.
 */
export function formatBackupTime(iso, now = new Date()) {
  const at = typeof iso === 'string' ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  if (sameDay(at, now)) return `Today, ${clock(at)}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(at, yesterday)) return `Yesterday, ${clock(at)}`;
  return `${MONTHS[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}, ${clock(at)}`;
}

/** Whole calendar days between the backup and now (0 for today). Null for a missing or unreadable time. */
export function daysSinceBackup(iso, now = new Date()) {
  const at = typeof iso === 'string' ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Rounded, so a day that is 23 or 25 hours long (a clock change) still counts as one.
  return Math.max(0, Math.round((start(now) - start(at)) / DAY_MS));
}

/** True when there is no backup, or the last one is more than BACKUP_STALE_DAYS old. */
export function isBackupStale(last, now = new Date(), days = BACKUP_STALE_DAYS) {
  const record = sanitizeLastBackup(last);
  if (!record) return true;
  return now.getTime() - Date.parse(record.at) > days * DAY_MS;
}

/**
 * Everything the Last Backup badge shows. `text` is the line after "Last Backup:", and `reminder` is the amber nudge, or null while the
 * last backup is recent.
 */
export function describeLastBackup(last, now = new Date()) {
  const record = sanitizeLastBackup(last);
  const stale = isBackupStale(record, now);
  if (!record) {
    return { text: 'Never', kind: null, stale, reminder: 'No backup has been made on this laptop yet. Export a full backup to a USB drive.' };
  }
  const days = daysSinceBackup(record.at, now);
  const ago = days === 0 ? '' : days === 1 ? ' (1 day ago)' : ` (${days} days ago)`;
  return {
    text: `${formatBackupTime(record.at, now)}${ago} · ${backupKindLabel(record.kind)}`,
    kind: record.kind,
    stale,
    reminder: stale ? `No backup in over ${BACKUP_STALE_DAYS} days. Make one before the next Holy Mass.` : null,
  };
}
