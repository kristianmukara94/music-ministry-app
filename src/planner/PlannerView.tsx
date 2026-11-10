import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { CalendarDays, ClipboardList, Lock } from 'lucide-react';
import { monthGrid } from '../../shared/liturgical-calendar.js';
import { DEFAULT_TEMPLATE, readiness } from '../../shared/pw.js';
import { bridge } from '../live/bridge';
import { setUi, useUi } from '../state/ui';
import { useRegion } from '../state/useRegion';
import { PraiseWorship } from '../praise-worship/PraiseWorship';
import { createSession, errorText, flushSave, openSession, readSession, refreshSessions, setPwState, usePw } from '../praise-worship/store';
import { MassPlanner, createMassPlan, templateFor, todayIn } from './MassPlanner';
import { PlannerCalendarView, type CalendarMonth, type PlanKind, type PlanRef, type PwProgress } from './PlannerCalendarView';
import { usePlannerT } from './strings';
import type { DayNotes, PlanSummary } from './types';

const monthOfIso = (iso: string): CalendarMonth => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 });

/**
 * Where the Planner is: on its calendar or in the Plan Editor, and the plan the editor has open. Kept outside the component, so leaving
 * the Planner for another module and coming back finds it where it was. Not persisted: after a restart the editor stays locked until a plan
 * is picked on the calendar.
 */
const usePlannerNav = create<{ mode: 'calendar' | 'editor'; active: PlanRef | null; month: CalendarMonth | null }>(() => ({
  mode: 'calendar',
  active: null,
  month: null,
}));
const setNav = usePlannerNav.setState;

/**
 * The Planner: one place to plan the Holy Mass and Praise & Worship. It opens on the liturgical calendar, which shows both kinds of plan on
 * each day. The Plan Editor tab stays locked until a plan is picked or created there; it then holds the Holy Mass editor (MassPlanner) or the
 * Praise & Worship module (its plan, live console and output templates).
 *
 * A Praise & Worship plan is shown under the 'praiseWorship' view, so the Go Live hub and the console's keys keep reaching it as before;
 * the sidebar marks the Planner for both views.
 */
