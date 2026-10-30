import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, Loader2, Upload } from 'lucide-react';
import { bridge } from '../live/bridge';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const button =
  'flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const primary = 'flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-bold uppercase text-on-accent hover:brightness-110 disabled:opacity-40';

const RESTORE_WARNING =
  'Restoring a database will overwrite all existing lineups, songs, and preferences. The application will restart automatically to load the new data. Do you want to continue?';

type Notice = { tone: 'ok' | 'error'; text: string } | null;

/**
 * Database & Data Management: saves a backup file, or restores one. A restore asks first, closes the database, and restarts the app.
 * The restore keeps the database it replaces as `apccmma.db.pre-import-bak`, so nothing is lost if the file was the wrong one.
 */
export function DatabaseSettings() {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState(false);

  // Escape closes the warning, as it does for the other dialogs in the app.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  const exportBackup = async () => {
    setBusy('export');
    setNotice(null);
    try {
      const result = await bridge.database.exportBackup();
      if (result.success && result.filePath) setNotice({ tone: 'ok', text: `Backup saved: ${result.filePath}` });
      else if (!result.cancelled) setNotice({ tone: 'error', text: result.error ?? 'The backup could not be saved.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setConfirming(false);
    setBusy('import');
    setNotice(null);
    try {
      const result = await bridge.database.importBackup();
      // On success the app restarts, so the loading state stays until the window closes.
      if (result.success) return;
      if (!result.cancelled) setNotice({ tone: 'error', text: result.error ?? 'The backup could not be restored.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    }
    setBusy(null);
  };

  return (
    <section aria-labelledby="database-data-heading" className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
      <h2 id="database-data-heading" className="border-b border-line pb-2 text-xl font-bold tracking-tight">
        Database &amp; Data Management
      </h2>
      <p className="text-sm text-muted">
        Save a backup file of the whole database, or restore one. Restoring replaces the current database, so save a backup first.
      </p>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={exportBackup} disabled={busy !== null} className={button}>
          {busy === 'export' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
          Export Backup
        </button>
        <button type="button" onClick={() => setConfirming(true)} disabled={busy !== null} className={button}>
          {busy === 'import' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
          Import Backup
        </button>
      </div>

      {busy === 'import' && <p role="status" className="text-sm text-accent">Restoring the database. The application is restarting…</p>}

      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`break-all text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-ok'}`}>
          {notice.text}
        </p>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirming(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            aria-describedby="restore-warning"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-fg/15 bg-panel p-6 shadow-2xl"
          >
            <h3 id="restore-title" className="flex items-center gap-2 text-lg font-bold">
              <DatabaseBackup size={18} aria-hidden /> Restore a backup?
            </h3>
            <p id="restore-warning" className="text-sm text-muted">
              {RESTORE_WARNING}
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirming(false)} className={button}>
                Cancel
              </button>
              <button type="button" onClick={restore} className={primary}>
                Restore and restart
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
