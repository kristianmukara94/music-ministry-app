import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen, MonitorOff, Pin, PinOff, Shuffle } from 'lucide-react';
import { bridge, type EdidLockState, type EdidRoleStatus, type EdidStatus } from '../live/bridge';
import type { GoLiveKey } from '../../shared/golive-i18n.js';
import { useGoLiveT, type GoLiveT } from './strings';

const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));

const LOOK: Record<EdidLockState, string> = {
  unavailable: 'border-fg/20 bg-fg/[0.06] text-muted',
  unpinned: 'border-fg/25 bg-fg/[0.06] text-fg/75',
  matched: 'border-ok/60 bg-ok/15 text-ok',
  port: 'border-warn/70 bg-warn/15 text-warn',
  shifted: 'border-warn/70 bg-warn/15 text-warn',
  missing: 'border-warn/70 bg-warn/15 text-warn motion-safe:animate-pulse',
  booth: 'border-danger/70 bg-danger/15 text-danger motion-safe:animate-pulse',
};

const LABEL: Record<EdidLockState, GoLiveKey> = {
  unavailable: 'edidUnavailable',
  unpinned: 'edidUnpinned',
  matched: 'edidMatched',
  port: 'edidPort',
  shifted: 'edidShifted',
  missing: 'edidMissing',
  booth: 'edidBooth',
};

const HINT: Record<EdidLockState, GoLiveKey> = {
  unavailable: 'edidUnavailableHint',
  unpinned: 'edidUnpinnedHint',
  matched: 'edidMatchedHint',
  port: 'edidPortHint',
  shifted: 'edidShiftedHint',
  missing: 'edidMissingHint',
  booth: 'edidBoothHint',
};

/** The EDID lock's status from the main process, kept current. Null until the first answer. */
export function useEdidStatus(): EdidStatus | null {
  const [status, setStatus] = useState<EdidStatus | null>(null);
  useEffect(() => {
    let current = true;
    const off = bridge.edid.onStatus(setStatus);
    void bridge.edid.status().then((s) => {
      if (current) setStatus(s);
    });
    return () => {
      current = false;
      off();
    };
  }, []);
  return status;
}

function projectorRole(status: EdidStatus | null): EdidRoleStatus {
  if (!status?.available) return { state: 'unavailable', lock: null, connected: null };
  return status.roles.projector ?? { state: 'unpinned', lock: null, connected: null };
}

function hintFor(t: GoLiveT, role: EdidRoleStatus): string {
  const lock = role.lock;
  const name = lock ? `${lock.name}${lock.serial ? ` (${lock.serial})` : ''}` : '';
  return t(HINT[role.state], { name, port: role.connected?.portLabel ?? lock?.portLabel ?? '' });
}

/**
 * The lock's details and its controls: what it is locked to, where that monitor is now, Pin Active Sanctuary Projector and Unpin.
 * Used in the Go Live badge's popover and on the Projector settings page.
 */
export function EdidLockPanel({ status }: { status: EdidStatus | null }) {
  const t = useGoLiveT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = projectorRole(status);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const serial = (s: string) => s || t('edidNoSerial');

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="leading-snug text-fg/85">{hintFor(t, role)}</p>
      {role.lock && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-faint">{t('edidLockedTo')}</dt>
          <dd className="min-w-0 text-fg">
            {role.lock.name} · <span className="font-mono">{serial(role.lock.serial)}</span>
            <div className="text-muted">{role.lock.portLabel}</div>
          </dd>
          {role.connected && (
            <>
              <dt className="text-faint">{t('edidNowOn')}</dt>
              <dd className="min-w-0 text-fg">
                {role.connected.portLabel} · <span className="font-mono">{role.connected.gdiDeviceName}</span>
              </dd>
            </>
          )}
        </dl>
      )}
      {status?.available && status.monitors.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{t('edidMonitors')}</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-fg/75">
            {status.monitors.map((m) => (
              <li key={`${m.gdiDeviceName}-${m.portLabel}`}>
                {m.name} · <span className="font-mono">{serial(m.serial)}</span> · {m.portLabel}
                {m.primary && <span className="text-faint"> ({t('edidPrimary')})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {status?.available && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => bridge.edid.pin())}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-accent bg-accent px-3 text-xs font-bold tracking-wide text-on-accent uppercase transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40"
          >
            <Pin size={14} aria-hidden /> {t('pinProjector')}
          </button>
          {role.lock && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => bridge.edid.unpin())}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-fg/20 px-3 text-xs font-bold tracking-wide text-fg/85 uppercase transition hover:bg-fg/[0.06] focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40"
            >
              <PinOff size={14} aria-hidden /> {t('unpinProjector')}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The EDID lock on the Go Live console bar. Desktop app only. */
export function EdidLockBadge() {
  const t = useGoLiveT();
  const status = useEdidStatus();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!bridge.isElectron) return null;
  const role = projectorRole(status);
  const label = t(LABEL[role.state]);
  const Icon = role.state === 'matched' ? Lock : role.state === 'shifted' ? Shuffle : role.state === 'missing' || role.state === 'booth' ? MonitorOff : LockOpen;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={hintFor(t, role)}
        className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-xs font-bold tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${LOOK[role.state]}`}
      >
        <Icon size={15} aria-hidden />
        <span role="status" aria-live="polite">
          {label}
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label={t('edidLockHeading')} className="absolute top-12 right-0 z-40 w-96 rounded-[10px] border border-line bg-surface p-4 text-fg shadow-xl">
          <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{t('edidLockHeading')}</div>
          <EdidLockPanel status={status} />
        </div>
      )}
    </div>
  );
}
