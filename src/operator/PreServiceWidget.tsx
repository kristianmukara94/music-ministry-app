import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ListOrdered, Monitor, MonitorPlay, Plus, Smartphone, X, type LucideIcon } from 'lucide-react';
import { EVERY_DAY, formatCountdown, nextMassStart, sanitizeMassTimes, type MassTime } from '../../shared/service-schedule.js';
import { bridge, type RemoteViewStatus } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { LICENSE_LOCKED_TIP, useProjectionLocked } from '../live/license';
import { DATE_LOCALES, useT, type StringKey } from '../i18n/strings';
import { formatClock, formatWeekday } from '../state/region';
import { useRegion } from '../state/useRegion';
import { setUi, useUi } from '../state/ui';
import { useNow } from './useNow';

/** How often the checks that live in the main process (displays, the remote server, the lower third server) are read again. */
const POLL_MS = 5000;

interface Check {
  key: string;
  icon: LucideIcon;
  label: StringKey;
  /** Null while the first reading is on its way. */
  ok: boolean | null;
  detail: string;
  fix?: { label: StringKey; run: () => void; locked?: boolean };
}

/** Everything the checks need from the main process, read every few seconds while the dashboard is open. */
function useSystemChecks() {
  const [displays, setDisplays] = useState<number | null>(null);
  const [remote, setRemote] = useState<RemoteViewStatus | null>(null);
  const [lower, setLower] = useState<{ running: boolean; port: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      bridge.displays.list().then((d) => alive && setDisplays(d.length)).catch(() => alive && setDisplays(0));
      bridge.remoteView.get().then((r) => alive && setRemote(r)).catch(() => alive && setRemote(null));
      bridge.lowerThird
        .info()
        // An older main process does not report `running`; its server was started, so it counts as running.
        .then((i) => alive && setLower({ running: i.running !== false, port: i.port }))
        .catch(() => alive && setLower({ running: false, port: 0 }));
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return { displays, remote, lower };
}

function useChecks(): Check[] {
  const t = useT();
  const { outputs, queue, queuePlanId } = useLive((s) => s.state);
  const { displays, remote, lower } = useSystemChecks();
  const locked = useProjectionLocked();

  // Projector: its output is on, and there is a second display for it (on one screen it would cover the console).
  const projectorOk = displays === null ? null : outputs.projector && displays >= 2;
  const projector: Check = {
    key: 'projector',
    icon: Monitor,
    label: 'ready.projector',
    ok: projectorOk,
    detail: !outputs.projector ? t('ready.projectorOff') : displays !== null && displays < 2 ? t('ready.oneDisplay') : t('ready.projectorOk'),
    fix: !outputs.projector ? { label: 'ready.fixProjector', run: () => dispatch({ type: 'output/set', output: 'projector', on: true }), locked } : undefined,
  };

  const lowerThird: Check = {
    key: 'lowerThird',
    icon: MonitorPlay,
    label: 'ready.lowerThird',
    ok: lower === null ? null : lower.running,
    detail: lower?.running ? `${t('ready.lowerOk')} ${lower.port}` : t('ready.lowerDown'),
    fix: lower && !lower.running ? { label: 'ready.fixLowerThird', run: () => setUi({ view: 'settings' }) } : undefined,
  };

  const viewers = remote ? [remote.primary, remote.secondary] : [];
  const serving = viewers.find((v) => v.running);
  const failing = viewers.find((v) => v.enabled && !v.running);
  const remoteCheck: Check = {
    key: 'remote',
    icon: Smartphone,
    label: 'ready.remote',
    ok: remote === null ? null : Boolean(serving),
    detail: serving ? `${t('ready.remoteOk')} ${serving.url ?? ''}` : failing ? failing.error || t('ready.remoteError') : t('ready.remoteOff'),
    fix: remote && !serving ? { label: 'ready.fixRemote', run: () => setUi({ remoteOpen: true }) } : undefined,
  };

  const playable = queue.filter((q) => !q.stale).length;
  const queueOk = queuePlanId != null && playable > 0;
  const queueCheck: Check = {
    key: 'queue',
    icon: ListOrdered,
    label: 'ready.queue',
    ok: queueOk,
    detail: queueOk ? `${playable} ${t('ready.queueOk')}` : t('ready.queueEmpty'),
    fix: queueOk ? undefined : { label: 'ready.fixQueue', run: () => setUi({ view: 'goLive' }) },
  };

  return [projector, lowerThird, remoteCheck, queueCheck];
}

function CheckRow({ check }: { check: Check }) {
  const t = useT();
  const { icon: Icon } = check;
  const tone = check.ok === null ? 'text-fg/50' : check.ok ? 'text-ok' : 'text-warn';
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5">
      <span className={`grid size-8 shrink-0 place-items-center rounded-md bg-fg/[0.06] ${tone}`}>
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          {check.ok === true && <CheckCircle2 size={14} aria-hidden className="shrink-0 text-ok" />}
          {check.ok === false && <AlertTriangle size={14} aria-hidden className="shrink-0 text-warn" />}
          <span className="truncate">{t(check.label)}</span>
        </div>
        <div className="truncate text-xs text-fg/65" title={check.detail}>{check.ok === null ? t('ready.checking') : check.detail}</div>
      </div>
      {check.fix && (
        <button type="button" onClick={check.fix.run} disabled={check.fix.locked} title={check.fix.locked ? LICENSE_LOCKED_TIP : undefined}
          className="shrink-0 rounded-md border border-warn/50 bg-warn/10 px-2.5 py-1 text-xs font-bold text-warn transition hover:bg-warn/20 disabled:cursor-not-allowed disabled:opacity-50">
          {t(check.fix.label)}
        </button>
      )}
    </li>
  );
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** The Mass times editor: a weekday (or every day) and a time per row. Saved as the operator types, with the other preferences. */
function MassTimesEditor({ onDone }: { onDone: () => void }) {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const saved = useUi((s) => s.massTimes);
  // Rows being edited, including a half-typed one; only valid rows are saved.
  const [rows, setRows] = useState<MassTime[]>(() => (saved.length > 0 ? saved : [{ day: 0, time: '08:00' }]));
  const dayName = (day: number) =>
    new Intl.DateTimeFormat(DATE_LOCALES[lang], { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + day)));

  const update = (next: MassTime[]) => {
    setRows(next);
    setUi({ massTimes: sanitizeMassTimes(next) });
  };
  const field = 'h-8 rounded-md border border-line-strong bg-canvas px-2 text-sm outline-none focus:border-accent';
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1">
        {rows.map((row, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <select aria-label={t('count.title')} className={`${field} min-w-0 flex-1`} value={row.day}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, day: Number(e.target.value) } : r)))}>
              <option value={EVERY_DAY}>{t('count.everyDay')}</option>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{dayName(d)}</option>)}
            </select>
            <input type="time" aria-label={t('count.title')} className={`${field} w-28`} value={row.time}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, time: e.target.value } : r)))} />
            <button type="button" aria-label={t('count.remove')} title={t('count.remove')} onClick={() => update(rows.filter((_, j) => j !== i))}
              className="grid size-8 shrink-0 place-items-center rounded-md text-fg/60 hover:bg-fg/10 hover:text-fg">
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => update([...rows, { day: 0, time: '10:00' }])}
          className="flex items-center gap-1 rounded-md border border-dashed border-fg/30 px-2.5 py-1 text-xs font-semibold text-fg/80 hover:border-accent hover:text-accent">
          <Plus size={13} /> {t('count.add')}
        </button>
        {/* Saves what is on screen, so a suggested first row the operator accepts as it is counts too. */}
        <button type="button" onClick={() => { setUi({ massTimes: sanitizeMassTimes(rows) }); onDone(); }}
          className="rounded-md bg-accent px-3 py-1 text-xs font-extrabold uppercase text-on-accent">{t('count.done')}</button>
      </div>
      <p className="text-[11px] text-fg/50">{t('count.zoneNote')}</p>
    </div>
  );
}

