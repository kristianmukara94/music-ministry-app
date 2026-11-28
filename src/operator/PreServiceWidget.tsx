import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, BookOpen, CheckCircle2, Clock, Cloud, Copy, FileWarning, ListOrdered, Monitor, MonitorPlay, Plus, QrCode, RefreshCw, Smartphone, X, type LucideIcon } from 'lucide-react';
import { EVERY_DAY, formatCountdown, nextMassStart, sanitizeMassTimes, type MassTime } from '../../shared/service-schedule.js';
import { cloudSyncReadiness, isoDayInZone, lanUrl, scheduledPlan, serviceGaps, serviceGapsText } from '../../shared/service-console.js';
import { segmentStatus } from '../../shared/pw.js';
import { bridge, type CloudLink, type PlansSyncState, type RemoteViewStatus } from '../live/bridge';
import { useLive } from '../live/store';
import { DATE_LOCALES, useT, type StringKey } from '../i18n/strings';
import { formatClock, formatWeekday } from '../state/region';
import { useRegion } from '../state/useRegion';
import { setUi, useUi } from '../state/ui';
import { qrDataUrl } from '../remote/qr';
import { NO_DRAG } from '../components/appRegion';
import { usePlanList } from './dashboardQueue';
import { useCopy } from './useCopy';
import { pollWhileVisible } from '../../shared/polling.js';
import { remoteStatusPoll } from '../system/remoteStatus';
import { useNow } from './useNow';

/** How often the checks that live in the main process (displays, the remote server, the lower third server, plan sync) are read again. */
const POLL_MS = 5000;
/** The cloud link check asks the website, so it is read far less often than the local checks. */
const CLOUD_LINK_MS = 60_000;

interface Check {
  key: string;
  icon: LucideIcon;
  label: StringKey;
  /** Null while the first reading is on its way. */
  ok: boolean | null;
  /** Shown, but not counted in the ready tally: an optional system that is not set up, or nothing to check yet. */
  neutral?: boolean;
  detail: string;
  /** The one-click fix beside a check that is not ready. */
  fix?: { label: StringKey; run: () => void };
  /** Small actions that are not fixes (Copy, QR, Identify Screen, Sync). */
  actions?: ReactNode;
}

/** Everything the checks need from the main process, read every few seconds while the dashboard is open. */
function useSystemChecks() {
  const [displays, setDisplays] = useState<number | null>(null);
  const [remote, setRemote] = useState<RemoteViewStatus | null>(null);
  const [lower, setLower] = useState<{ running: boolean; port: number } | null>(null);
  const [plans, setPlans] = useState<PlansSyncState | null>(null);
  const [pwStatuses, setPwStatuses] = useState<string[]>([]);
  const pwSessionId = useLive((s) => s.state.pw?.sessionId ?? null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      bridge.displays.list().then((d) => alive && setDisplays(d.length)).catch(() => alive && setDisplays(0));
      bridge.lowerThird
        .info()
        // An older main process does not report `running`; its server was started, so it counts as running.
        .then((i) => alive && setLower({ running: i.running !== false, port: i.port }))
        .catch(() => alive && setLower({ running: false, port: 0 }));
      bridge.cloud.plansStatus().then((p) => alive && setPlans(p)).catch(() => alive && setPlans(null));
      // The loaded Praise & Worship lineup, read again each time so a prayer assigned in the editor clears its warning here.
      if (pwSessionId == null) setPwStatuses([]);
      else
        bridge.pw
          .getSession(pwSessionId)
          .then((session) => alive && setPwStatuses(session.segments.map((seg) => segmentStatus(seg))))
          .catch(() => alive && setPwStatuses([]));
    };
    const stop = pollWhileVisible(load, POLL_MS);
    return () => {
      alive = false;
      stop();
    };
  }, [pwSessionId]);
  // Shared with the top bar's Remote pill, and read even while the window is hidden (see system/remoteStatus.ts).
  useEffect(() => remoteStatusPoll.subscribe(setRemote), []);
  return { displays, remote, lower, plans, setPlans, pwStatuses };
}

