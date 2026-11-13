import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Church, Guitar, Loader2, PenLine, Plus, RotateCcw, X } from 'lucide-react';
import { calendarDayOf, monthDedicationKey, monthGrid, planStatusOf, requiredSlotsFor, seasonsOfMonth, shortDayName, type LiturgicalColor } from '../../shared/liturgical-calendar.js';
import type { Season } from '../../shared/liturgical-season.js';
import { ordoDay } from '../services/lectionaryService';
import type { PwSessionSummary } from '../praise-worship/types';
import type { PlannerT } from './strings';
import type { DayNotes, PlanSummary } from './types';

/** The two kinds of plan the Planner holds. */
export type PlanKind = 'mass' | 'pw';
/** One saved plan: a Holy Mass plan or a Praise & Worship session. */
export interface PlanRef {
  kind: PlanKind;
  id: number;
}
/** A Praise & Worship session's ready slots, out of its lineup. */
export interface PwProgress {
  ready: number;
  total: number;
}

/** The ribbon, dot and swatch of each liturgical colour. White is drawn as a pale gold with a gold ring, so it reads on every theme. */
const COLOR_SWATCH: Record<LiturgicalColor, string> = {
  green: 'bg-emerald-500',
  violet: 'bg-violet-500',
  white: 'bg-amber-100 ring-1 ring-amber-400/80',
  red: 'bg-red-500',
  rose: 'bg-pink-400',
};
/** The Mass badge's left edge, in the day's liturgical colour. */
const COLOR_EDGE: Record<LiturgicalColor, string> = {
  green: 'border-l-emerald-500',
  violet: 'border-l-violet-500',
  white: 'border-l-amber-200',
  red: 'border-l-red-500',
  rose: 'border-l-pink-400',
};
const COLORS: LiturgicalColor[] = ['green', 'violet', 'white', 'red', 'rose'];

/** A season's badge, in the colour the season wears. */
const SEASON_BADGE: Record<Season, string> = {
  advent: 'border-violet-400/70 bg-violet-500/20',
  christmas: 'border-amber-300/70 bg-amber-200/15',
  'ordinary-time': 'border-emerald-400/70 bg-emerald-500/20',
  lent: 'border-violet-400/70 bg-violet-500/20',
  'holy-week': 'border-red-400/70 bg-red-500/20',
  easter: 'border-amber-300/70 bg-amber-200/15',
  pentecost: 'border-red-400/70 bg-red-500/20',
};
const SEASON_DOT: Record<Season, LiturgicalColor> = {
  advent: 'violet',
  christmas: 'white',
  'ordinary-time': 'green',
  lent: 'violet',
  'holy-week': 'red',
  easter: 'white',
  pentecost: 'red',
};

/** Month and weekday names follow the app language; a language the browser has no names for falls back to English. */
const LOCALE: Record<string, string> = { en: 'en-US', tl: 'fil-PH', ceb: 'ceb-PH' };
/** Badges shown in one day's cell; the rest are counted as "+n more" and listed by the day's popover. */
const MAX_BADGES = 3;
/** The longest day title: the main process keeps no more (MAX_DAY_NOTE in electron/calendar-notes.js). */
const MAX_NOTE = 120;

/**
 * A day title's size and clamp, by its length: the longer the title, the smaller its type and the more lines it may take, so a title of
 * up to MAX_NOTE characters stays inside the cell's body and never pushes the badges out. The cell's tooltip carries the whole title.
 */
function dayTitleFit(length: number): string {
  if (length > 50) return 'text-[10px] leading-[1.15] line-clamp-3';
  if (length > 30) return 'text-[11px] leading-tight line-clamp-2';
  return 'text-xs leading-tight line-clamp-2';
}

// The calendar's own surface: the colours are set on .planner-cal in styles.css (dark glass, or light on a light theme).
const SURFACE = 'bg-[var(--cal-surface)]';
const TEXT = 'text-[var(--cal-text)]';
const MUTED = 'text-[var(--cal-muted)]';
const GOLD = 'text-[var(--cal-gold)]';
const ROUND_BTN = `grid size-10 place-items-center rounded-full border border-[var(--cal-border-hover)] ${TEXT} transition hover:border-[var(--cal-gold)] hover:text-[var(--cal-gold)] focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none`;