/** The countdown to the next Mass on the parish's schedule, in the Region time zone. */
function Countdown() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const times = useUi((s) => s.massTimes);
  const region = useRegion();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const next = nextMassStart(now, times, region.timeZone);

  if (editing) return <MassTimesEditor onDone={() => setEditing(false)} />;
  if (!next) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Clock size={28} strokeWidth={1.5} aria-hidden className="text-fg/50" />
        <div className="text-sm font-semibold text-fg/80">{t('count.none')}</div>
        <button type="button" onClick={() => setEditing(true)} className="rounded-md bg-fg px-3 py-1.5 text-xs font-bold text-canvas hover:brightness-110">
          {t('count.set')}
        </button>
      </div>
    );
  }
  const at = new Date(next.at);
  const when = `${formatWeekday(at, region, DATE_LOCALES[lang])} ${formatClock(at, region)}`;
  // The last ten minutes before Mass are amber, so the booth sees time is short.
  const soon = !next.started && next.at - now.getTime() <= 10 * 60 * 1000;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <div className="text-xs font-semibold tracking-wide text-fg/70 uppercase">{next.label || t('count.title')} · {when}</div>
      {next.started ? (
        <div className="text-2xl font-bold text-ok">{t('count.started')}</div>
      ) : (
        <>
          <div className="text-xs text-fg/60">{t('count.startsIn')}</div>
          <div className={`font-mono text-4xl leading-none font-bold tabular-nums ${soon ? 'text-warn' : 'text-fg'}`} aria-live="off">
            {formatCountdown(next.at - now.getTime())}
          </div>
        </>
      )}
      <button type="button" onClick={() => setEditing(true)} className="mt-1 text-xs font-semibold text-fg/55 underline-offset-2 hover:text-fg hover:underline">
        {t('count.edit')}
      </button>
    </div>
  );
}