/** The cloud link, read on open and then once a minute (it asks the website). */
function useCloudLink() {
  const [link, setLink] = useState<CloudLink | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => bridge.cloud.status().then((l) => alive && setLink(l)).catch(() => alive && setLink({ linked: false, error: null }));
    const stop = pollWhileVisible(load, CLOUD_LINK_MS);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return [link, setLink] as const;
}

/** A small action button inside a readiness tile. */
const TILE_ACTION =
  'inline-flex shrink-0 items-center gap-1 rounded-md border border-fg/15 bg-panel-2 px-2 py-1 text-xs font-bold text-fg transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-50';
/** A quiet text link, for an action that is a convenience rather than a fix. */
const TILE_LINK = 'shrink-0 text-xs font-semibold text-muted underline-offset-2 hover:text-fg hover:underline';

function useChecks(onQr: (url: string) => void): Check[] {
  const t = useT();
  const { outputs, queue, queuePlanId } = useLive((s) => s.state);
  const pwLoaded = useLive((s) => s.state.pw != null);
  const { displays, remote, lower, plans, setPlans, pwStatuses } = useSystemChecks();
  const [link, setLink] = useCloudLink();
  const { copied, copy } = useCopy();
  const [syncing, setSyncing] = useState(false);
  const now = useNow();

  // Projector: its output is on, and there is a second display for it (on one screen it would cover the console). A status only: Turn On
  // Projector lives on the Congregation Output card and in the top bar, so this row offers Identify Screen instead of a third copy of it.
  const projectorOk = displays === null ? null : outputs.projector && displays >= 2;
  const projector: Check = {
    key: 'projector',
    icon: Monitor,
    label: 'ready.projector',
    ok: projectorOk,
    detail: !outputs.projector ? t('ready.projectorOff') : displays !== null && displays < 2 ? t('ready.oneDisplay') : t('ready.projectorOk'),
    actions: displays !== null && displays > 0 ? (
      <button type="button" className={TILE_LINK} onClick={() => void bridge.displays.identify().catch(() => undefined)}>{t('ready.identify')}</button>
    ) : undefined,
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
  const url = serving ? lanUrl(serving.url, serving.port) : null;
  const remoteCheck: Check = {
    key: 'remote',
    icon: Smartphone,
    label: 'ready.remote',
    ok: remote === null ? null : Boolean(serving),
    detail: serving ? `${t('ready.remoteOk')} ${url ?? ''}` : failing ? failing.error || t('ready.remoteError') : t('ready.remoteOff'),
    fix: remote && !serving ? { label: 'ready.fixRemote', run: () => setUi({ remoteOpen: true }) } : undefined,
    actions: url ? (
      <>
        <button type="button" className={TILE_ACTION} title={t('ready.copyTip')} onClick={() => copy(url)}>
          {copied === url ? <CheckCircle2 size={12} aria-hidden className="text-ok" /> : <Copy size={12} aria-hidden />}
          <span aria-live="polite">{copied === url ? t('ready.copied') : t('ready.copy')}</span>
        </button>
        <button type="button" className={TILE_ACTION} title={t('ready.qrTip')} onClick={() => onQr(url)}>
          <QrCode size={12} aria-hidden /> {t('ready.qr')}
        </button>
      </>
    ) : undefined,
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

  // Content: a queue row whose media or text was deleted, or a Praise & Worship segment still waiting for its prayer or song.
  const massGaps = serviceGaps(queue);
  const gaps = serviceGaps(queue, pwStatuses);
  const nothingLoaded = queue.length === 0 && !pwLoaded;
  const contentCheck: Check = {
    key: 'content',
    icon: FileWarning,
    label: 'ready.content',
    ok: nothingLoaded ? null : gaps.total === 0,
    neutral: nothingLoaded,
    detail: nothingLoaded ? t('ready.contentNone') : gaps.total === 0 ? t('ready.contentOk') : serviceGapsText(gaps),
    fix: !nothingLoaded && gaps.total > 0
      ? { label: 'ready.fixContent', run: () => setUi({ view: massGaps.total === 0 ? 'praiseWorship' : 'goLive' }) }
      : undefined,
  };

  // Cloud Sync is optional: a laptop that is not linked, or whose link is still being read, is not counted against readiness.
  const cloud = cloudSyncReadiness(link, plans, now.getTime());
  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await bridge.cloud.syncNow();
      setPlans(result.plans);
      setLink(await bridge.cloud.status());
    } catch {
      setPlans(await bridge.cloud.plansStatus().catch(() => null));
    } finally {
      setSyncing(false);
    }
  };
  const cloudCheck: Check = {
    key: 'cloud',
    icon: Cloud,
    label: 'ready.cloud',
    ok: link === null ? null : cloud.ok,
    neutral: link === null || !cloud.linked,
    detail: syncing ? t('ready.syncing') : cloud.detail,
    actions: cloud.canSync ? (
      <button type="button" className={TILE_ACTION} disabled={syncing} onClick={() => void syncNow()}>
        <RefreshCw size={12} aria-hidden className={syncing ? 'animate-spin' : undefined} /> {t('ready.cloudSync')}
      </button>
    ) : link && !link.linked ? (
      <button type="button" className={TILE_LINK} onClick={() => setUi({ view: 'settings', settingsSection: 'cloud' })}>{t('ready.cloudSetup')}</button>
    ) : undefined,
  };

  return [projector, lowerThird, remoteCheck, queueCheck, contentCheck, cloudCheck];
}

