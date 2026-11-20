import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Church, Clock, Languages, Loader2, Plus, X } from 'lucide-react';
import { planStatusOf } from '../../shared/liturgical-calendar.js';
import {
  MAX_MASS_LANGUAGE,
  MAX_MASS_TIME,
  SCHEDULE_LANGUAGES,
  TIME_PRESETS,
  isScheduleLanguage,
  normalizeMassLanguage,
  normalizeMassTime,
  scheduleLabel,
  type ScheduleLanguage,
} from '../../shared/mass-schedule.js';
import { NO_DRAG } from '../components/appRegion';
import type { PlannerT } from './strings';
import type { MassSchedule, PlanSummary } from './types';

// The calendar's own surface (see .planner-cal in styles.css): these dialogs open from the calendar and from the editor and look the same.
const SURFACE = 'bg-[var(--cal-surface)]';
const TEXT = 'text-[var(--cal-text)]';
const MUTED = 'text-[var(--cal-muted)]';
const GOLD = 'text-[var(--cal-gold)]';
const ROUND_BTN = `grid size-9 shrink-0 place-items-center rounded-full border border-[var(--cal-border-hover)] ${TEXT} transition hover:border-[var(--cal-gold)] hover:text-[var(--cal-gold)] focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none`;
const CHIP = 'inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none';
const CHIP_ON = 'border-[var(--cal-gold)] bg-[var(--cal-gold)] text-[var(--cal-on-gold)]';
const CHIP_OFF = `border-[var(--cal-border-hover)] bg-[var(--cal-cell)] ${TEXT} hover:border-[var(--cal-gold)]`;
const INPUT = `h-11 rounded-lg border border-[var(--cal-border-hover)] bg-[var(--cal-cell)] px-3 text-base font-semibold normal-case tracking-normal ${TEXT} outline-none focus:border-[var(--cal-gold)] focus:ring-1 focus:ring-[var(--cal-gold)]`;

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);

/** A schedule language's name in the app language: lang_English, lang_Cebuano, lang_Tagalog. */
export const scheduleLanguageLabel = (t: PlannerT) => (name: ScheduleLanguage) => t(`lang_${name}`);

/** A plan's schedule as one line in the app language ("6:00 AM · English"), or '' for a plan without one. */
export const scheduleText = (t: PlannerT, plan: Partial<MassSchedule> | null | undefined, short = false) =>
  scheduleLabel(plan, { short, languageLabel: scheduleLanguageLabel(t) });

/** An empty schedule: what a new Holy Mass starts with. */
export const EMPTY_SCHEDULE: MassSchedule = { massTime: '', massLanguage: '' };

/** Closes on Escape and on a press outside `ref`, unless `busy`. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [ref, onClose]);
}

/**
 * The Holy Mass time and language: a free text time with one-tap presets, and English / Cebuano / Tagalog pills with Other for the operator's
 * own language. Controlled. Used by Create a plan, Add Another Holy Mass Schedule and the editor's Edit time & language.
 */
export function ScheduleFields({ t, value, onChange, autoFocus = false }: { t: PlannerT; value: MassSchedule; onChange: (next: MassSchedule) => void; autoFocus?: boolean }) {
  const language = value.massLanguage;
  // Other is open when the language is the operator's own, or when they picked Other and have not typed yet.
  const [otherOpen, setOtherOpen] = useState(() => language !== '' && !isScheduleLanguage(normalizeMassLanguage(language)));
  const isOther = otherOpen || (language !== '' && !isScheduleLanguage(normalizeMassLanguage(language)));
  const timeShown = normalizeMassTime(value.massTime);
  return (
    <div className="flex flex-col gap-4">
      <label className={`flex flex-col gap-1.5 text-xs font-bold tracking-wide uppercase ${MUTED}`}>
        <span className="inline-flex items-center gap-1.5"><Clock size={13} aria-hidden /> {t('massTime')}</span>
        <input
          autoFocus={autoFocus}
          maxLength={MAX_MASS_TIME}
          value={value.massTime}
          placeholder={t('massTimePlaceholder')}
          onChange={(e) => onChange({ ...value, massTime: e.target.value })}
          className={INPUT}
        />
        <span className="flex flex-wrap items-center gap-1.5 normal-case tracking-normal" role="group" aria-label={t('massTimeHint')}>
          {TIME_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={timeShown === preset}
              onClick={() => onChange({ ...value, massTime: preset })}
              className={`${CHIP} ${timeShown === preset ? CHIP_ON : CHIP_OFF}`}
            >
              {preset}
            </button>
          ))}
          <span className="text-xs font-medium">{t('massTimeHint')}</span>
        </span>
      </label>

      <div className={`flex flex-col gap-1.5 text-xs font-bold tracking-wide uppercase ${MUTED}`}>
        <span className="inline-flex items-center gap-1.5" id="schedule-language-label"><Languages size={13} aria-hidden /> {t('scheduleLanguage')}</span>
        <div role="group" aria-labelledby="schedule-language-label" className="flex flex-wrap gap-1.5 normal-case tracking-normal">
          {SCHEDULE_LANGUAGES.map((name) => {
            const on = !isOther && normalizeMassLanguage(language) === name;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setOtherOpen(false);
                  onChange({ ...value, massLanguage: on ? '' : name });
                }}
                className={`${CHIP} h-9 px-4 text-sm ${on ? CHIP_ON : CHIP_OFF}`}
              >
                {t(`lang_${name}`)}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={isOther}
            onClick={() => {
              setOtherOpen(!isOther);
              if (isOther || isScheduleLanguage(normalizeMassLanguage(language))) onChange({ ...value, massLanguage: '' });
            }}
            className={`${CHIP} h-9 px-4 text-sm ${isOther ? CHIP_ON : CHIP_OFF}`}
          >
            {t('lang_Other')}
          </button>
        </div>
        {isOther && (
          <input
            autoFocus
            maxLength={MAX_MASS_LANGUAGE}
            value={language}
            aria-label={t('lang_Other')}
            placeholder={t('langCustomPlaceholder')}
            onChange={(e) => onChange({ ...value, massLanguage: e.target.value })}
            className={INPUT}
          />
        )}
        <span className="text-xs font-medium normal-case tracking-normal">{t('scheduleTextsHint')}</span>
      </div>
    </div>
  );
}

