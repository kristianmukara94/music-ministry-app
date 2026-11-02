import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, HandHeart, ListChecks, Loader2, Play } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { loadPlanToQueue } from '../planner/plan-api';
import type { PlanSummary } from '../planner/types';
import { LiveView } from '../praise-worship/LiveView';
import { goLive } from '../praise-worship/live';
import { flushSave, initPw, openSession, usePw } from '../praise-worship/store';
import type { PwSessionSummary } from '../praise-worship/types';
import { formatIsoDay } from '../state/region';
import { setUi, useUi } from '../state/ui';
import { useRegion } from '../state/useRegion';
import { GoLivePrepare } from './GoLiveHub';
import { MassLiveView } from './MassLiveView';
import { playMassAt, whenLive } from './massLive';
import { onAirLabel, projectorState } from './onAir';
import { useGoLiveT } from './strings';
import { WhiteboardCard } from './WhiteboardCard';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const CARD = 'rounded-[10px] border border-line bg-panel';
const LABEL = 'text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
const SELECT =
  'h-10 min-w-0 rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-50';
const BTN_GO =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-ok bg-ok px-5 text-sm font-extrabold text-canvas shadow-md transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ok/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const TAB = (on: boolean) =>
  `inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold uppercase tracking-wide transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
    on ? 'bg-accent text-on-accent' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
  }`;
const PILL = {
  on: 'border-ok/60 bg-ok/15 text-ok',
  black: 'border-warn/60 bg-warn/15 text-warn',
  off: 'border-fg/20 bg-fg/[0.06] text-fg/60',
} as const;

type Tab = 'pw' | 'mass' | 'prepare';

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The plan or session to offer first: the one for today, else the next one coming, else the most recent. */
function pickDefault<T extends { id: number; liturgicalDate: string }>(list: T[]): number | null {
  const iso = today();
  const todays = list.find((x) => x.liturgicalDate === iso);
  if (todays) return todays.id;
  const upcoming = list.filter((x) => x.liturgicalDate > iso).sort((a, b) => a.liturgicalDate.localeCompare(b.liturgicalDate))[0];
  return upcoming?.id ?? list[0]?.id ?? null;
}

/**
 * Go Live: one console for everything that goes on the projector. Praise & Worship runs its own live screen; the Mass runs from its queue in
 * the same layout. Prepare keeps the date view of saved plans and sessions. Picking or going live never changes a plan's or session's content.
 */