/**
 * Pre-Service Readiness: the four sub-systems a Mass needs (the projector display, the lower third engine, the remote server and a loaded
 * plan) checked at a glance, with a one-click fix beside any that is not ready, and the countdown to the next Mass.
 */
export function PreServiceWidget() {
  const t = useT();
  const checks = useChecks();
  const ready = checks.filter((c) => c.ok === true).length;
  const settled = checks.every((c) => c.ok !== null);
  const allReady = ready === checks.length;
  const badge = allReady
    ? 'border-ok/60 bg-ok/15 text-ok'
    : settled
      ? 'border-warn/60 bg-warn/15 text-warn'
      : 'border-fg/20 bg-fg/5 text-fg/60';
  return (
    <section aria-labelledby="pre-service-title" className="grid shrink-0 grid-cols-1 overflow-hidden rounded-[10px] border border-fg/[0.12] bg-panel lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-fg/10 px-4 py-2.5">
          <h2 id="pre-service-title" className="text-xs font-semibold tracking-wide text-fg/70 uppercase">{t('ready.eyebrow')}</h2>
          <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider uppercase ${badge}`}>
            {allReady ? (
              <><CheckCircle2 size={12} aria-hidden /> {ready}/{checks.length} {t('ready.ready')}</>
            ) : settled ? (
              <><AlertTriangle size={12} aria-hidden /> {t('ready.actionNeeded')} · {ready}/{checks.length}</>
            ) : (
              t('ready.checking')
            )}
          </span>
        </header>
        <ul className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2">
          {checks.map((c) => <CheckRow key={c.key} check={c} />)}
        </ul>
      </div>
      <div className="min-h-[150px] border-t border-fg/10 p-4 lg:border-t-0 lg:border-l">
        <Countdown />
      </div>
    </section>
  );
}