/** One schedule's line in a list: time, language badge and how far its lineup is. */
function ScheduleRow({ t, plan, iso }: { t: PlannerT; plan: PlanSummary; iso: string }) {
  const time = normalizeMassTime(plan.massTime);
  const language = normalizeMassLanguage(plan.massLanguage);
  const ready = planStatusOf(iso, plan.filledSlots) === 'ready';
  return (
    <>
      <span className={`grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--cal-badge)] ${TEXT}`}>
        <Church size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`font-mono text-base font-extrabold tabular-nums ${time ? 'text-[var(--cal-date)]' : MUTED}`}>{time || t('scheduleNoTime')}</span>
          {language && (
            <span className={`rounded-full border border-[var(--cal-gold)]/60 bg-[var(--cal-gold)]/15 px-2 py-0.5 text-[11px] font-extrabold tracking-wider uppercase ${GOLD}`}>
              {isScheduleLanguage(language) ? t(`lang_${language}`) : language}
            </span>
          )}
        </span>
        <span className={`mt-0.5 block truncate text-xs font-medium ${MUTED}`}>{plan.name}</span>
      </span>
      <span className={`shrink-0 text-right text-xs font-bold ${ready ? 'text-ok' : MUTED}`}>
        {ready ? (
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} aria-hidden /> {t('calReady')}</span>
        ) : (
          t('scheduleItems', { n: plan.itemCount ?? 0 })
        )}
      </span>
    </>
  );
}

/**
 * Available Holy Mass Schedules: opened by a day on the Liturgical Calendar that already has a Holy Mass. Each saved schedule, in the order
 * they are celebrated, opens its own plan; Add Another Holy Mass Schedule makes another Holy Mass on the same day.
 */
