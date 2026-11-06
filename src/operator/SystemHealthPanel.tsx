import { useEffect, useState } from 'react';
import { Cpu, Database, ExternalLink, HardDrive, MemoryStick, Play, Wifi, Zap, type LucideIcon } from 'lucide-react';
import { bridge, type SystemHealth } from '../live/bridge';
import { useLive } from '../live/store';
import { useT } from '../i18n/strings';
import { loadMassPlanToQueue } from '../golive/goLive';
import { formatDayAndClock, formatIsoDay } from '../state/region';
import { useRegion } from '../state/useRegion';
import { setUi, useUi } from '../state/ui';
import { runLaunchItem } from './actions';
import { usePlanList } from './dashboardQueue';
import { Panel } from './Panel';

/** CPU is measured between two readings in the main process, so a few seconds apart gives a steady figure. */
const POLL_MS = 3000;
const RECENT_PLANS = 4;

function useSystemHealth() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      bridge.system
        .health()
        .then((h) => {
          if (!alive) return;
          setHealth(h);
          setUnavailable(false);
        })
        .catch(() => alive && setUnavailable(true));
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return { health, unavailable };
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

/** "3 min ago", "5 h ago", "2 d ago". */
function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A small meter under a figure. Amber from 75%, red from 90%. */
function Meter({ percent }: { percent: number | null }) {
  const p = percent ?? 0;
  const color = p >= 90 ? 'bg-danger' : p >= 75 ? 'bg-warn' : 'bg-ok';
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-fg/10" aria-hidden>
      <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${Math.min(100, p)}%` }} />
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, percent, tone }: {
  icon: LucideIcon; label: string; value: string; sub?: string; percent?: number | null; tone?: 'ok' | 'warn';
}) {
  return (
    <div className="min-w-0 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg/60 uppercase">
        <Icon size={12} aria-hidden className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`truncate font-mono text-base leading-tight font-bold tabular-nums ${tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-fg'}`} title={value}>
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-fg/55" title={sub}>{sub}</div>}
      {percent !== undefined && <Meter percent={percent} />}
    </div>
  );
}

function RecentPlans() {
  const t = useT();
  const region = useRegion();
  const plans = usePlanList();
  const loadedId = useLive((s) => s.state.queuePlanId);
  const [busy, setBusy] = useState<number | null>(null);
  // The plans nearest the coming Sunday first: newest liturgical date, then newest made.
  const recent = [...(plans ?? [])]
    .sort((a, b) => b.liturgicalDate.localeCompare(a.liturgicalDate) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_PLANS);

  const resume = async (id: number) => {
    setBusy(id);
    try {
      // Already in the queue: straight to the console, at the place the queue kept. Otherwise it is loaded first.
      if (id === useLive.getState().state.queuePlanId) setUi({ view: 'goLive' });
      else await loadMassPlanToQueue(id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold tracking-wide text-fg/60 uppercase">{t('health.recentPlans')}</div>
      {plans !== null && recent.length === 0 && <div className="text-xs text-fg/55">{t('health.noPlans')}</div>}
      <ul className="flex flex-col gap-1.5">
        {recent.map((plan) => (
          <li key={plan.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-fg" title={plan.name}>{plan.name}</div>
              <div className="text-[11px] text-fg/55">
                {formatIsoDay(plan.liturgicalDate, region)}
                {plan.id === loadedId && <span className="ml-1.5 font-bold text-ok">· {t('health.loaded')}</span>}
              </div>
            </div>
            <button type="button" disabled={busy !== null} onClick={() => void resume(plan.id)}
              className="flex shrink-0 items-center gap-1 rounded-md border border-fg/15 bg-panel-2 px-2.5 py-1 text-xs font-bold text-fg transition hover:bg-fg/10 disabled:opacity-40">
              <Play size={11} aria-hidden /> {t('health.quickResume')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shortcuts pinned on the old Launchpad stay one click away here, so replacing the panel never hides them. */
function PinnedShortcuts() {
  const t = useT();
  const items = useUi((s) => s.launchpad);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold tracking-wide text-fg/60 uppercase">{t('health.shortcuts')}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => runLaunchItem(item)}
            className="flex max-w-full items-center gap-1 truncate rounded-md border border-line-strong bg-canvas px-2 py-1 text-xs font-semibold text-fg/90 hover:border-accent">
            {item.kind === 'open' ? <ExternalLink size={11} className="shrink-0 text-muted" /> : <Zap size={11} className="shrink-0 text-accent" />}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * System Health & Session Resume: the laptop's network address, CPU and memory, the crash-recovery database's last write, the newest
 * automatic database snapshot, and the recent Mass plans with a one-click resume.
 */
export function SystemHealthPanel() {
  const t = useT();
  const region = useRegion();
  const { health, unavailable } = useSystemHealth();

  let metrics;
  if (unavailable && !health) {
    metrics = <p className="text-sm text-fg/60">{t('health.unavailable')}</p>;
  } else {
    const h = health;
    const ramPercent = h ? Math.round((h.memory.usedBytes / Math.max(1, h.memory.totalBytes)) * 100) : null;
    const session = h?.session;
    const wal = !session
      ? '…'
      : !session.enabled
        ? t('health.walOff')
        : session.error
          ? session.error
          : session.lastWriteMs !== null
            ? `${session.lastWriteMs.toFixed(2)} ms`
            : t('health.walIdle');
    const walSub = session?.enabled ? `${(session.journalMode ?? '').toUpperCase()} · ${session.writes} writes` : undefined;
    const backup = h?.latestBackup;
    metrics = (
      <div className="grid grid-cols-2 gap-2">
        <Metric icon={Wifi} label={t('health.ip')} value={h ? h.address ?? t('health.noNetwork') : '…'} tone={h && !h.address ? 'warn' : undefined} />
        <Metric icon={Cpu} label={t('health.cpu')} value={h?.cpuPercent != null ? `${h.cpuPercent}%` : '…'}
          sub={h ? `${t('health.app')} ${h.app.cpuPercent}%` : undefined} percent={h?.cpuPercent ?? null} />
        <Metric icon={MemoryStick} label={t('health.ram')} value={h ? `${ramPercent}%` : '…'}
          sub={h ? `${gb(h.memory.usedBytes)} / ${gb(h.memory.totalBytes)} · ${t('health.app')} ${mb(h.app.memoryBytes)}` : undefined} percent={ramPercent} />
        <Metric icon={Database} label={t('health.wal')} value={wal} sub={walSub}
          tone={session?.error || (session && !session.enabled) ? 'warn' : session?.lastWriteMs != null ? 'ok' : undefined} />
        <div className="col-span-2">
          <Metric icon={HardDrive} label={t('health.backup')}
            value={backup ? formatDayAndClock(new Date(backup.at), region) : h ? t('health.noBackup') : '…'}
            sub={backup ? `${ago(backup.at, h?.at ?? Date.now())} · ${backup.name}` : undefined}
            tone={h && !backup ? 'warn' : undefined} />
        </div>
      </div>
    );
  }

  return (
    <Panel eyebrow={t('health.eyebrow')} title={t('health.title')}>
      <div className="flex flex-col gap-4 p-4">
        {metrics}
        <RecentPlans />
        <PinnedShortcuts />
      </div>
    </Panel>
  );
}
