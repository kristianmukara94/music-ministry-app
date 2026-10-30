import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, HandHeart, Plus } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import type { PlanSummary } from '../planner/types';
import type { PwSessionSummary } from '../praise-worship/types';
import { DATE_LOCALES } from '../i18n/strings';
import { useUi, setUi, type GoLiveChoice } from '../state/ui';
import { formatIsoDay, formatIsoWeekday } from '../state/region';
import { useRegion } from '../state/useRegion';
import { setPwState } from '../praise-worship/store';
import { defaultChoice, listForDate, type GoLiveEntry } from '../../shared/golive.js';
import { useGoLiveT, type GoLiveT } from './strings';
import { MassPlanHub } from './MassPlanHub';
import { GoLiveAction } from './GoLiveAction';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// The same surfaces as the dashboard: cards on the panel colour, hairline borders, dark ghost buttons, an accent focus ring.
const CARD = 'rounded-[10px] border border-line bg-panel';
const LABEL = 'text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
const INPUT = 'h-10 rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent/40';
const BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg';

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The date `n` days from an ISO date, as an ISO date. Built from the calendar parts, so a clock change cannot shift it. */
const shiftDay = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoOf(new Date(y, m - 1, d + n));
};

/** The kind label, in the hub's language. */
const kindLabel = (kind: GoLiveEntry['kind'], t: GoLiveT) => (kind === 'mass' ? t('kindMass') : t('kindPw'));
const KindIcon = ({ kind, size = 18 }: { kind: GoLiveEntry['kind']; size?: number }) =>
  kind === 'mass' ? <ClipboardList size={size} aria-hidden /> : <HandHeart size={size} aria-hidden />;

/** A row for one saved entry: a real radio, so the choice works from the keyboard and with screen readers. */
function EntryChoice({ entry, checked, onChoose, t }: { entry: GoLiveEntry; checked: boolean; onChoose: () => void; t: GoLiveT }) {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border-l-[3px] px-3 py-3 transition focus-within:ring-2 focus-within:ring-accent/50 ${
        checked ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5' : 'border-transparent hover:bg-fg/[0.06]'
      }`}
    >
      <input type="radio" name="golive-choice" checked={checked} onChange={onChoose} className="sr-only" />
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${checked ? 'border-accent/40 bg-accent/15 text-accent' : 'border-fg/15 text-fg/60'}`}>
        <KindIcon kind={entry.kind} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`truncate text-[15px] font-semibold ${checked ? 'text-accent' : 'text-fg'}`}>{entry.name}</span>
        <span className="text-[11px] font-semibold tracking-wider text-fg/60 uppercase">{kindLabel(entry.kind, t)}</span>
      </span>
    </label>
  );
}

type Tone = 'ok' | 'warn' | 'danger' | 'idle';
const TONE: Record<Tone, string> = {
  ok: 'border-ok/60 bg-ok/15 text-ok',
  warn: 'border-warn/60 bg-warn/15 text-warn',
  danger: 'border-danger/60 bg-danger/15 text-danger',
  idle: 'border-fg/20 bg-fg/[0.06] text-fg/60',
};

