export type BackupKind = 'snapshot' | 'full';

export interface LastBackup {
  /** ISO time the backup finished. */
  at: string;
  kind: BackupKind;
}

export interface LastBackupDescription {
  /** The text after "Last Backup:". */
  text: string;
  kind: BackupKind | null;
  stale: boolean;
  /** The amber reminder, or null while the last backup is recent. */
  reminder: string | null;
}

export const BACKUP_STALE_DAYS: number;
export const BACKUP_KINDS: readonly BackupKind[];
export function formatBytes(bytes: number): string;
export function formatFileCount(count: number): string;
export function compactTimestamp(now?: Date): string;
export function sanitizeLastBackup(raw: unknown): LastBackup | null;
export function backupKindLabel(kind: BackupKind): string;
export function formatBackupTime(iso: string | null | undefined, now?: Date): string | null;
export function daysSinceBackup(iso: string | null | undefined, now?: Date): number | null;
export function isBackupStale(last: unknown, now?: Date, days?: number): boolean;
export function describeLastBackup(last: unknown, now?: Date): LastBackupDescription;