export function GoLiveConsole() {
  const t = useGoLiveT();
  const region = useRegion();
  const live = useLive((s) => s.state);
  const choice = useUi((s) => s.goLiveChoice);
  const loaded = usePw((s) => s.session);
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [sessions, setSessions] = useState<PwSessionSummary[] | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const s = useLive.getState().state;
    if (s.pw?.onAir) return 'pw';
    if (s.queuePlanId != null && s.projector.source === 'MASS_QUEUE') return 'mass';
    return choice?.kind === 'mass' ? 'mass' : 'pw';
  });
  const [pickedPw, setPickedPw] = useState<number | null>(null);
  const [pickedMass, setPickedMass] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The plans and sessions to pick from, read when Go Live opens. The libraries a session's slides need are loaded with them.
  useEffect(() => {
    void initPw();
    Promise.all([bridge.plans.list(), bridge.pw.listSessions()])
      .then(([p, s]) => {
        setPlans(p);
        setSessions(s);
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  // The first choice: what is live or loaded, then the hub's choice, then today's or the next one coming.
  useEffect(() => {
    if (!sessions || pickedPw != null) return;
    const fromState = live.pw?.sessionId ?? loaded?.id ?? (choice?.kind === 'pw' ? choice.id : null);
    setPickedPw(fromState != null && sessions.some((s) => s.id === fromState) ? fromState : pickDefault(sessions));
  }, [sessions]);
  useEffect(() => {
    if (!plans || pickedMass != null) return;
    const fromState = live.queuePlanId ?? (choice?.kind === 'mass' ? choice.id : null);
    setPickedMass(fromState != null && plans.some((p) => p.id === fromState) ? fromState : pickDefault(plans));
  }, [plans]);

  const pwSession = sessions?.find((s) => s.id === pickedPw) ?? null;
  const massPlan = plans?.find((p) => p.id === pickedMass) ?? null;
  const loadedPlan = plans?.find((p) => p.id === live.queuePlanId) ?? null;
  const pwOnAirId = live.pw?.onAir ? live.pw.sessionId : null;

  // A picked session opens straight away, so its live screen is ready to check. One that is on air is never swapped out underneath the operator.
  useEffect(() => {
    if (tab !== 'pw' || pickedPw == null || loaded?.id === pickedPw) return;
    if (pwOnAirId != null && pwOnAirId !== pickedPw) return;
    void (async () => {
      try {
        await flushSave();
        await openSession(pickedPw);
      } catch (err) {
        setError(errorText(err));
      }
    })();
  }, [tab, pickedPw]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Remembers the pick as the hub's choice, on its date, so the Prepare tab shows the same plan or session. */
  const remember = (kind: 'pw' | 'mass', id: number, date: string) => setUi({ goLiveChoice: { kind, id }, goLiveDate: date });

  const goLivePw = () =>
    run(async () => {
      if (!pwSession) return;
      await flushSave();
      if (usePw.getState().session?.id !== pwSession.id) await openSession(pwSession.id);
      // The module's own Go Live: it asks before taking the projector from something else, and asks to turn the projector on.
      goLive();
    });

  const goLiveMass = () =>
    run(async () => {
      if (!massPlan) return;
      const state = useLive.getState().state;
      const other = state.outputs.projector && state.projector.live.kind !== 'idle' && state.projector.source !== 'MASS_QUEUE';
      if (other && !window.confirm(t('confirmReplace', { name: massPlan.name }))) return;
      if (state.queuePlanId !== massPlan.id) {
        await loadPlanToQueue(massPlan.id);
        await whenLive((s) => s.queuePlanId === massPlan.id);
      }
      const now = useLive.getState().state;
      const resume = now.queueCursor >= 0 && !now.queue[now.queueCursor]?.stale ? now.queueCursor : now.queue.findIndex((q) => !q.stale);
      if (resume >= 0) await playMassAt(resume);
    });

  const projector = projectorState(live);
  const onAir = onAirLabel(live.projector.live);
  const pillWord = projector === 'on' ? t('projectorOnPill') : projector === 'black' ? t('projectorBlackPill') : t('projectorOffPill');
  const dateOf = (iso: string) => formatIsoDay(iso, region);

  const pwOptions = useMemo(() => sessions ?? [], [sessions]);
  const massOptions = useMemo(() => plans ?? [], [plans]);

  return (
    <div className="@container/pw flex flex-col gap-5 p-5 pb-10">
      {/* The console bar: what to run, what is picked, and Go live. The same bar as the Praise & Worship module. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t('consoleViews')} className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1">
          <button type="button" aria-current={tab === 'pw' ? 'page' : undefined} onClick={() => setTab('pw')} className={TAB(tab === 'pw')}>
            <HandHeart size={15} aria-hidden /> {t('tabPw')}
          </button>
          <button type="button" aria-current={tab === 'mass' ? 'page' : undefined} onClick={() => setTab('mass')} className={TAB(tab === 'mass')}>
            <ClipboardList size={15} aria-hidden /> {t('tabMass')}
          </button>
          <button type="button" aria-current={tab === 'prepare' ? 'page' : undefined} onClick={() => setTab('prepare')} className={TAB(tab === 'prepare')}>
            <ListChecks size={15} aria-hidden /> {t('tabPrepare')}
          </button>
        </nav>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {/* The projector at a glance. What is on screen is in its tooltip and its label for screen readers. */}
          <span
            className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-xs font-bold tracking-wider uppercase ${PILL[projector]}`}
            role="status"
            title={`${t('onScreen')}: ${onAir ?? t('nothingOnScreen')}`}
            aria-label={`${pillWord}. ${t('onScreen')}: ${onAir ?? t('nothingOnScreen')}`}
          >
            <span aria-hidden className={`size-2 rounded-full ${projector === 'on' ? 'bg-ok' : projector === 'black' ? 'bg-warn' : 'bg-fg/40'}`} />
            {pillWord}
          </span>

          {tab !== 'prepare' && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {tab === 'pw' ? (
              <label className="flex min-w-0 items-center gap-2">
                <span className={`${LABEL} sr-only @5xl/pw:not-sr-only`}>{t('pickSession')}</span>
                <select
                  className={`${SELECT} w-56`}
                  value={pickedPw ?? ''}
                  disabled={busy || pwOptions.length === 0}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setPickedPw(id);
                    const s = pwOptions.find((x) => x.id === id);
                    if (s) remember('pw', id, s.liturgicalDate);
                  }}
                >
                  {pwOptions.length === 0 && <option value="">{t('noSessionsToPick')}</option>}
                  {pwOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {dateOf(s.liturgicalDate)} · {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="flex min-w-0 items-center gap-2">
                <span className={`${LABEL} sr-only @5xl/pw:not-sr-only`}>{t('pickPlan')}</span>
                <select
                  className={`${SELECT} w-56`}
                  value={pickedMass ?? ''}
                  disabled={busy || massOptions.length === 0}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setPickedMass(id);
                    const p = massOptions.find((x) => x.id === id);
                    if (p) remember('mass', id, p.liturgicalDate);
                  }}
                >
                  {massOptions.length === 0 && <option value="">{t('noPlansToPick')}</option>}
                  {massOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {dateOf(p.liturgicalDate)} · {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className={BTN_GO}
              disabled={busy || (tab === 'pw' ? !pwSession : !massPlan)}
              onClick={() => void (tab === 'pw' ? goLivePw() : goLiveMass())}
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden fill="currentColor" />}
              {busy ? t('goLiveBusy') : t('goLive')}
            </button>
          </div>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {tab === 'pw' &&
        (loaded ? (
          <>
            {pwOnAirId != null && pickedPw != null && pwOnAirId !== pickedPw && pwSession && (
              <p role="status" className="rounded-[10px] border border-accent bg-panel-2 px-5 py-3 text-sm">
                {t('massPickedOther', { loaded: sessions?.find((s) => s.id === pwOnAirId)?.name ?? '', picked: pwSession.name })}
              </p>
            )}
            <LiveView />
          </>
        ) : (
          <div className={`${CARD} flex flex-col items-start gap-3 p-6`}>
            <HandHeart size={28} className="text-accent" aria-hidden />
            <h2 className="text-xl font-bold tracking-tight">{t('pwEmptyTitle')}</h2>
            <p className="text-sm text-muted">{t('pwEmptyHint')}</p>
          </div>
        ))}

      {tab === 'mass' && (
        <>
          {loadedPlan && massPlan && loadedPlan.id !== massPlan.id && (
            <p role="status" className="rounded-[10px] border border-accent bg-panel-2 px-5 py-3 text-sm">
              {t('massPickedOther', { loaded: loadedPlan.name, picked: massPlan.name })}
            </p>
          )}
          <MassLiveView planName={loadedPlan?.name ?? null} />
        </>
      )}

      {tab !== 'prepare' && <WhiteboardCard t={t} />}

      {tab === 'prepare' && <GoLivePrepare />}
    </div>
  );
}