export function DaySchedulesDialog({ t, iso, dateLabel, plans, onOpen, onAdd, onClose }: {
  t: PlannerT; iso: string; dateLabel: string;
  /** The day's Holy Mass plans, already in the order they are celebrated (schedulesOn). */
  plans: PlanSummary[];
  onOpen: (id: number) => void; onAdd: () => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(panel, onClose);
  useEffect(() => panel.current?.querySelector<HTMLButtonElement>('[data-schedule]')?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" style={NO_DRAG}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-schedules-title"
        style={NO_DRAG}
        className={`planner-cal relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--cal-border-hover)] ${SURFACE} shadow-2xl shadow-black/60`}
      >
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-extrabold tracking-wider uppercase ${GOLD}`}>{t('schedulesTitle')}</p>
              <h2 id="day-schedules-title" className="mt-1 text-2xl leading-tight font-extrabold text-[var(--cal-date)]">{dateLabel}</h2>
              <p className={`mt-1 text-sm ${MUTED}`}>{t('schedulesHint')}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={t('cancel')} title={t('cancel')} className={ROUND_BTN}>
              <X size={18} aria-hidden />
            </button>
          </div>
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {plans.map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  data-schedule
                  onClick={() => onOpen(plan.id)}
                  aria-label={`${t('calOpenSchedule', { schedule: scheduleText(t, plan) || plan.name })}: ${plan.name}`}
                  className="flex w-full items-center gap-3 rounded-xl border border-[var(--cal-border-hover)] bg-[var(--cal-cell)] p-3 text-left transition hover:border-[var(--cal-gold)] hover:bg-[var(--cal-cell-hover)] focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:outline-none"
                >
                  <ScheduleRow t={t} plan={plan} iso={iso} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[var(--cal-gold)] px-4 text-sm font-extrabold tracking-wide text-[var(--cal-on-gold)] uppercase transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--cal-gold)] focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Plus size={16} strokeWidth={3} aria-hidden /> {t('addSchedule')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The editor's schedule form: Edit time & language for the open plan, or (with `name`) Add Another Holy Mass Schedule on its day. `onSave`
 * rejects with the reason it could not be kept, shown in the dialog, which stays open.
 */
export function ScheduleFormDialog({ t, mode, dateLabel, initial, initialName, onSave, onClose }: {
  t: PlannerT; mode: 'edit' | 'add'; dateLabel: string; initial: MassSchedule;
  /** For 'add': the new plan's suggested name. */
  initialName?: string;
  onSave: (schedule: MassSchedule, name: string) => Promise<void>; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [schedule, setSchedule] = useState<MassSchedule>(initial);
  const [name, setName] = useState((initialName ?? '').slice(0, 120));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDismiss(panel, () => {
    if (!busy) onClose();
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (mode === 'add' && !name.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(schedule, name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" style={NO_DRAG}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-form-title"
        style={NO_DRAG}
        className={`planner-cal relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--cal-border-hover)] ${SURFACE} shadow-2xl shadow-black/60`}
      >
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-extrabold tracking-wider uppercase ${GOLD}`}>{mode === 'add' ? t('scheduleAddTitle') : t('scheduleEditTitle')}</p>
              <h2 id="schedule-form-title" className="mt-1 text-2xl leading-tight font-extrabold text-[var(--cal-date)]">{dateLabel}</h2>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label={t('cancel')} title={t('cancel')} className={ROUND_BTN}>
              <X size={18} aria-hidden />
            </button>
          </div>
          {mode === 'add' && (
            <label className={`flex flex-col gap-1.5 text-xs font-bold tracking-wide uppercase ${MUTED}`}>
              {t('createName')}
              <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
            </label>
          )}
          <ScheduleFields t={t} value={schedule} onChange={setSchedule} autoFocus />
          {error && <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={`inline-flex h-10 items-center rounded-lg px-4 text-sm font-extrabold ${MUTED} hover:text-[var(--cal-date)]`}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || (mode === 'add' && !name.trim())}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[var(--cal-gold)] px-4 text-sm font-extrabold text-[var(--cal-on-gold)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : mode === 'add' ? <Plus size={15} strokeWidth={3} aria-hidden /> : <Check size={15} strokeWidth={3} aria-hidden />}
              {busy ? (mode === 'add' ? t('createBusy') : t('scheduleSaving')) : mode === 'add' ? t('calCreate') : t('scheduleSave')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * The editor header's day switcher: a pill for each Holy Mass on the open plan's day ("6:00 AM · English"), the open one marked, and + Add
 * Time. Shown only when the day has more than one Holy Mass or the open one has a schedule, so a single legacy plan's header stays as it was.
 */
export function ScheduleSwitcher({ t, plans, activeId, onPick, onAdd, onEdit }: {
  t: PlannerT; plans: PlanSummary[]; activeId: number | null;
  onPick: (id: number) => void; onAdd: () => void; onEdit: () => void;
}) {
  const pill = 'inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
  return (
    <div role="group" aria-label={t('scheduleSwitch')} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{t('scheduleSwitch')}</span>
      {plans.map((plan) => {
        const on = plan.id === activeId;
        const text = scheduleText(t, plan) || t('scheduleNoTime');
        return (
          <button
            key={plan.id}
            type="button"
            aria-pressed={on}
            title={on ? t('scheduleEdit') : plan.name}
            onClick={() => (on ? onEdit() : onPick(plan.id))}
            className={`${pill} ${on ? 'border-accent bg-accent text-on-accent shadow' : 'border-fg/15 bg-panel-2 text-fg/80 hover:border-accent/60 hover:text-fg'}`}
          >
            <Clock size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{text}</span>
          </button>
        );
      })}
      <button type="button" onClick={onAdd} className={`${pill} border-dashed border-accent/60 text-accent hover:bg-accent/10`}>
        <Plus size={12} strokeWidth={3} aria-hidden /> {t('addTime')}
      </button>
    </div>
  );
}