function CheckRow({ check }: { check: Check }) {
  const t = useT();
  const { icon: Icon } = check;
  const tone = check.ok === null || check.neutral ? 'text-faint' : check.ok ? 'text-ok' : 'text-warn';
  // A settled neutral check (not linked, nothing loaded) shows its detail; only one still being read says Checking.
  const detail = check.ok === null && !check.detail ? t('ready.checking') : check.detail;
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2.5 short:py-1.5">
      <span className={`grid size-8 shrink-0 place-items-center rounded-md bg-fg/[0.06] short:size-7 ${tone}`}>
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-fg short:leading-tight">
          {check.ok === true && !check.neutral && <CheckCircle2 size={14} aria-hidden className="shrink-0 text-ok" />}
          {check.ok === false && <AlertTriangle size={14} aria-hidden className="shrink-0 text-warn" />}
          <span className="truncate">{t(check.label)}</span>
        </div>
        <div className="truncate text-xs text-muted short:leading-tight" title={detail}>{detail}</div>
      </div>
      {(check.actions || check.fix) && (
        <div className="flex shrink-0 items-center gap-1.5">
          {check.actions}
          {check.fix && (
            <button type="button" onClick={check.fix.run}
              className="shrink-0 rounded-md border border-warn/50 bg-warn/10 px-2.5 py-1 text-xs font-bold text-warn transition hover:bg-warn/20">
              {t(check.fix.label)}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** The remote's address as a QR code, drawn on this laptop, for phones on the church Wi-Fi. */
function RemoteQrDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useT();
  const qr = useMemo(() => qrDataUrl(url, 8), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // A portal, so the booth lighting wash and the readiness card's clipping never reach the code a phone has to read.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" style={NO_DRAG} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="remote-qr-title" style={NO_DRAG} onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-line-strong bg-surface p-6 text-center shadow-2xl">
        <header className="flex w-full items-center justify-between gap-3">
          <h2 id="remote-qr-title" className="text-base font-bold text-fg">{t('ready.qrTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('ready.close')}
            className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/20 text-muted hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>
        <img src={qr} alt={`QR code for ${url}`} className="size-64 rounded-md bg-white p-2" />
        <div className="font-mono text-sm font-bold text-fg">{url}</div>
        <p className="text-xs text-muted">{t('ready.qrNote')}</p>
      </div>
    </div>,
    document.body,
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
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-fg/10 hover:text-fg">
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
      <p className="text-[11px] text-faint">{t('count.zoneNote')}</p>
    </div>
  );
}

/** The countdown to the next Mass on the parish's schedule, in the Region time zone, with links to its plan and its readings. */
function Countdown() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const times = useUi((s) => s.massTimes);
  const region = useRegion();
  const now = useNow();
  const plans = usePlanList();
  const [editing, setEditing] = useState(false);
  const next = nextMassStart(now, times, region.timeZone);
  // The scheduled Holy Mass's day in the parish's zone, and the plan made for it (told apart by its time when the day has several).
  const day = next ? isoDayInZone(next.at, region.timeZone) : '';
  const plan = next ? scheduledPlan(plans, day, next.time) : null;

  if (editing) return <MassTimesEditor onDone={() => setEditing(false)} />;
  if (!next) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Clock size={28} strokeWidth={1.5} aria-hidden className="text-faint" />
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
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center short:gap-0.5">
      <div className="text-xs font-semibold tracking-wide text-fg/70 uppercase">{next.label || t('count.title')} · {when}</div>
      {next.started ? (
        <div className="text-2xl font-bold text-ok">{t('count.started')}</div>
      ) : (
        <>
          <div className="text-xs text-muted">{t('count.startsIn')}</div>
          <div className={`font-mono text-4xl leading-none font-bold tabular-nums short:text-3xl ${soon ? 'text-warn' : 'text-fg'}`} aria-live="off">
            {formatCountdown(next.at - now.getTime())}
          </div>
        </>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setEditing(true)} className={TILE_LINK}>
          {t('count.edit')}
        </button>
        {plan && (
          <button type="button" title={t('count.openPlanTip')} className={`${TILE_LINK} inline-flex items-center gap-1`}
            onClick={() => setUi({ view: 'planner', plannerRequest: { kind: 'mass', id: plan.id, date: day } })}>
            <ListOrdered size={12} aria-hidden /> {t('count.openPlan')}
          </button>
        )}
        <button type="button" title={t('count.readingsTip')} className={`${TILE_LINK} inline-flex items-center gap-1`}
          onClick={() => setUi({ view: 'lectionary', pendingFocus: { kind: 'reading', date: day, readingType: 'First Reading' } })}>
          <BookOpen size={12} aria-hidden /> {t('count.readings')}
        </button>
      </div>
    </div>
  );
}

/**
 * Pre-Service Readiness: the sub-systems a Mass needs (the projector display, the lower third engine, the remote server, a loaded plan and
 * its content, and Cloud Sync when the laptop is linked) checked at a glance, with a one-click fix beside any that is not ready, and the
 * countdown to the next Mass.
 */
export function PreServiceWidget() {
  const t = useT();
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const checks = useChecks(setQrUrl);
  // Neutral checks (cloud sync not linked, nothing loaded yet) are shown but not counted.
  const counted = checks.filter((c) => !c.neutral);
  const ready = counted.filter((c) => c.ok === true).length;
  const settled = counted.every((c) => c.ok !== null);
  const allReady = ready === counted.length;
  const badge = allReady
    ? 'border-ok/60 bg-ok/15 text-ok'
    : settled
      ? 'border-warn/60 bg-warn/15 text-warn'
      : 'border-fg/20 bg-fg/5 text-muted';
  return (
    <section aria-labelledby="pre-service-title" className="grid shrink-0 grid-cols-1 overflow-hidden rounded-[10px] border border-fg/[0.12] bg-panel lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-fg/10 px-4 py-2.5 short:min-h-8 short:py-1">
          <h2 id="pre-service-title" className="text-xs font-semibold tracking-wide text-fg/70 uppercase">{t('ready.eyebrow')}</h2>
          <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider uppercase ${badge}`}>
            {allReady ? (
              <><CheckCircle2 size={12} aria-hidden /> {ready}/{counted.length} {t('ready.ready')}</>
            ) : settled ? (
              // Ready count first, then what is left to do: "3/4 Ready · 1 Action".
              <span title={t('ready.actionNeeded')} className="inline-flex items-center gap-1.5">
                <AlertTriangle size={12} aria-hidden /> {ready}/{counted.length} {t('ready.ready')} · {counted.length - ready}{' '}
                {counted.length - ready === 1 ? t('ready.actionOne') : t('ready.actionMany')}
              </span>
            ) : (
              t('ready.checking')
            )}
          </span>
        </header>
        <ul className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 2xl:grid-cols-3 short:gap-1.5 short:p-2">
          {checks.map((c) => <CheckRow key={c.key} check={c} />)}
        </ul>
      </div>
      <div className="min-h-[150px] border-t border-fg/10 p-4 lg:border-t-0 lg:border-l short:min-h-0 short:p-2.5">
        <Countdown />
      </div>
      {qrUrl && <RemoteQrDialog url={qrUrl} onClose={() => setQrUrl(null)} />}
    </section>
  );
}
