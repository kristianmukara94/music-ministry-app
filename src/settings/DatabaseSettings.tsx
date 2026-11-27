import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, DatabaseBackup, Loader2, Upload } from 'lucide-react';
import { bridge, type BackupProgress } from '../live/bridge';
import { formatBytes, formatFileCount } from '../../shared/backup-format.js';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const button =
  'flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const primary = 'flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-bold uppercase text-on-accent hover:brightness-110 disabled:opacity-40';

const RESTORE_WARNING =
  'Restoring a database will overwrite all existing lineups, songs, and preferences. The application will restart automatically to load the new data. Do you want to continue?';

const SAFETY_NOTE =
  'Before anything is replaced, the current database is saved automatically as apccmma-pre-restore-<date>-<time>.db in the backups folder next to it (the 5 newest are kept), so a wrong file can be undone.';

type Notice = { tone: 'ok' | 'error'; text: string } | null;
type Busy = 'export-full' | 'restore-full' | 'restore-db' | null;
type Restore = 'full' | 'db';

const RESTORE_COPY: Record<Restore, { title: string; detail: string; action: string }> = {
  full: {
    title: 'Restore a full backup?',
    detail:
      'Choose a full backup (.zip). Its database replaces the current one, and any media files from it that this laptop does not have are added. Media already here is never overwritten or deleted.',
    action: 'Choose backup and restart',
  },
  db: {
    title: 'Restore a DB snapshot?',
    detail: 'Choose a database snapshot (.db). Only the database is replaced: the media folder is left as it is.',
    action: 'Choose snapshot and restart',
  },
};

/** Export or restore progress: a bar and a count of files. */
function ArchiveProgress({ progress, phase }: { progress: BackupProgress | null; phase: 'export' | 'restore' }) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const verb = phase === 'export' ? 'Saving full backup' : 'Restoring media';
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-canvas p-4" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 size={15} className="animate-spin text-accent" aria-hidden />
        {total > 0 ? `${verb}… [${done} / ${total} files]` : `${verb}… preparing`}
      </div>
      <div
        role="progressbar"
        aria-label={`${verb} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-panel-2"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
      {progress?.current && <p className="truncate font-mono text-[11px] text-muted">{progress.current}</p>}
      <p className="text-xs text-muted">Keep APCCMMA open until this finishes. A large media library can take several minutes.</p>
    </div>
  );
}

/**
 * Database & Data Management: the full backup (one .zip with apccmma.db and the whole apccmma_assets media folder) and its restore, plus
 * restoring a .db snapshot. A restore asks first, keeps a pre-restore safety copy of the current database, and restarts the app.
 */
export function DatabaseSettings({ onBackupSaved }: { onBackupSaved?: () => void }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState<Restore | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);

  useEffect(() => bridge.database.onBackupProgress(setProgress), []);

  // Escape closes the warning, as it does for the other dialogs in the app.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  const exportFull = async () => {
    setBusy('export-full');
    setNotice(null);
    setProgress(null);
    try {
      const result = await bridge.database.exportFullBackup();
      if (result.success && result.filePath) {
        const size = result.bytes !== undefined ? ` (${formatBytes(result.bytes)}, ${formatFileCount(result.mediaFiles ?? 0)} of media)` : '';
        setNotice({ tone: 'ok', text: `Full backup saved${size}: ${result.filePath}` });
        onBackupSaved?.();
      } else if (!result.cancelled) setNotice({ tone: 'error', text: result.error ?? 'The full backup could not be saved.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const restore = async (kind: Restore) => {
    setConfirming(null);
    setBusy(kind === 'full' ? 'restore-full' : 'restore-db');
    setNotice(null);
    setProgress(null);
    try {
      const result = kind === 'full' ? await bridge.database.restoreFullBackup() : await bridge.database.importBackup();
      // On success the app restarts, so the loading state stays until the window closes.
      if (result.success) return;
      if (!result.cancelled) setNotice({ tone: 'error', text: result.error ?? 'The backup could not be restored.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    }
    setBusy(null);
    setProgress(null);
  };

  const copy = confirming ? RESTORE_COPY[confirming] : null;

  return (
    <section aria-labelledby="database-data-heading" className="flex flex-col gap-5 rounded-xl border border-line bg-panel p-5">
      <h2 id="database-data-heading" className="border-b border-line pb-2 text-xl font-bold tracking-tight">
        Database &amp; Data Management
      </h2>

      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Archive size={15} aria-hidden /> Full backup (DB + media)
        </h3>
        <p className="text-sm text-muted">
          One portable <code className="font-mono">.zip</code> file with the database (<code className="font-mono">apccmma.db</code>) and the whole{' '}
          <code className="font-mono">apccmma_assets</code> media folder: pictures, videos, slides and presentations. Use it to set up a new laptop, or
          keep one on a USB drive in case this laptop fails.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={exportFull} disabled={busy !== null} className={primary}>
            {busy === 'export-full' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Archive size={15} aria-hidden />}
            Export Full Backup (DB + Media)
          </button>
          <button type="button" onClick={() => setConfirming('full')} disabled={busy !== null} className={button}>
            {busy === 'restore-full' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ArchiveRestore size={15} aria-hidden />}
            Restore Full Backup
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <DatabaseBackup size={15} aria-hidden /> Database only (.db)
        </h3>
        <p className="text-sm text-muted">
          Restore a <code className="font-mono">.db</code> file made with Quick DB Snapshot. Only the database is replaced; the media folder is not
          changed.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setConfirming('db')} disabled={busy !== null} className={button}>
            {busy === 'restore-db' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
            Restore DB Snapshot (.db)
          </button>
        </div>
      </div>

      {busy === 'export-full' && <ArchiveProgress progress={progress} phase="export" />}
      {busy === 'restore-full' && progress && <ArchiveProgress progress={progress} phase="restore" />}
      {(busy === 'restore-full' || busy === 'restore-db') && (
        <p role="status" className="text-sm text-accent">
          Restoring the backup. The application restarts when it is done…
        </p>
      )}

      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`break-all text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-ok'}`}>
          {notice.text}
        </p>
      )}

      {confirming && copy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setConfirming(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            aria-describedby="restore-warning"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-fg/15 bg-surface p-6 shadow-2xl"
          >
            <h3 id="restore-title" className="flex items-center gap-2 text-lg font-bold">
              <DatabaseBackup size={18} aria-hidden /> {copy.title}
            </h3>
            <div id="restore-warning" className="flex flex-col gap-2 text-sm text-muted">
              <p>{RESTORE_WARNING}</p>
              <p>{copy.detail}</p>
              <p className="text-fg">{SAFETY_NOTE}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirming(null)} className={button}>
                Cancel
              </button>
              <button type="button" onClick={() => void restore(confirming)} className={primary}>
                {copy.action}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