export interface CalendarMonth {
  year: number;
  /** 0 for January. */
  month: number;
}

interface DayPlan extends PlanRef {
  name: string;
}

interface Props {
  t: PlannerT;
  lang: 'en' | 'tl' | 'ceb';
  /** Today, as "YYYY-MM-DD" in the parish's region. */
  today: string;
  month: CalendarMonth;
  onMonthChange: (month: CalendarMonth) => void;
  /** The day of the plan the Planner has open: marked in the grid. */
  selectedDate: string | null;
  massPlans: PlanSummary[];
  pwSessions: PwSessionSummary[];
  /** The parish's own day titles ("Youth Sunday"), shown in place of the Ordo name. A day without one shows its Ordo name. */
  dayNotes: DayNotes;
  /** Sets a day's own title; a blank one restores its Ordo name. Rejects with the reason it could not be kept. */
  onSaveDayNote: (iso: string, note: string) => Promise<void>;
  /** Each Praise & Worship session's ready slots, once read. */
  pwProgress: ReadonlyMap<number, PwProgress>;
  /** Slots in the built-in Praise & Worship lineup a new session starts from. */
  pwSlotCount: number;
  /** A plan was picked: open it in the Plan Editor. */
  onOpen: (plan: PlanRef) => void;
  /** Create a plan of this kind for the day, then open it. Rejects with the reason it could not be made. */
  onCreate: (kind: PlanKind, iso: string, name: string) => Promise<void>;
}

/**
 * The Planner's landing view: a month of the liturgical calendar, Sunday to Saturday, under a banner naming the month's devotion and the
 * seasons it falls in. Each day shows its Ordo name, its liturgical colour as a ribbon and its rank, and a badge for each Holy Mass plan and
 * Praise & Worship session saved for it. Picking a day with one plan opens it; a day with several asks which; a day with none offers to
 * create a Holy Mass or a Praise & Worship plan.
 */