export function PlannerView() {
  const t = usePlannerT();
  const lang = useUi((s) => s.lang);
  const view = useUi((s) => s.view);
  const pendingMassPlanId = useUi((s) => s.pendingMassPlanId);
  const region = useRegion();
  const today = todayIn(region.timeZone);
  const { mode, active, month: savedMonth } = usePlannerNav();
  const sessions = usePw((s) => s.sessions);
  const pwSessionId = usePw((s) => s.sessionId);
  const pwFocused = usePw((s) => s.isGoLiveFocused);
  const [massPlans, setMassPlans] = useState<PlanSummary[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNotes>({});
  const [pwProgress, setPwProgress] = useState<ReadonlyMap<number, PwProgress>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const showPw = view === 'praiseWorship';
  const showMass = !showPw && mode === 'editor' && active?.kind === 'mass';
  const editorOpen = showPw || showMass;
  const month = savedMonth ?? monthOfIso(today);

  /** Both plan lists, read again so each day's badges are current. */
  const reloadLists = useCallback(() => {
    bridge.plans.list().then(setMassPlans).catch((err) => setError(errorText(err)));
    refreshSessions().catch((err) => setError(errorText(err)));
    bridge.calendar.getDayNotes().then(setDayNotes).catch((err) => setError(errorText(err)));
  }, []);

  /** Sets a day's own title, or with a blank one restores its Ordo name. Rejects with the reason it could not be kept. */
  const saveDayNote = useCallback(async (iso: string, note: string) => {
    const kept = note.trim() ? await bridge.calendar.saveDayNote(iso, note) : (await bridge.calendar.deleteDayNote(iso), null);
    setDayNotes((prev) => {
      const next = { ...prev };
      if (kept) next[iso] = kept;
      else delete next[iso];
      return next;
    });
  }, []);
  useEffect(reloadLists, [reloadLists]);

  // The Go Live hub asks for a Mass plan by id: it opens straight in the editor.
  useEffect(() => {
    if (pendingMassPlanId == null) return;
    setUi({ pendingMassPlanId: null });
    setNav({ mode: 'editor', active: { kind: 'mass', id: pendingMassPlanId } });
  }, [pendingMassPlanId]);

  // Under the 'praiseWorship' view the editor shows the session open in the Praise & Worship module: picked here, by the Go Live hub, or by the
  // module's own session list. Deleting it there returns to the calendar.
  const hadPwSession = useRef(false);
  useEffect(() => {
    if (!showPw) {
      hadPwSession.current = false;
      return;
    }
    if (pwSessionId != null) {
      hadPwSession.current = true;
      setNav({ mode: 'editor', active: { kind: 'pw', id: pwSessionId } });
    } else if (hadPwSession.current) {
      hadPwSession.current = false;
      setNav({ mode: 'calendar', active: null });
      setUi({ view: 'planner' });
    }
  }, [showPw, pwSessionId]);

  // Each Praise & Worship session on the calendar's month: how many of its slots are ready. Read while the calendar shows.
  useEffect(() => {
    if (editorOpen) return;
    const grid = monthGrid(month.year, month.month);
    const first = grid[0][0];
    const last = grid[grid.length - 1][6];
    const shown = sessions.filter((s) => s.liturgicalDate >= first && s.liturgicalDate <= last);
    let cancelled = false;
    Promise.all(
      shown.map((s) =>
        readSession(s.id)
          .then((full) => [s.id, readiness(full.segments)] as const)
          .catch(() => null),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setPwProgress(new Map(pairs.filter((p): p is NonNullable<typeof p> => p !== null).map(([id, r]) => [id, { ready: r.ready, total: r.total }])));
    });
    return () => {
      cancelled = true;
    };
  }, [editorOpen, sessions, month.year, month.month]);

  /** Opens a plan in the Plan Editor: a Mass plan in the Mass editor, a Praise & Worship session in its module, on its Plan tab. */
  const openPlan = async (plan: PlanRef) => {
    setError(null);
    if (plan.kind === 'mass') {
      setNav({ mode: 'editor', active: plan });
      if (view !== 'planner') setUi({ view: 'planner' });
      return;
    }
    try {
      if (usePw.getState().sessionId !== plan.id || !usePw.getState().session) {
        await flushSave();
        await openSession(plan.id);
      }
      setPwState({ tab: 'plan', isGoLiveFocused: false });
      setNav({ mode: 'editor', active: plan });
      setUi({ view: 'praiseWorship' });
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** The calendar's Create a plan: makes the plan for the day, then opens it. A failure is shown in the dialog, which stays open. */
  const createPlan = async (kind: PlanKind, iso: string, name: string) => {
    setError(null);
    if (kind === 'mass') {
      // A Sunday or solemnity starts from Standard Sunday, any other day from Weekday. Opening it fills the day's readings.
      const created = await createMassPlan({ name: name.slice(0, 120), liturgicalDate: iso, template: templateFor(iso) }, lang);
      setMassPlans(await bridge.plans.list());
      await openPlan({ kind: 'mass', id: created.id });
      return;
    }
    // A new session starts from the built-in lineup.
    await flushSave();
    const session = await createSession({ name: name.slice(0, 120), liturgicalDate: iso });
    setPwState({ tab: 'plan', isGoLiveFocused: false });
    setNav({ mode: 'editor', active: { kind: 'pw', id: session.id } });
    setUi({ view: 'praiseWorship' });
  };

  /** Back to the calendar, on the month of the plan that was open. */
  const showCalendar = () => {
    const date =
      active?.kind === 'mass'
        ? massPlans.find((p) => p.id === active.id)?.liturgicalDate
        : active?.kind === 'pw'
          ? (usePw.getState().session?.liturgicalDate ?? sessions.find((s) => s.id === active.id)?.liturgicalDate)
          : undefined;
    if (showPw) void flushSave();
    setNav({ mode: 'calendar', ...(date ? { month: monthOfIso(date) } : {}) });
    if (view !== 'planner') setUi({ view: 'planner' });
    reloadLists();
  };

  const selectedDate =
    active?.kind === 'mass'
      ? (massPlans.find((p) => p.id === active.id)?.liturgicalDate ?? null)
      : active?.kind === 'pw'
        ? (sessions.find((s) => s.id === active.id)?.liturgicalDate ?? null)
        : null;

  const title = showMass ? t('title') : showPw ? t('pwPlanTitle') : t('plannerTitle');
  const subtitle = showMass ? t('subtitle') : t('plannerSubtitle');
  const tab = 'inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold tracking-wide transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

  return (
    <div className="flex flex-1 flex-col">
      {/* The Praise & Worship Go Live focus view takes the workspace, so the Planner's header steps aside for it. */}
      {!(showPw && pwFocused) && (
        // Above the calendar, whose backdrop blur would otherwise paint over the locked tab's tooltip.
        <header className="relative z-20 flex flex-wrap items-end gap-4 px-5 pt-5 pb-1">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-wider text-accent uppercase">{t('plannerEyebrow')}</div>
            <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">{title}</h1>
            <p className="mt-1 text-sm text-fg/70">{subtitle}</p>
          </div>
          <div role="group" aria-label={t('viewSwitch')} className="ml-auto flex rounded-full border border-fg/15 bg-panel-2 p-1 shadow-inner shadow-black/20 backdrop-blur">
            <button
              type="button"
              aria-pressed={!editorOpen}
              onClick={showCalendar}
              className={`${tab} ${!editorOpen ? 'bg-accent text-on-accent shadow' : 'text-fg/80 hover:bg-fg/10 hover:text-fg'}`}
            >
              <CalendarDays size={16} aria-hidden />
              {t('viewCalendar')}
            </button>
            {/* Locked until a plan is picked or created on the calendar. A disabled button takes no pointer events, so its wrapper shows the tooltip. */}
            <span className={`group relative inline-flex ${active ? '' : 'cursor-not-allowed'}`}>
              <button
                type="button"
                disabled={!active}
                aria-pressed={editorOpen}
                aria-describedby={active ? undefined : 'plan-editor-locked'}
                onClick={() => active && void openPlan(active)}
                className={`${tab} disabled:pointer-events-none disabled:opacity-45 ${editorOpen ? 'bg-accent text-on-accent shadow' : 'text-fg/80 hover:bg-fg/10 hover:text-fg'}`}
              >
                {active ? <ClipboardList size={16} aria-hidden /> : <Lock size={15} aria-hidden />}
                {t('viewEditor')}
              </button>
              {!active && (
                <span
                  id="plan-editor-locked"
                  role="tooltip"
                  className="pointer-events-none absolute top-full right-0 z-40 mt-2 w-72 rounded-lg border border-fg/15 bg-panel-2 px-3 py-2 text-sm leading-snug font-medium text-fg opacity-0 shadow-xl shadow-black/40 backdrop-blur transition-opacity duration-150 group-hover:opacity-100"
                >
                  {t('editorLocked')}
                </span>
              )}
            </span>
          </div>
        </header>
      )}

      {error && <div role="alert" className="mx-5 mt-3 rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger">{error}</div>}

      {!editorOpen && (
        <div key="calendar" className="planner-view-in px-5 pt-3 pb-6">
          <PlannerCalendarView
            t={t}
            lang={lang}
            today={today}
            month={month}
            onMonthChange={(next) => setNav({ month: next })}
            selectedDate={selectedDate}
            massPlans={massPlans}
            pwSessions={sessions}
            dayNotes={dayNotes}
            onSaveDayNote={saveDayNote}
            pwProgress={pwProgress}
            pwSlotCount={DEFAULT_TEMPLATE.segments.length}
            onOpen={(plan) => void openPlan(plan)}
            onCreate={createPlan}
          />
        </div>
      )}

      {/* The Mass editor stays mounted behind the calendar while its plan is the open one, so its library search and tab are kept. */}
      {!showPw && active?.kind === 'mass' && (
        <div key="mass-editor" className={showMass ? 'planner-view-in flex flex-1 flex-col pt-3' : 'hidden'}>
          <MassPlanner
            planId={active.id}
            onPlanChange={(id) => {
              if (id == null) {
                setNav({ mode: 'calendar', active: null });
                reloadLists();
              } else {
                setNav({ active: { kind: 'mass', id } });
              }
            }}
            onShowCalendar={showCalendar}
          />
        </div>
      )}

      {showPw && (
        <div key="pw-editor" className="planner-view-in flex flex-1 flex-col">
          <PraiseWorship />
        </div>
      )}
    </div>
  );
}
