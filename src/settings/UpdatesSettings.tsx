import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, RotateCw } from 'lucide-react';
import { bridge } from '../live/bridge';
import type { UpdateEvent, UpdatesState } from './types';

const api = bridge.updates;

const MB = 1024 * 1024;
const megabytes = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;
const formatTime = (epochMs: number) => new Date(epochMs).toLocaleString();
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const button =
  'flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';
const primaryButton =
  'flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-bold uppercase text-canvas shadow-md hover:opacity-90 disabled:opacity-40';
const okButton =
  'flex h-10 items-center gap-2 rounded-md bg-ok px-4 text-xs font-bold uppercase text-canvas shadow-md hover:opacity-90 disabled:opacity-40';

interface Props {
  installedVersion: string;
}

/** The Updates page: the installed version, a check button, and a status card for each step of an update. */
export function UpdatesPanel({ installedVersion }: Props) {
  const [state, setState] = useState<UpdatesState>({ last: null, lastCheckedAt: null });

  useEffect(() => {
    const unsubscribe = api.onEvent((event: UpdateEvent) => {
      const checked = event.channel === 'UPDATE_AVAILABLE' || event.channel === 'UPDATE_NOT_AVAILABLE';
      setState((current) => ({ last: event, lastCheckedAt: checked ? Date.now() : current.lastCheckedAt }));
    });
    // An event that arrived before this reply is newer than the saved state, so it wins.
    api
      .getState()
      .then((saved) => setState((current) => (current.last ? { ...current, lastCheckedAt: current.lastCheckedAt ?? saved.lastCheckedAt } : saved)))
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  /** A request that fails before the main process reports it is shown as an error, not lost. */
  const run = (task: () => Promise<void>) => {
    task().catch((err: unknown) => setState((current) => ({ ...current, last: { channel: 'UPDATE_ERROR', payload: { message: errorText(err) } } })));
  };

  const check = () => run(() => api.check());
  const download = () => run(() => api.download());
  const restart = () => {
    if (window.confirm('APCCMMA will close to install the update. Continue?')) run(() => api.restart());
  };

  const event = state.last;
  const working = event?.channel === 'UPDATE_CHECKING' || event?.channel === 'UPDATE_PROGRESS';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm">
          Installed version <span className="font-mono font-bold">v{installedVersion}</span>
        </p>
        <button type="button" onClick={check} disabled={working} className={button}>
          <RefreshCw size={15} aria-hidden className={event?.channel === 'UPDATE_CHECKING' ? 'animate-spin' : undefined} />
          Check for updates
        </button>
      </div>

      <UpdateStatus event={event} lastCheckedAt={state.lastCheckedAt} onCheck={check} onDownload={download} onRestart={restart} />
    </div>
  );
}

interface StatusProps {
  event: UpdateEvent | null;
  lastCheckedAt: number | null;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}

function UpdateStatus({ event, lastCheckedAt, onCheck, onDownload, onRestart }: StatusProps) {
  if (!event) {
    return <p className="text-sm text-muted">Press Check for updates to look for a newer version on GitHub.</p>;
  }

  switch (event.channel) {
    case 'UPDATE_CHECKING':
      return (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border border-line-strong bg-canvas px-4 py-3 text-sm">
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          Checking GitHub Releases for updates...
        </div>
      );

    case 'UPDATE_NOT_AVAILABLE':
      return (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-ok/40 bg-ok/10 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-bold text-ok">
            <CheckCircle2 size={16} aria-hidden /> You are running the latest version
          </span>
          {lastCheckedAt && <span className="text-xs text-muted">Last checked {formatTime(lastCheckedAt)}</span>}
        </div>
      );

    case 'UPDATE_AVAILABLE':
      return (
        <div role="status" className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-accent/10 p-4">
          <span className="w-fit rounded-full border border-accent/60 bg-accent/15 px-3 py-1 text-xs font-bold text-accent uppercase">
            New Version v{event.payload.version} Available
          </span>
          {event.payload.notes && <p className="text-sm text-muted">{event.payload.notes}</p>}
          <div>
            <button type="button" onClick={onDownload} className={primaryButton}>
              <Download size={15} aria-hidden /> Download &amp; Install Update
            </button>
          </div>
        </div>
      );

    case 'UPDATE_PROGRESS': {
      const { percent, transferred, total, bytesPerSecond } = event.payload;
      return (
        <div role="status" className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-canvas p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
            <span>Downloading update</span>
            <span className="font-mono">
              {Math.round(percent)}% - {megabytes(transferred)} / {megabytes(total)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Update download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-2 w-full overflow-hidden rounded-full bg-panel-2"
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted">{megabytes(bytesPerSecond)}/s. Keep APCCMMA open until the download finishes.</p>
        </div>
      );
    }

    case 'UPDATE_DOWNLOADED':
      return (
        <div role="status" className="flex flex-col gap-4 rounded-lg border border-ok/40 bg-ok/10 p-4">
          <span className="flex items-center gap-2 text-sm font-bold text-ok">
            <CheckCircle2 size={16} aria-hidden /> Update v{event.payload.version} Downloaded
          </span>
          <p className="text-xs text-muted">Restart to finish installing. It also installs the next time APCCMMA quits.</p>
          <div>
            <button type="button" onClick={onRestart} className={okButton}>
              <RotateCw size={15} aria-hidden /> Restart &amp; Apply Update
            </button>
          </div>
        </div>
      );

    case 'UPDATE_ERROR':
      return (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger bg-danger/10 p-4">
          <span className="flex items-center gap-2 text-sm font-bold text-danger">
            <AlertTriangle size={16} aria-hidden /> The update could not be completed
          </span>
          <p className="break-words font-mono text-xs text-muted">{event.payload.message}</p>
          <div>
            <button type="button" onClick={onCheck} className={button}>
              <RefreshCw size={15} aria-hidden /> Retry Check
            </button>
          </div>
        </div>
      );
  }
}