/** One line of the "before you go live" panel: what it is, and whether it is ready. */
function StatusRow({ label, tone, value }: { label: string; tone: Tone; value: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-fg/80">{label}</span>
      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider uppercase ${TONE[tone]}`}>{value}</span>
    </li>
  );
}

/**
 * The Go Live hub: one screen for the saved Mass plans and Praise & Worship sessions of a date. Opening and going live
 * go through the modules that already own them.
 */
export function GoLiveHub() {
  const t = useGoLiveT();
  const lang = useUi((s) => s.lang);
  const region = useRegion();
  const date = useUi((s) => s.goLiveDate);
  const choice = useUi((s) => s.goLiveChoice);
  const projectorOn = useLive((s) => s.state.outputs.projector);
  const projectorKind = useLive((s) => s.state.projector.live.kind);
  const queuePlanId = useLive((s) => s.state.queuePlanId);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [sessions, setSessions] = useState<PwSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Both lists are read once when the hub opens; the planner and Praise & Worship keep them up to date after that.
  useEffect(() => {
    Promise.all([bridge.plans.list(), bridge.pw.listSessions()])
      .then(([p, s]) => {
        setPlans(p);
        setSessions(s);
        setError(null);
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  const entries = useMemo(() => listForDate(date, plans, sessions), [date, plans, sessions]);

  // Keeps the choice valid for the date: when the chosen entry is not on this date, the default for the date is chosen.
  useEffect(() => {
    const kept = choice && entries.some((e) => e.kind === choice.kind && e.id === choice.id);
    if (kept) return;
    const next = defaultChoice(date, entries);
    setUi({ goLiveChoice: next ? { kind: next.kind, id: next.id } : null });
  }, [date, entries, choice]);

  const selected = entries.find((e) => choice && e.kind === choice.kind && e.id === choice.id) ?? null;
  const choose = (entry: GoLiveEntry) => setUi({ goLiveChoice: { kind: entry.kind, id: entry.id } as GoLiveChoice });
  /**
   * Opens the chosen entry in its own module. A Mass plan opens in the Mass planner, which loads it through its plan loader.
   * A Praise & Worship session opens in its module, which restores the session it was set to.
   */
  const open = (entry: GoLiveEntry) => {
    if (entry.kind === 'mass') {
      setUi({ pendingMassPlanId: entry.id, view: 'planner' });
    } else {
      setPwState({ sessionId: entry.id, tab: 'plan', replacing: null });
      setUi({ view: 'praiseWorship' });
    }
  };
  const goToDate = (iso: string) => setUi({ goLiveDate: iso });
  const dateLabel = `${formatIsoWeekday(date, DATE_LOCALES[lang])}, ${formatIsoDay(date, region)}`;

  const projector: { tone: Tone; value: string } = !projectorOn
    ? { tone: 'danger', value: t('statusOff') }
    : projectorKind === 'blackout'
      ? { tone: 'warn', value: t('statusBlackout') }
      : { tone: 'ok', value: t('statusOn') };
  const queue: { tone: Tone; value: string } =
    selected?.kind === 'mass' && queuePlanId === selected.id
      ? { tone: 'ok', value: t('statusLoaded') }
      : queuePlanId != null
        ? { tone: 'warn', value: t('statusOtherPlan') }
        : { tone: 'idle', value: t('statusNotLoaded') };

  return (
    <div className="flex flex-col gap-5 p-5 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wider text-accent uppercase">{t('eyebrow')}</p>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg/70">{t('subtitle')}</p>
        </div>

        {/* The date: step a day at a time, or jump to today. */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t('dateLabel')}</span>
            <input type="date" value={date} onChange={(e) => e.target.value && goToDate(e.target.value)} className={INPUT} />
          </label>
          <button type="button" className={`${BTN} !px-3`} onClick={() => goToDate(shiftDay(date, -1))} aria-label={t('prevDay')} title={t('prevDay')}>
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button type="button" className={`${BTN} !px-3`} onClick={() => goToDate(shiftDay(date, 1))} aria-label={t('nextDay')} title={t('nextDay')}>
            <ChevronRight size={16} aria-hidden />
          </button>
          <button type="button" className={BTN} onClick={() => goToDate(isoOf(new Date()))}>
            <CalendarDays size={15} aria-hidden /> {t('today')}
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
          {t('loadError', { error })}
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <section aria-labelledby="golive-saved" className={`${CARD} flex flex-col gap-3 p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h2 id="golive-saved" className={LABEL}>{t('savedHeading')}</h2>
            <span className="text-xs text-fg/60">{dateLabel}</span>
          </div>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
              <p className="text-sm text-fg/70">{t('emptyDate')}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className={BTN} onClick={() => setUi({ view: 'planner' })}>
                  <Plus size={14} aria-hidden /> {t('createMass')}
                </button>
                <button type="button" className={BTN} onClick={() => setUi({ view: 'praiseWorship' })}>
                  <Plus size={14} aria-hidden /> {t('createPw')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {entries.length > 1 && <p className="text-xs text-fg/60">{t('chooseHint')}</p>}
              <div role="radiogroup" aria-labelledby="golive-saved" className="flex flex-col gap-1">
                {entries.map((entry) => (
                  <EntryChoice
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    checked={selected?.kind === entry.kind && selected?.id === entry.id}
                    onChoose={() => choose(entry)}
                    t={t}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="golive-selected" className={`${CARD} flex min-w-0 flex-col gap-5 p-5`}>
          <h2 id="golive-selected" className="sr-only">{t('selectedHeading')}</h2>
          {selected ? (
            <>
              <div className="flex flex-col gap-2 border-b border-line pb-4">
                <span className="flex w-fit items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">
                  <KindIcon kind={selected.kind} size={12} />
                  {kindLabel(selected.kind, t)}
                </span>
                <h3 className="text-3xl leading-tight font-bold tracking-tight text-fg">{selected.name}</h3>
                <p className="text-sm text-fg/70">
                  {dateLabel}
                  {selected.kind === 'pw' && <> · {t('segments', { n: sessions.find((s) => s.id === selected.id)?.segmentCount ?? 0 })}</>}
                </p>
              </div>

              {/* What to check first: the screen the congregation sees, and the queue the plan is read from. */}
              <div>
                <h4 className={LABEL}>{t('readyHeading')}</h4>
                <ul className="mt-1 divide-y divide-line">
                  <StatusRow label={t('projectorLabel')} tone={projector.tone} value={projector.value} />
                  {selected.kind === 'mass' && <StatusRow label={t('queueLabel')} tone={queue.tone} value={queue.value} />}
                </ul>
              </div>

              <div className="flex flex-wrap items-start gap-2">
                <button type="button" className={BTN} onClick={() => open(selected)}>
                  {t('open')}
                </button>
                <GoLiveAction key={`${selected.kind}-${selected.id}`} entry={selected} t={t} />
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-fg/60">{t('pickDate')}</p>
          )}
        </section>
      </div>

      {selected?.kind === 'mass' && <MassPlanHub planId={selected.id} liturgicalDate={selected.date} />}
    </div>
  );
}
