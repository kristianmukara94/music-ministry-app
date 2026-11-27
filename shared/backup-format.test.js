// Backup & restore wording: storage sizes, file counts, backup times and the Last Backup badge. Dates are built in local time, the way the
// app reads them, so the results do not depend on the machine's time zone. Run with: node --test shared/backup-format.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_STALE_DAYS,
  backupKindLabel,
  compactTimestamp,
  daysSinceBackup,
  describeLastBackup,
  formatBackupTime,
  formatBytes,
  formatFileCount,
  isBackupStale,
  sanitizeLastBackup,
} from './backup-format.js';

const local = (y, m, d, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s);
const iso = (...args) => local(...args).toISOString();

test('sizes read like File Explorer: bytes, then one decimal below 100 of a unit, whole numbers from 100 up', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(3.4 * 1024 * 1024), '3.4 MB');
  assert.equal(formatBytes(12.25 * 1024 * 1024), '12.3 MB');
  assert.equal(formatBytes(456 * 1024 * 1024), '456 MB');
  assert.equal(formatBytes(1.2 * 1024 ** 3), '1.2 GB');
  assert.equal(formatBytes(2 * 1024 ** 4), '2.0 TB');
});

test('a size at the edge of a unit never reads "1024 KB" or "100.0 MB"', () => {
  assert.equal(formatBytes(1024 * 1024 - 1), '1.0 MB');
  assert.equal(formatBytes(99.96 * 1024 * 1024), '100 MB');
  assert.equal(formatBytes(99.94 * 1024 * 1024), '99.9 MB');
});

test('anything that is not a size reads as a dash', () => {
  for (const bad of [-1, Number.NaN, Infinity, undefined, null, '12']) assert.equal(formatBytes(bad), '—');
});

test('file counts are singular for one and use thousands separators', () => {
  assert.equal(formatFileCount(0), '0 files');
  assert.equal(formatFileCount(1), '1 file');
  assert.equal(formatFileCount(2), '2 files');
  assert.equal(formatFileCount(1234), '1,234 files');
  assert.equal(formatFileCount(1234567), '1,234,567 files');
  assert.equal(formatFileCount(-3), '0 files');
  assert.equal(formatFileCount(undefined), '0 files');
});

test('file-name timestamps are YYYYMMDD-HHMMSS in local time, zero-padded', () => {
  assert.equal(compactTimestamp(local(2026, 1, 2, 3, 4, 5)), '20260102-030405');
  assert.equal(compactTimestamp(local(2026, 12, 31, 23, 59, 59)), '20261231-235959');
});

test('the saved record keeps only a valid time and a known kind', () => {
  assert.deepEqual(sanitizeLastBackup({ at: iso(2026, 11, 20, 9), kind: 'full', path: 'x' }), { at: iso(2026, 11, 20, 9), kind: 'full' });
  assert.equal(sanitizeLastBackup({ at: 'yesterday', kind: 'full' }), null);
  assert.equal(sanitizeLastBackup({ at: iso(2026, 11, 20), kind: 'restore' }), null);
  assert.equal(sanitizeLastBackup(null), null);
  assert.equal(sanitizeLastBackup('2026-11-20'), null);
  assert.equal(backupKindLabel('full'), 'Full backup (DB + media)');
  assert.equal(backupKindLabel('snapshot'), 'Quick DB snapshot (.db)');
});

test('backup times read Today, Yesterday, or the date, with a 12-hour clock', () => {
  const now = local(2026, 11, 27, 15, 0);
  assert.equal(formatBackupTime(iso(2026, 11, 27, 9, 5), now), 'Today, 9:05 AM');
  assert.equal(formatBackupTime(iso(2026, 11, 27, 0, 30), now), 'Today, 12:30 AM');
  assert.equal(formatBackupTime(iso(2026, 11, 26, 16, 30), now), 'Yesterday, 4:30 PM');
  assert.equal(formatBackupTime(iso(2026, 11, 12, 12, 0), now), 'Nov 12, 2026, 12:00 PM');
  // Yesterday across a month and a year boundary.
  assert.equal(formatBackupTime(iso(2025, 12, 31, 22, 15), local(2026, 1, 1, 8)), 'Yesterday, 10:15 PM');
  assert.equal(formatBackupTime('not a date', now), null);
  assert.equal(formatBackupTime(null, now), null);
});

test('days since a backup count calendar days, not 24-hour spans', () => {
  const now = local(2026, 11, 27, 8, 0);
  assert.equal(daysSinceBackup(iso(2026, 11, 27, 7, 0), now), 0);
  assert.equal(daysSinceBackup(iso(2026, 11, 26, 23, 0), now), 1);
  assert.equal(daysSinceBackup(iso(2026, 11, 12, 9, 0), now), 15);
  assert.equal(daysSinceBackup(iso(2026, 11, 28, 9, 0), now), 0, 'a clock set back never gives a negative age');
  assert.equal(daysSinceBackup(undefined, now), null);
});

test('a backup is stale when there is none, or when it is more than 14 days old', () => {
  const now = local(2026, 11, 27, 12, 0);
  assert.equal(BACKUP_STALE_DAYS, 14);
  assert.equal(isBackupStale(null, now), true);
  assert.equal(isBackupStale({ at: iso(2026, 11, 13, 12, 0), kind: 'full' }, now), false, 'exactly 14 days is not over 14');
  assert.equal(isBackupStale({ at: iso(2026, 11, 13, 11, 59), kind: 'full' }, now), true);
  assert.equal(isBackupStale({ at: iso(2026, 11, 20, 9, 0), kind: 'snapshot' }, now), false);
});

test('the Last Backup badge: never, recent, and overdue', () => {
  const now = local(2026, 11, 27, 15, 0);

  const never = describeLastBackup(null, now);
  assert.equal(never.text, 'Never');
  assert.equal(never.stale, true);
  assert.match(never.reminder, /No backup has been made/);

  const today = describeLastBackup({ at: iso(2026, 11, 27, 9, 5), kind: 'full' }, now);
  assert.deepEqual(today, { text: 'Today, 9:05 AM · Full backup (DB + media)', kind: 'full', stale: false, reminder: null });

  const recent = describeLastBackup({ at: iso(2026, 11, 26, 16, 30), kind: 'snapshot' }, now);
  assert.equal(recent.text, 'Yesterday, 4:30 PM (1 day ago) · Quick DB snapshot (.db)');

  const overdue = describeLastBackup({ at: iso(2026, 11, 2, 10, 15), kind: 'snapshot' }, now);
  assert.equal(overdue.text, 'Nov 2, 2026, 10:15 AM (25 days ago) · Quick DB snapshot (.db)');
  assert.equal(overdue.stale, true);
  assert.match(overdue.reminder, /No backup in over 14 days/);
});
