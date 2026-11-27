import { useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, FolderOpen } from 'lucide-react';
import { bridge } from '../live/bridge';
import { describeLastBackup, formatBytes, formatFileCount, type LastBackup } from '../../shared/backup-format.js';
import type { StorageStats } from './types';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const small =
  'flex h-8 items-center gap-1.5 rounded-md border border-fg/15 px-3 text-[11px] font-bold uppercase hover:bg-fg/10 disabled:opacity-40';

/**
 * The database and media sizes, measured in the main process after the page has drawn, so a large media folder never holds up the page.
 * `refresh` re-measures when it changes (after a backup or a move). `null` while measuring.
 */
export function useStorageStats(enabled: boolean, refresh: number): StorageStats | null {
  const [stats, setStats] = useState<StorageStats | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setStats(null);
    bridge.config
      .storageStats()
      .then((next) => live && setStats(next))
      .catch(() => live && setStats({ database: null, media: null }));
    return () => {
      live = false;
    };
  }, [enabled, refresh]);
  return stats;
}

export const databaseSizeText = (stats: StorageStats | null) =>
  stats === null ? 'DB: measuring…' : stats.database ? `DB: ${formatBytes(stats.database.bytes)}` : 'DB: size unavailable';

export const mediaSizeText = (stats: StorageStats | null) =>
  stats === null
    ? 'Media: measuring…'
    : stats.media
      ? `Media: ${formatBytes(stats.media.bytes)} · ${formatFileCount(stats.media.files)}`
      : 'Media: size unavailable';

/** "Last Backup: …", amber with a reminder when there is none or the newest is more than 14 days old. */
export function LastBackupBadge({ last }: { last: LastBackup | null }) {
  const { text, stale, reminder } = describeLastBackup(last);
  return (
    <div
      role="status"
      aria-label="Last backup"
      className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm ${stale ? 'border-warn/50 bg-warn/10' : 'border-ok/40 bg-panel'}`}
    >
      <span className="flex flex-wrap items-center gap-2">
        {stale ? <AlertTriangle size={15} className="shrink-0 text-warn" aria-hidden /> : <CheckCircle2 size={15} className="shrink-0 text-ok" aria-hidden />}
        <span className="eyebrow">Last Backup:</span>
        <span className="font-semibold">{text}</span>
      </span>
      {reminder && <span className="text-xs text-warn">{reminder}</span>}
    </div>
  );
}

/** A path (the database file or the media folder) with Open Folder, Copy Path and its size. */
export function StoragePathRow({
  label,
  path,
  size,
  onOpen,
  disabled = false,
}: {
  label: string;
  path: string;
  size: string;
  onOpen: () => Promise<void>;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const open = () => {
    setError(null);
    onOpen().catch((err) => setError(errorText(err)));
  };
  const copy = () => {
    setError(null);
    navigator.clipboard
      ?.writeText(path)
      .then(() => setCopied(true))
      .catch(() => setError('Could not copy. Select the path and copy it by hand.'));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        <span className="font-mono text-[11px] text-muted" aria-live="polite">
          {size}
        </span>
      </div>
      <code aria-label={`${label} path`} className="block break-all rounded-md border border-fg/15 bg-panel-2 px-3 py-2 font-mono text-xs text-fg">
        {path}
      </code>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={open} disabled={disabled} className={small} title={`Open the ${label.toLowerCase()} in File Explorer`}>
          <FolderOpen size={13} aria-hidden /> Open Folder
        </button>
        <button type="button" onClick={copy} disabled={disabled} className={small} title="Copy the full path">
          {copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? 'Copied' : 'Copy Path'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