export function PlannerCalendarView({ t, lang, today, month, onMonthChange, selectedDate, massPlans, pwSessions, dayNotes, onSaveDayNote, pwProgress, pwSlotCount, onOpen, onCreate }: Props) {
  const locale = LOCALE[lang] ?? 'en-US';
  const weeks = useMemo(() => monthGrid(month.year, month.month), [month.year, month.month]);
  const seasons = useMemo(() => seasonsOfMonth(month.year, month.month), [month.year, month.month]);
  // Each shown day's colour, rank and Ordo name, worked out once per month.
  const days = useMemo(
    () => new Map(weeks.flat().map((iso) => [iso, { ...calendarDayOf(iso), name: ordoDay(iso).name, required: requiredSlotsFor(iso) }])),
    [weeks],
  );
  const massByDate = useMemo(() => groupByDate(massPlans), [massPlans]);
  const pwByDate = useMemo(() => groupByDate(pwSessions), [pwSessions]);
  const plansOn = (iso: string): DayPlan[] => [
    ...(massByDate.get(iso) ?? []).map((p) => ({ kind: 'mass' as const, id: p.id, name: p.name })),
    ...(pwByDate.get(iso) ?? []).map((s) => ({ kind: 'pw' as const, id: s.id, name: s.name })),
  ];

  // The day whose plans are listed in the popover, and where it opens.
  const [popover, setPopover] = useState<{ iso: string; top: number; left: number } | null>(null);
  // The day the Create a plan dialog is open for.
  const [createFor, setCreateFor] = useState<string | null>(null);
  // The day whose own title is being edited.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  /** The parish's own title for the day, or null when it shows its Ordo name. */
  const customNoteOf = (iso: string) => {
    const note = dayNotes[iso];
    return note && note.trim() !== '' ? note : null;
  };

  const monthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(month.year, month.month, 1));
  const weekdayNames = weeks[0].map((iso) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(`${iso}T12:00:00`)));
  const weekdayLong = weeks[0].map((iso) => new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${iso}T12:00:00`)));
  const longDate = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${iso}T12:00:00`));
  const shift = (delta: number) => {
    const next = new Date(month.year, month.month + delta, 1);
    onMonthChange({ year: next.getFullYear(), month: next.getMonth() });
  };
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const onTodayMonth = month.year === todayYear && month.month === todayMonth - 1;

  /** A day's cell: its one plan opens; several are offered in a popover by the cell; none opens Create a plan. */
  const pickDay = (iso: string, cell: HTMLElement) => {
    const onDay = plansOn(iso);
    if (onDay.length === 0) {
      setCreateFor(iso);
      return;
    }
    if (onDay.length === 1) {
      onOpen(onDay[0]);
      return;
    }
    const box = cell.getBoundingClientRect();
    const width = 288;
    // Below the day's number, kept inside the window.
    setPopover({ iso, top: Math.max(8, Math.min(box.top + 40, window.innerHeight - 300)), left: Math.max(8, Math.min(box.left + 8, window.innerWidth - width - 8)) });
  };

  /** The Mass badge: ready (every slot the day needs is filled) or how many of them are filled, edged in the day's colour. */
  const massBadge = (iso: string, plan: PlanSummary) => {
    const day = days.get(iso)!;
    const filled = new Set(plan.filledSlots ?? []);
    const done = day.required.filter((id) => filled.has(id)).length;
    const ready = planStatusOf(iso, plan.filledSlots) === 'ready';
    return (
      <button
        key={`mass:${plan.id}`}
        type="button"
        onClick={() => onOpen({ kind: 'mass', id: plan.id })}
        aria-label={`${t('calOpenMass')}: ${plan.name}`}
        title={plan.name}
        className={`pointer-events-auto z-10 flex min-w-0 items-center gap-1.5 rounded-md border border-l-[3px] px-1.5 py-1 text-left text-[11px] font-bold transition focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none ${COLOR_EDGE[day.color]} ${
          ready ? 'border-ok/60 bg-ok/15 text-ok hover:bg-ok/25' : `border-[var(--cal-border-hover)] bg-[var(--cal-badge)] ${TEXT} hover:border-[var(--cal-gold)]`
        }`}
      >
        {ready ? <Check size={12} strokeWidth={3} className="shrink-0" aria-hidden /> : <Church size={12} className="shrink-0" aria-hidden />}
        <span className="truncate">{ready ? t('calMassReady') : t('calBadgeMass')}</span>
        {!ready && <span className="ml-auto shrink-0 font-mono tabular-nums opacity-90">{done}/{day.required.length}</span>}
      </button>
    );
  };

  /** The Praise & Worship badge, in amber: ready, or how many of its slots are ready. */
  const pwBadge = (session: PwSessionSummary) => {
    const progress = pwProgress.get(session.id);
    const ready = progress !== undefined && progress.total > 0 && progress.ready === progress.total;
    return (
      <button
        key={`pw:${session.id}`}
        type="button"
        onClick={() => onOpen({ kind: 'pw', id: session.id })}
        aria-label={`${t('calOpenPw')}: ${session.name}`}
        title={session.name}
        className={`pointer-events-auto z-10 flex min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] font-bold transition focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none ${
          ready ? 'border-ok/60 bg-ok/15 text-ok hover:bg-ok/25' : `border-[var(--cal-gold)]/60 bg-[var(--cal-gold)]/15 ${GOLD} hover:bg-[var(--cal-gold)]/25`
        }`}
      >
        {ready ? <Check size={12} strokeWidth={3} className="shrink-0" aria-hidden /> : <Guitar size={12} className="shrink-0" aria-hidden />}
        <span className="truncate">{ready ? t('calPwReady') : t('calBadgePw')}</span>
        {!ready && (
          <span className="ml-auto shrink-0 font-mono tabular-nums opacity-90">
            {progress ? `${progress.ready}/${progress.total}` : session.segmentCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <section aria-labelledby="planner-calendar-title" className={`planner-cal overflow-hidden rounded-[14px] border border-[var(--cal-border)] ${SURFACE} shadow-xl shadow-black/30 backdrop-blur-md`}>
      {/* ── Banner: the month, its devotion and its seasons ── */}
      <div className="relative border-b border-[var(--cal-border)] bg-gradient-to-br from-[var(--cal-gold)]/15 via-[var(--cal-gold)]/5 to-transparent px-5 pt-4 pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => shift(-1)} aria-label={t('calPrev')} title={t('calPrev')} className={ROUND_BTN}>
              <ChevronLeft size={20} aria-hidden />
            </button>
            <h2 id="planner-calendar-title" aria-live="polite" className="min-w-[13ch] px-2 text-center font-serif text-3xl leading-none font-bold tracking-tight text-[var(--cal-date)] capitalize xl:text-4xl">
              {monthName} <span className={GOLD}>{month.year}</span>
            </h2>
            <button type="button" onClick={() => shift(1)} aria-label={t('calNext')} title={t('calNext')} className={ROUND_BTN}>
              <ChevronRight size={20} aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onMonthChange({ year: todayYear, month: todayMonth - 1 })}
            disabled={onTodayMonth}
            className={`inline-flex h-10 items-center gap-1.5 rounded-full border border-[var(--cal-gold)]/70 bg-[var(--cal-gold)]/15 px-4 text-xs font-extrabold tracking-wider uppercase ${GOLD} transition hover:bg-[var(--cal-gold)]/25 disabled:opacity-40`}
          >
            <CalendarDays size={15} aria-hidden />
            {t('calToday')}
          </button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {seasons.map((season) => (
              <span key={season} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-extrabold tracking-wider uppercase ${TEXT} ${SEASON_BADGE[season]}`}>
                <span aria-hidden className={`size-2.5 rounded-full ${COLOR_SWATCH[SEASON_DOT[season]]}`} />
                {t(`calSeason_${season}`)}
              </span>
            ))}
          </div>
        </div>
        <p className={`mt-3 font-serif text-xl italic xl:text-2xl ${TEXT}`}>{t(monthDedicationKey(month.month))}</p>
        <p className={`mt-1 text-sm ${MUTED}`}>{t('calHint')}</p>
      </div>

      {/* ── The month ── */}
      <div className="overflow-x-auto">
        <div role="grid" aria-labelledby="planner-calendar-title" className="min-w-[56rem] p-3">
          <div role="row" className="grid grid-cols-7 gap-1.5 pb-1.5">
            {weekdayNames.map((name, i) => (
              <div key={name} role="columnheader" aria-label={weekdayLong[i]} className={`px-2 text-xs font-extrabold tracking-widest uppercase ${i === 0 ? GOLD : MUTED}`}>
                {name}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {weeks.map((week) => (
              <div key={week[0]} role="row" className="grid grid-cols-7 gap-1.5">
                {week.map((iso) => {
                  const day = days.get(iso)!;
                  const massOnDay = massByDate.get(iso) ?? [];
                  const pwOnDay = pwByDate.get(iso) ?? [];
                  const count = massOnDay.length + pwOnDay.length;
                  const badges = [...massOnDay.map((p) => massBadge(iso, p)), ...pwOnDay.map(pwBadge)];
                  const inMonth = Number(iso.slice(5, 7)) - 1 === month.month;
                  const isToday = iso === today;
                  const selected = iso === selectedDate;
                  const festive = day.rank !== 'weekday';
                  // The parish's own title replaces the Ordo name in the cell; the Ordo name stays in the tooltip and the label.
                  const defaultOrdoTitle = day.rank === 'weekday' ? shortDayName(day.name) : day.name;
                  const customNote = customNoteOf(iso);
                  const isOverridden = customNote !== null;
                  const displayTitle = customNote ?? defaultOrdoTitle;
                  const dayLabel = isOverridden ? `${customNote} (${t('calNoteOrdo', { name: day.name })})` : day.name;
                  // The hover tooltip carries the whole title, however the cell clamps it, and the Ordo name under a parish title.
                  const dayTooltip = isOverridden ? `${customNote}\n${t('calNoteOrdo', { name: day.name })}` : day.name;
                  const planNames = plansOn(iso).map((p) => p.name).join(', ');
                  return (
                    <div
                      key={iso}
                      role="gridcell"
                      aria-selected={selected}
                      className={`group relative flex min-h-[10rem] flex-col overflow-hidden rounded-lg border transition ${
                        selected
                          ? 'border-[var(--cal-gold)] bg-[var(--cal-gold)]/10 ring-1 ring-[var(--cal-gold)]'
                          : 'border-[var(--cal-border)] bg-[var(--cal-cell)] hover:border-[var(--cal-border-hover)] hover:bg-[var(--cal-cell-hover)]'
                      } ${inMonth ? '' : 'opacity-40'}`}
                    >
                      {/* The whole cell picks the day; the badges and the create button sit above it as their own buttons. */}
                      <button
                        type="button"
                        onClick={(e) => pickDay(iso, e.currentTarget)}
                        aria-haspopup={count > 1 ? 'menu' : count === 0 ? 'dialog' : undefined}
                        aria-label={`${longDate(iso)}: ${dayLabel}. ${t(`color_${day.color}`)}. ${count === 0 ? t('calNoPlan') : planNames}`}
                        title={dayTooltip}
                        className="absolute inset-0 z-0 rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none"
                      />
                      {/* The liturgical colour: a bold ribbon down the cell's left edge. */}
                      <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${COLOR_SWATCH[day.color]}`} />
                      {/* Header: the date, the rank and the edit pencil. Body: the title, clamped. Footer: the badges, pinned to the cell's foot. */}
                      <div className="pointer-events-none relative flex flex-none items-start gap-1.5 pt-2 pr-2 pl-3">
                        <span
                          className={`grid size-8 shrink-0 place-items-center rounded-full font-mono text-lg leading-none font-black tabular-nums ${
                            isToday
                              ? 'bg-[var(--cal-gold)] text-[var(--cal-on-gold)] shadow-[0_0_12px_var(--cal-gold)]'
                              : day.rank === 'sunday' || day.rank === 'solemnity'
                                ? GOLD
                                : 'text-[var(--cal-date)]'
                          }`}
                        >
                          {Number(iso.slice(8))}
                        </span>
                        <div className="mt-1 ml-auto flex min-w-0 items-center gap-1">
                          {(day.rank === 'solemnity' || day.rank === 'feast') && (
                            <span
                              className={`truncate rounded-full border px-2 py-0.5 text-[10px] font-extrabold tracking-wider uppercase ${
                                day.rank === 'solemnity'
                                  ? `border-[var(--cal-gold)]/70 bg-[var(--cal-gold)]/20 ${GOLD}`
                                  : `border-[var(--cal-border-hover)] bg-[var(--cal-badge)] ${TEXT}`
                              }`}
                            >
                              {t(`calRank_${day.rank}`)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setNoteFor(iso)}
                            aria-haspopup="dialog"
                            aria-label={`${t('calNoteEdit')}: ${longDate(iso)}`}
                            title={t('calNoteEdit')}
                            className={`pointer-events-auto z-10 grid size-6 shrink-0 place-items-center rounded-full border transition hover:border-[var(--cal-gold)] hover:text-[var(--cal-gold)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none ${
                              isOverridden
                                ? `border-[var(--cal-gold)]/70 bg-[var(--cal-gold)]/15 ${GOLD}`
                                : `border-[var(--cal-border-hover)] ${TEXT} opacity-0 group-focus-within:opacity-100 group-hover:opacity-100`
                            }`}
                          >
                            <PenLine size={12} aria-hidden />
                          </button>
                        </div>
                      </div>
                      <div className="pointer-events-none relative min-h-0 flex-1 overflow-hidden px-3 pt-1">
                        <p
                          className={`text-left break-words whitespace-normal [overflow-wrap:anywhere] ${dayTitleFit(displayTitle.length)} ${
                            isOverridden ? `font-bold ${GOLD}` : festive ? `font-bold ${TEXT}` : `font-medium ${MUTED}`
                          }`}
                        >
                          {isOverridden && <span className="sr-only">{t('calNoteCustom')}: </span>}
                          {displayTitle}
                        </p>
                      </div>
                      <div className="pointer-events-none relative mt-auto flex flex-none flex-col gap-1 p-1.5 pl-2.5">
                        {badges.slice(0, MAX_BADGES)}
                        {count > MAX_BADGES && <span className={`px-1 text-[11px] font-bold ${MUTED}`}>{t('calMore', { n: count - MAX_BADGES })}</span>}
                        <button
                          type="button"
                          onClick={() => setCreateFor(iso)}
                          aria-label={t('calCreateFor', { date: longDate(iso) })}
                          className={`pointer-events-auto z-10 inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-[var(--cal-gold)]/70 px-1.5 py-1 text-[11px] font-extrabold tracking-wide uppercase ${GOLD} transition hover:border-solid hover:bg-[var(--cal-gold)] hover:text-[var(--cal-on-gold)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none ${
                            count === 0 && selected ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                          }`}
                        >
                          <Plus size={12} strokeWidth={3} aria-hidden />
                          {t('calCreatePlan')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--cal-border)] px-5 py-3 text-xs ${TEXT}`}>
        <span className={`font-extrabold tracking-wider uppercase ${MUTED}`}>{t('calLegend')}</span>
        {COLORS.map((color) => (
          <span key={color} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-3.5 w-1 rounded-sm ${COLOR_SWATCH[color]}`} />
            {t(`color_${color}`)}
          </span>
        ))}
        <span className="ml-auto inline-flex flex-wrap items-center gap-3 font-semibold">
          <span className="inline-flex items-center gap-1"><Church size={13} aria-hidden /> {t('calBadgeMass')}</span>
          <span className={`inline-flex items-center gap-1 ${GOLD}`}><Guitar size={13} aria-hidden /> {t('calBadgePw')}</span>
          <span className="inline-flex items-center gap-1 text-ok"><Check size={13} strokeWidth={3} aria-hidden /> {t('calReady')}</span>
        </span>
      </div>

      {/* The popover and the dialog go to the body: the calendar's backdrop blur would otherwise make it their frame, not the window. */}
      {popover && createPortal(
        <DayPlansPopover
          t={t}
          title={t('calPickTitle', { date: longDate(popover.iso) })}
          plans={plansOn(popover.iso)}
          top={popover.top}
          left={popover.left}
          onOpen={(plan) => {
            setPopover(null);
            onOpen(plan);
          }}
          onCreate={() => {
            setCreateFor(popover.iso);
            setPopover(null);
          }}
          onClose={() => setPopover(null)}
        />,
        document.body,
      )}

      {createFor && createPortal(
        <CreatePlanDialog
          key={createFor}
          t={t}
          dateLabel={longDate(createFor)}
          ordoName={days.get(createFor)?.name ?? ordoDay(createFor).name}
          suggestedName={customNoteOf(createFor) ?? days.get(createFor)?.name ?? ordoDay(createFor).name}
          color={(days.get(createFor) ?? calendarDayOf(createFor)).color}
          pwSlotCount={pwSlotCount}
          onCreate={(kind, name) => onCreate(kind, createFor, name)}
          onClose={() => setCreateFor(null)}
        />,
        document.body,
      )}

      {noteFor && createPortal(
        <DayNoteDialog
          key={noteFor}
          t={t}
          dateLabel={longDate(noteFor)}
          ordoName={days.get(noteFor)?.name ?? ordoDay(noteFor).name}
          current={customNoteOf(noteFor)}
          color={(days.get(noteFor) ?? calendarDayOf(noteFor)).color}
          onSave={(note) => onSaveDayNote(noteFor, note)}
          onClose={() => setNoteFor(null)}
        />,
        document.body,
      )}
    </section>
  );
}

function groupByDate<T extends { liturgicalDate: string }>(rows: T[]) {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(row.liturgicalDate, [...(out.get(row.liturgicalDate) ?? []), row]);
  return out;
}

/** Closes on Escape and on a press outside `ref`. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, outside = true) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (outside && ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [ref, onClose, outside]);
}

/** A day with more than one plan: which to open, or make another. */
function DayPlansPopover({ t, title, plans, top, left, onOpen, onCreate, onClose }: {
  t: PlannerT; title: string; plans: DayPlan[]; top: number; left: number;
  onOpen: (plan: PlanRef) => void; onCreate: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), []);
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none';
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      style={{ top, left }}
      className={`planner-cal fixed z-50 w-72 rounded-xl border border-[var(--cal-border-hover)] ${SURFACE} p-1.5 shadow-2xl shadow-black/50`}
    >
      <p className={`px-3 pt-1.5 pb-2 text-[11px] font-extrabold tracking-wider uppercase ${MUTED}`}>{title}</p>
      {plans.map((plan) => (
        <button key={`${plan.kind}:${plan.id}`} type="button" role="menuitem" onClick={() => onOpen(plan)}
          className={`${item} ${plan.kind === 'pw' ? GOLD : TEXT} hover:bg-[var(--cal-cell-hover)]`}>
          {plan.kind === 'mass' ? <Church size={16} className="shrink-0" aria-hidden /> : <Guitar size={16} className="shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block">{plan.kind === 'mass' ? t('calOpenMass') : t('calOpenPw')}</span>
            <span className={`block truncate text-xs font-medium ${MUTED}`}>{plan.name}</span>
          </span>
        </button>
      ))}
      <div className="my-1 h-px bg-[var(--cal-border-hover)]" aria-hidden />
      <button type="button" role="menuitem" onClick={onCreate} className={`${item} ${GOLD} hover:bg-[var(--cal-gold)]/15`}>
        <Plus size={16} className="shrink-0" aria-hidden /> {t('calAddPlan')}
      </button>
    </div>
  );
}

