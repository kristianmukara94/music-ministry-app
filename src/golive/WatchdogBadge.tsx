import { useEffect, useRef, useState } from 'react';
import { Power, ShieldAlert, ShieldCheck, ShieldEllipsis, Unplug } from 'lucide-react';
import { bridge, type FailoverMode, type WatchdogStatus } from '../live/bridge';
import type { GoLiveKey } from '../../shared/golive-i18n.js';
import { useGoLiveT } from './strings';

/** The hotkey shown on the button. Kept in step with isFailoverHotkey in electron/hotkeys.js. */
const HOTKEY = 'Ctrl+Shift+B';

type Look = 'standby' | 'starting' | 'active' | 'engaged' | 'parked';

const LOOK: Record<Look, { pill: string; dot: string }> = {
  standby: { pill: 'border-fg/20 bg-fg/[0.06] text-muted', dot: 'bg-fg/40' },
  starting: { pill: 'border-fg/25 bg-fg/[0.06] text-fg/75', dot: 'bg-fg/50' },
  active: { pill: 'border-ok/60 bg-ok/15 text-ok', dot: 'bg-ok' },
  engaged: { pill: 'border-danger/70 bg-danger/20 text-danger motion-safe:animate-pulse', dot: 'bg-danger' },
  parked: { pill: 'border-warn/70 bg-warn/15 text-warn motion-safe:animate-pulse', dot: 'bg-warn' },
};

const FAULT_KEY: Record<NonNullable<WatchdogStatus['fault']>, GoLiveKey> = {
  crash: 'watchdogFaultCrash',
  freeze: 'watchdogFaultFreeze',
  unresponsive: 'watchdogFaultUnresponsive',
  gpu: 'watchdogFaultGpu',
};

function lookOf(s: WatchdogStatus | null): Look {
  if (!s?.projectorOpen) return 'standby';
  if (s.engaged) return 'engaged';
  if (s.parked) return 'parked';
  return s.armed ? 'active' : 'starting';
}

/** The watchdog's status from the main process, kept current. Null until the first answer. */
function useWatchdogStatus(): WatchdogStatus | null {
  const [status, setStatus] = useState<WatchdogStatus | null>(null);
  useEffect(() => {
    let current = true;
    const off = bridge.watchdog.onStatus(setStatus);
    void bridge.watchdog.status().then((s) => {
      if (current) setStatus(s);
    });
    return () => {
      current = false;
      off();
    };
  }, []);
  return status;
}

/**
 * The sanctuary display watchdog on the Go Live console bar: its health at a glance, the failover screen's look, and the booth's emergency
 * Force Failover (Blackout), also on Ctrl+Shift+B from any window. Desktop app only: the browser preview has no projector window to watch.
 */
export function WatchdogBadge() {
  const t = useGoLiveT();
  const status = useWatchdogStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const look = lookOf(status);
  const label =
    look === 'engaged' ? t('watchdogEngaged') : look === 'parked' ? t('watchdogParked') : look === 'active' ? t('watchdogActive') : look === 'starting' ? t('watchdogStarting') : t('watchdogStandby');
  const hint = !status?.projectorOpen
    ? t('watchdogStandbyHint')
    : status.manual
      ? t('watchdogManualHint')
      : status.fault
        ? t('watchdogEngagedHint', { reason: t(FAULT_KEY[status.fault]) })
        : status.parked
          ? t('watchdogParkedHint')
          : status.armed
            ? t('watchdogActiveHint')
            : t('watchdogStartingHint');
  const Icon = look === 'engaged' ? ShieldAlert : look === 'parked' ? Unplug : look === 'active' ? ShieldCheck : ShieldEllipsis;
  const manual = status?.manual ?? false;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const setMode = (mode: FailoverMode) => void run(() => bridge.watchdog.setMode(mode));
  const forceLabel = manual ? t('releaseFailover') : t('forceFailover');

  return (
    <div ref={wrap} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={hint}
        className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-xs font-bold tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${LOOK[look].pill}`}
      >
        <Icon size={15} aria-hidden />
        <span role="status" aria-live="assertive">
          {label}
        </span>
      </button>

      <button
        type="button"
        disabled={busy || !status?.projectorOpen}
        onClick={() => void run(() => bridge.watchdog.force(!manual))}
        title={`${forceLabel} (${HOTKEY})`}
        aria-pressed={manual}
        aria-keyshortcuts="Control+Shift+B"
        className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-extrabold tracking-wide uppercase transition focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
          manual ? 'border-danger bg-danger text-canvas hover:brightness-110' : 'border-danger/60 text-danger hover:bg-danger/15'
        }`}
      >
        <Power size={15} aria-hidden />
        {forceLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute top-12 right-0 z-40 w-80 rounded-[10px] border border-line bg-surface p-4 text-sm text-fg shadow-xl"
        >
          <p className="leading-snug text-fg/85">{hint}</p>
          {status && status.recoveries > 0 && <p className="mt-2 text-xs text-muted">{t('watchdogRecoveries', { n: status.recoveries })}</p>}
          <fieldset className="mt-4" disabled={busy}>
            <legend className="text-[11px] font-semibold tracking-wider text-muted uppercase">{t('failoverModeLabel')}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['emblem', 'blackout'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60 ${
                    status?.mode === mode ? 'border-accent bg-accent/15 text-fg' : 'border-fg/15 text-fg/75 hover:bg-fg/[0.06]'
                  }`}
                >
                  <input type="radio" name="failover-mode" className="sr-only" checked={status?.mode === mode} onChange={() => setMode(mode)} />
                  <span aria-hidden className={`size-3 rounded-sm border border-fg/30 ${mode === 'emblem' ? 'bg-[#080507]' : 'bg-black'}`} />
                  {mode === 'emblem' ? t('failoverEmblem') : t('failoverBlackout')}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
