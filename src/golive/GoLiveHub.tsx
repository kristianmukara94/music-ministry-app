import { useEffect, useMemo, useState } from 'react';
import { bridge } from '../live/bridge';
import type { PlanSummary } from '../planner/types';
import type { PwSessionSummary } from '../praise-worship/types';
import { useUi, setUi, type GoLiveChoice } from '../state/ui';
import { setPwState } from '../praise-worship/store';
import { defaultChoice, listForDate, type GoLiveEntry } from '../../shared/golive.js';
import { useGoLiveT, type GoLiveT } from './strings';
import { MassPlanHub } from './MassPlanHub';
import { GoLiveAction } from './GoLiveAction';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const INPUT = 'h-11 rounded-xl border border-line-strong bg-canvas/40 px-3 text-sm text-fg outline-none focus:border-accent';
const BTN = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:bg-panel-2';

/** The kind label, in the hub's language. */
const kindLabel = (kind: GoLiveEntry['kind'], t: GoLiveT) => (kind === 'mass' ? t('kindMass') : t('kindPw'));

/** A row for one saved entry: a real radio, so the choice works from the keyboard and with screen readers. */
function EntryChoice({ entry, checked, onChoose, t }: { entry: GoLiveEntry; checked: boolean; onChoose: () => void; t: GoLiveT }) {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
        checked ? 'border-accent bg-panel-2' : 'border-line hover:bg-panel-2'
      }`}
    >
      <input
        type="radio"
        name="golive-choice"
        checked={checked}
        onChange={onChoose}
        className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="eyebrow !text-accent">{kindLabel(entry.kind, t)}</span>
        <span className="text-[15px] font-semibold text-fg">{entry.name}</span>
      </span>
    </label>
  );
}

/**
 * The Go Live hub: one screen for the saved Mass plans and Praise & Worship sessions of a date. It only reads them. Opening
 * and going live are added in the next steps, through the modules that already own them.
 */
export function GoLiveHub() {
  const t = useGoLiveT();
  const date = useUi((s) => s.goLiveDate);
  const choice = useUi((s) => s.goLiveChoice);
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
  const today = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setUi({ goLiveDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` });
  };

  return (
    <div className="flex flex-col gap-6 px-5 pb-10">
      <header className="flex flex-col gap-2">
        <p className="eyebrow !text-accent">{t('eyebrow')}</p>
        <h1 className="font-sans condensed text-[56px] leading-none font-black uppercase">{t('title')}</h1>
        <p className="max-w-2xl text-sm text-muted">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">{t('dateLabel')}</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setUi({ goLiveDate: e.target.value })} className={INPUT} />
        </label>
        <button type="button" className={BTN} onClick={today}>
          {t('today')}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger px-4 py-3 text-sm text-danger">
          {t('loadError', { error })}
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <section aria-labelledby="golive-saved" className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
          <h2 id="golive-saved" className="eyebrow">
            {t('savedHeading')}
          </h2>
          {entries.length === 0 ? (
            <p className="text-sm text-muted">{t('emptyDate')}</p>
          ) : (
            <>
              {entries.length > 1 && <p className="text-xs text-muted">{t('chooseHint')}</p>}
              <div role="radiogroup" aria-labelledby="golive-saved" className="flex flex-col gap-2">
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

        <section aria-labelledby="golive-selected" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-panel p-5">
          <h2 id="golive-selected" className="eyebrow">
            {t('selectedHeading')}
          </h2>
          {selected ? (
            <>
              <p className="eyebrow !text-accent">{kindLabel(selected.kind, t)}</p>
              <h3 className="font-sans condensed text-2xl font-black uppercase">{selected.name}</h3>
              <p className="text-sm text-muted">{selected.date}</p>
              {selected.kind === 'pw' && (
                <p className="text-sm text-muted">{t('segments', { n: sessions.find((s) => s.id === selected.id)?.segmentCount ?? 0 })}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <button type="button" className={BTN} onClick={() => open(selected)}>
                  {t('open')}
                </button>
                <GoLiveAction key={`${selected.kind}-${selected.id}`} entry={selected} t={t} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{t('pickDate')}</p>
          )}
        </section>
      </div>

      {selected?.kind === 'mass' && <MassPlanHub planId={selected.id} liturgicalDate={selected.date} />}
    </div>
  );
}