/** Create a plan for a day: a Holy Mass plan (its four parts, with the day's readings) or a Praise & Worship session (the built-in lineup). */
function CreatePlanDialog({ t, dateLabel, ordoName, suggestedName, color, pwSlotCount, onCreate, onClose }: {
  t: PlannerT; dateLabel: string; ordoName: string; suggestedName: string; color: LiturgicalColor; pwSlotCount: number;
  onCreate: (kind: PlanKind, name: string) => Promise<void>; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The plan is named after the day's own title when it has one, else its Ordo name.
  const [name, setName] = useState(suggestedName.slice(0, 120));
  const [busy, setBusy] = useState<PlanKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  // While a plan is being made, Escape and a click outside do nothing: the dialog closes when the editor opens.
  useDismiss(panel, () => {
    if (!busy) onClose();
  });

  const create = async (kind: PlanKind) => {
    if (busy || !name.trim()) return;
    setBusy(kind);
    setError(null);
    try {
      await onCreate(kind, name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
      setBusy(null);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void create('mass');
  };

  const option = 'flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none disabled:cursor-wait disabled:opacity-60';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-plan-title"
        className={`planner-cal relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--cal-border-hover)] ${SURFACE} shadow-2xl shadow-black/60`}
      >
        <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${COLOR_SWATCH[color]}`} />
        <form onSubmit={submit} className="flex flex-col gap-4 p-6 pl-7">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-extrabold tracking-wider uppercase ${GOLD}`}>{t('createTitle')}</p>
              <h2 id="create-plan-title" className="mt-1 text-2xl leading-tight font-extrabold text-[var(--cal-date)]">{dateLabel}</h2>
              <p className={`mt-1 font-serif text-base italic ${TEXT}`}>{ordoName}</p>
            </div>
            <button type="button" onClick={onClose} disabled={busy !== null} aria-label={t('cancel')} title={t('cancel')} className={`${ROUND_BTN} size-9 shrink-0`}>
              <X size={18} aria-hidden />
            </button>
          </div>

          <label className={`flex flex-col gap-1.5 text-xs font-bold tracking-wide uppercase ${MUTED}`}>
            {t('createName')}
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`h-11 rounded-lg border border-[var(--cal-border-hover)] bg-[var(--cal-cell)] px-3 text-base font-semibold normal-case tracking-normal ${TEXT} outline-none focus:border-[var(--cal-gold)] focus:ring-1 focus:ring-[var(--cal-gold)]`}
            />
          </label>

          <div className="flex flex-col gap-2.5">
            <button type="submit" disabled={busy !== null || !name.trim()} className={`${option} border-[var(--cal-border-hover)] bg-[var(--cal-cell)] hover:border-[var(--cal-date)]`}>
              <span className={`grid size-11 shrink-0 place-items-center rounded-lg border-l-4 bg-[var(--cal-badge)] ${COLOR_EDGE[color]} ${TEXT}`}>
                {busy === 'mass' ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Church size={20} aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-extrabold text-[var(--cal-date)]">{busy === 'mass' ? t('createBusy') : t('calCreate')}</span>
                <span className={`mt-0.5 block text-sm ${MUTED}`}>{t('createMassSub')}</span>
              </span>
            </button>
            <button type="button" onClick={() => void create('pw')} disabled={busy !== null || !name.trim()} className={`${option} border-[var(--cal-gold)]/50 bg-[var(--cal-gold)]/10 hover:border-[var(--cal-gold)]`}>
              <span className={`grid size-11 shrink-0 place-items-center rounded-lg bg-[var(--cal-gold)]/20 ${GOLD}`}>
                {busy === 'pw' ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Guitar size={20} aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className={`block text-base font-extrabold ${GOLD}`}>{busy === 'pw' ? t('createBusy') : t('createPw')}</span>
                <span className={`mt-0.5 block text-sm ${MUTED}`}>{t('createPwSub', { n: pwSlotCount })}</span>
              </span>
            </button>
          </div>

          {error && <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </form>
      </div>
    </div>
  );
}

/** A day's own title: shown on the calendar in place of its Ordo name. Saving a blank title, or Restore, shows the Ordo name again. */
function DayNoteDialog({ t, dateLabel, ordoName, current, color, onSave, onClose }: {
  t: PlannerT; dateLabel: string; ordoName: string; current: string | null; color: LiturgicalColor;
  onSave: (note: string) => Promise<void>; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDismiss(panel, () => {
    if (!busy) onClose();
  });

  const save = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(note);
  };

  const button = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-extrabold transition focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none disabled:cursor-wait disabled:opacity-60';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-note-title"
        className={`planner-cal relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--cal-border-hover)] ${SURFACE} shadow-2xl shadow-black/60`}
      >
        <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${COLOR_SWATCH[color]}`} />
        <form onSubmit={submit} className="flex flex-col gap-4 p-6 pl-7">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-extrabold tracking-wider uppercase ${GOLD}`}>{t('calNoteTitle')}</p>
              <h2 id="day-note-title" className="mt-1 text-2xl leading-tight font-extrabold text-[var(--cal-date)]">{dateLabel}</h2>
              <p className={`mt-1 font-serif text-base italic ${TEXT}`}>{t('calNoteOrdo', { name: ordoName })}</p>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label={t('cancel')} title={t('cancel')} className={`${ROUND_BTN} size-9 shrink-0`}>
              <X size={18} aria-hidden />
            </button>
          </div>

          <label className={`flex flex-col gap-1.5 text-xs font-bold tracking-wide uppercase ${MUTED}`}>
            {t('calNoteLabel')}
            {/* A wrapping box so a long title can be read whole while it is written. The title is kept as one line (the main process
                folds line breaks too), so Enter saves and pasted line breaks become spaces. */}
            <textarea
              autoFocus
              rows={3}
              maxLength={MAX_NOTE}
              value={note}
              placeholder={t('calNotePlaceholder')}
              onChange={(e) => setNote(e.target.value.replace(/[\r\n]+/g, ' '))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className={`resize-none rounded-lg border border-[var(--cal-border-hover)] bg-[var(--cal-cell)] px-3 py-2.5 text-base leading-snug font-semibold normal-case tracking-normal break-words whitespace-normal [overflow-wrap:anywhere] ${TEXT} outline-none focus:border-[var(--cal-gold)] focus:ring-1 focus:ring-[var(--cal-gold)]`}
            />
            <span className="flex items-baseline gap-3 text-xs font-medium normal-case tracking-normal">
              {t('calNoteHint')}
              <span aria-hidden className="ml-auto shrink-0 font-mono tabular-nums">{note.length}/{MAX_NOTE}</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {current !== null && (
              <button type="button" onClick={() => void save('')} disabled={busy} className={`${button} border border-[var(--cal-border-hover)] ${TEXT} hover:border-[var(--cal-gold)]`}>
                <RotateCcw size={15} aria-hidden /> {t('calNoteReset')}
              </button>
            )}
            <button type="button" onClick={onClose} disabled={busy} className={`${button} ml-auto ${MUTED} hover:text-[var(--cal-date)]`}>
              {t('cancel')}
            </button>
            <button type="submit" disabled={busy || (current === null && !note.trim())} className={`${button} bg-[var(--cal-gold)] text-[var(--cal-on-gold)] hover:brightness-110`}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} strokeWidth={3} aria-hidden />}
              {busy ? t('calNoteSaving') : t('calNoteSave')}
            </button>
          </div>

          {error && <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </form>
      </div>
    </div>
  );
}
