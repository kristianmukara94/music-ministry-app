// Annual Planner Cleanup: the once-a-year banner and the Clean Up Plans dialog. The dialog deletes the Holy Mass plans and Praise & Worship
// sessions of a whole year or of chosen months. The matching rules are shared/planner-cleanup.js (the main process re-runs the same ones before it
// deletes). A plan loaded on air in Go Live is sent as protected and comes back as skipped, never deleted. Every backdrop and control is no-drag,
// because the dialog can reach under the top bar's drag region (src/components/appRegion.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, Check, Loader2, Trash2, X } from 'lucide-react';
import { cleanupScopeLabel, matchCleanup, monthCounts, yearOptions, type CleanupPlanType } from '../../shared/planner-cleanup.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { NO_DRAG } from '../components/appRegion';
import type { PlannerT } from './strings';
import type { PlannerCleanupResult } from './types';

type Lang = 'en' | 'tl' | 'ceb';
const LOCALE: Record<Lang, string> = { en: 'en-US', tl: 'fil-PH', ceb: 'ceb-PH' };
const TYPES: { id: CleanupPlanType; key: 'cleanup_type_all' | 'cleanup_type_mass' | 'cleanup_type_pw' }[] = [
  { id: 'all', key: 'cleanup_type_all' },
  { id: 'mass', key: 'cleanup_type_mass' },
  { id: 'pw', key: 'cleanup_type_pw' },
];

/** Short month names ('Jan' … 'Dec') in the interface language. */
export function shortMonthNames(lang: Lang): string[] {
  const fmt = new Intl.DateTimeFormat(LOCALE[lang] ?? 'en-US', { month: 'short', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(Date.UTC(2024, m, 15))));
}

export interface CleanupPlan {
  id: number;
  name: string;
  liturgicalDate: string;
}

const PILL = 'inline-flex h-9 items-center justify-center rounded-full border px-4 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
const PILL_ON = 'border-accent bg-accent text-on-accent';
const PILL_OFF = 'border-fg/20 bg-surface text-fg hover:border-accent';

/** The once-a-year reminder in the Planner header. Review opens the dialog on the latest earlier year; Dismiss is remembered for this year. */
export function AnnualCleanupBanner({ t, count, beforeYear, onReview, onDismiss }: { t: PlannerT; count: number; beforeYear: number; onReview: () => void; onDismiss: () => void }) {
  return (
    <div role="status" style={NO_DRAG} className="mx-5 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-fg">
      <Archive size={18} aria-hidden className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 font-semibold">{t('cleanup_banner', { count, year: beforeYear })}</p>
      <button type="button" style={NO_DRAG} onClick={onReview} className={`${PILL} ${PILL_ON}`}>
        {t('cleanup_review')}
      </button>
      <button type="button" style={NO_DRAG} onClick={onDismiss} className={`${PILL} ${PILL_OFF}`}>
        {t('cleanup_dismiss')}
      </button>
    </div>
  );
}

export function PlannerCleanupDialog({ t, lang, massPlans, pwSessions, initialYear, currentYear, onClose, onDeleted }: {
  t: PlannerT;
  lang: Lang;
  massPlans: readonly CleanupPlan[];
  pwSessions: readonly CleanupPlan[];
  initialYear: number | null;
  currentYear: number;
  onClose: () => void;
  /** After a delete: the result, for the toast, the calendars and the once-a-year dismissal. */
  onDeleted: (result: PlannerCleanupResult) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const loadedMass = useLive((s) => s.state.queuePlanId);
  const loadedPw = useLive((s) => s.state.pw?.sessionId ?? null);
  const years = useMemo(() => yearOptions({ mass: massPlans, pw: pwSessions }, [currentYear, currentYear - 1]), [massPlans, pwSessions, currentYear]);
  const [year, setYear] = useState(() => initialYear ?? years.find((y) => y.year < currentYear && y.count > 0)?.year ?? currentYear);
  const [scope, setScope] = useState<'year' | 'months'>('year');
  const [months, setMonths] = useState<number[]>([]);
  const [planType, setPlanType] = useState<CleanupPlanType>('all');
  const [cloudLinked, setCloudLinked] = useState(false);
  const [fromCloud, setFromCloud] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'delete' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = useMemo(() => shortMonthNames(lang), [lang]);

  useEffect(() => {
    let live = true;
    bridge.cloud.status().then((s) => live && setCloudLinked(Boolean(s.linked))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => panel.current?.querySelector<HTMLElement>('select')?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  const lists = { mass: massPlans, pw: pwSessions };
  const counts = useMemo(() => monthCounts(lists, year, planType), [massPlans, pwSessions, year, planType]);
  // A month scope keeps only months that still hold plans, so a stale pick never counts.
  const chosen = scope === 'year' ? null : months.filter((m) => counts[m] > 0);
  const matched = useMemo(() => matchCleanup(lists, { year, months: chosen, planType }), [massPlans, pwSessions, year, chosen?.join(','), planType]);
  const total = matched.mass.length + matched.pw.length;
  const preview = useMemo(
    () => [...matched.mass.map((p) => ({ ...p, kind: 'mass' as const })), ...matched.pw.map((p) => ({ ...p, kind: 'pw' as const }))].sort((a, b) => a.liturgicalDate.localeCompare(b.liturgicalDate) || a.id - b.id),
    [matched],
  );
  const request = {
    year,
    months: chosen,
    planType,
    deleteFromCloud: cloudLinked && fromCloud,
    protectedMassIds: loadedMass != null ? [loadedMass] : [],
    protectedPwIds: loadedPw != null ? [loadedPw] : [],
  };

  // Any change to what is chosen asks for the confirmation again.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setConfirm(false);
    setNote(null);
    setError(null);
  };

  const exportBackup = async () => {
    setBusy('backup');
    setError(null);
    try {
      const saved = await bridge.plannerCleanup.exportBackup(request);
      setNote(saved ? t('cleanup_backup_done', { path: saved.path }) : t('cleanup_backup_none'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runDelete = async () => {
    if (!confirm || total === 0) return;
    setBusy('delete');
    setError(null);
    try {
      const result = await bridge.plannerCleanup.deletePlans(request);
      onDeleted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const toggleMonth = (m: number) => edit(setMonths)(months.includes(m) ? months.filter((x) => x !== m) : [...months, m]);
  const heldOnAir = preview.some((p) => (p.kind === 'mass' ? p.id === loadedMass : p.id === loadedPw));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" style={NO_DRAG}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleanup-title"
        style={NO_DRAG}
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-fg/20 bg-surface-2 text-fg shadow-2xl shadow-black/60"
      >
        <div className="flex items-start gap-3 border-b border-fg/10 p-5">
          <div className="min-w-0 flex-1">
            <h2 id="cleanup-title" className="text-2xl font-extrabold">{t('cleanup_title')}</h2>
            <p className="mt-1 text-sm text-fg/75">{t('cleanup_hint')}</p>
          </div>
          <button type="button" style={NO_DRAG} onClick={onClose} disabled={busy !== null} aria-label={t('cleanup_close')} className="grid size-9 place-items-center rounded-full border border-fg/20 transition hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-5" style={NO_DRAG}>
          <label className="flex flex-col gap-1.5 text-sm font-bold">
            {t('cleanup_year')}
            <select
              style={NO_DRAG}
              value={year}
              onChange={(e) => edit(setYear)(Number(e.target.value))}
              className="h-11 rounded-lg border border-fg/20 bg-surface px-3 text-base font-semibold focus:border-accent focus:outline-none"
            >
              {years.map((y) => (
                <option key={y.year} value={y.year}>{t('cleanup_year_option', { year: y.year, count: y.count })}</option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2" style={NO_DRAG}>
            <legend className="mb-1 text-sm font-bold">{t('cleanup_scope')}</legend>
            <div className="flex flex-wrap gap-2">
              <button type="button" style={NO_DRAG} aria-pressed={scope === 'year'} onClick={() => edit(setScope)('year')} className={`${PILL} ${scope === 'year' ? PILL_ON : PILL_OFF}`}>
                {t('cleanup_scope_year')}
              </button>
              <button type="button" style={NO_DRAG} aria-pressed={scope === 'months'} onClick={() => edit(setScope)('months')} className={`${PILL} ${scope === 'months' ? PILL_ON : PILL_OFF}`}>
                {t('cleanup_scope_months')}
              </button>
            </div>
            {scope === 'months' && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-4 text-sm font-bold">
                  <button type="button" style={NO_DRAG} className="text-accent underline-offset-2 hover:underline" onClick={() => edit(setMonths)(counts.map((c, m) => (c > 0 ? m : -1)).filter((m) => m >= 0))}>
                    {t('cleanup_months_all')}
                  </button>
                  <button type="button" style={NO_DRAG} className="text-accent underline-offset-2 hover:underline" onClick={() => edit(setMonths)([])}>
                    {t('cleanup_months_clear')}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {names.map((name, m) => (
                    <button
                      key={m}
                      type="button"
                      style={NO_DRAG}
                      disabled={counts[m] === 0}
                      aria-pressed={months.includes(m) && counts[m] > 0}
                      aria-label={t('cleanup_month_count', { month: name, count: counts[m] })}
                      onClick={() => toggleMonth(m)}
                      className={`${PILL} h-12 flex-col gap-0 px-2 leading-tight disabled:cursor-not-allowed disabled:opacity-40 ${months.includes(m) && counts[m] > 0 ? PILL_ON : PILL_OFF}`}
                    >
                      <span>{name}</span>
                      <span className="text-xs font-semibold tabular-nums opacity-80">{counts[m]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2" style={NO_DRAG}>
            <legend className="mb-1 text-sm font-bold">{t('cleanup_type')}</legend>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((type) => (
                <button key={type.id} type="button" style={NO_DRAG} aria-pressed={planType === type.id} onClick={() => edit(setPlanType)(type.id)} className={`${PILL} ${planType === type.id ? PILL_ON : PILL_OFF}`}>
                  {t(type.key)}
                </button>
              ))}
            </div>
          </fieldset>

          <section aria-live="polite" className="rounded-xl border border-fg/15 bg-surface p-4" style={NO_DRAG}>
            <h3 className="text-sm font-bold">{t('cleanup_summary')}</h3>
            <p className="mt-1 text-base font-extrabold">
              {t('cleanup_summary_mass', { count: matched.mass.length })} · {t('cleanup_summary_pw', { count: matched.pw.length })}
            </p>
            {total === 0 ? (
              <p className="mt-2 text-sm text-fg/70">{t('cleanup_none')}</p>
            ) : (
              <ul tabIndex={0} style={NO_DRAG} className="mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto pr-1 text-sm">
                {preview.map((p) => (
                  <li key={`${p.kind}:${p.id}`} className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-xs text-fg/70 tabular-nums">{p.liturgicalDate}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                    <span className="shrink-0 text-xs text-fg/75">{t(p.kind === 'mass' ? 'cleanup_kind_mass' : 'cleanup_kind_pw')}</span>
                  </li>
                ))}
              </ul>
            )}
            {heldOnAir && (
              <p className="mt-3 flex items-start gap-2 text-sm text-warning">
                <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
                {t('cleanup_onair')}
              </p>
            )}
          </section>

          {cloudLinked && (
            <label className="flex items-start gap-3 text-sm font-semibold" style={NO_DRAG}>
              <input type="checkbox" style={NO_DRAG} checked={fromCloud} onChange={(e) => edit(setFromCloud)(e.target.checked)} className="mt-0.5 size-5 accent-[var(--accent)]" />
              <span>
                {t('cleanup_cloud')}
                {!fromCloud && <span className="mt-0.5 block text-xs font-normal text-fg/70">{t('cleanup_cloud_off')}</span>}
              </span>
            </label>
          )}

          {note && <p role="status" className="text-sm font-semibold text-fg/85">{note}</p>}
          {error && <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </div>

        <div className="flex flex-col gap-3 border-t border-fg/10 p-5" style={NO_DRAG}>
          <label className={`flex items-start gap-3 text-sm font-semibold ${total === 0 ? 'opacity-50' : ''}`} style={NO_DRAG}>
            <input type="checkbox" style={NO_DRAG} disabled={total === 0 || busy !== null} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-5 accent-[var(--accent)]" />
            <span>
              {t('cleanup_confirm_check')}
              <span className="mt-0.5 block text-xs font-normal text-fg/70">{t('cleanup_confirm_hint')}</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" style={NO_DRAG} disabled={total === 0 || busy !== null} onClick={() => void exportBackup()} className={`${PILL} ${PILL_OFF} gap-2 disabled:opacity-50`}>
              {busy === 'backup' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Archive size={15} aria-hidden />}
              {t('cleanup_backup')}
            </button>
            <button
              type="button"
              style={NO_DRAG}
              disabled={total === 0 || !confirm || busy !== null}
              onClick={() => void runDelete()}
              className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-danger px-5 text-sm font-extrabold text-white transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'delete' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : confirm ? <Check size={15} aria-hidden /> : <Trash2 size={15} aria-hidden />}
              {busy === 'delete' ? t('cleanup_deleting') : t('cleanup_delete', { count: total })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The confirmation line after a cleanup, and a second line naming any plan that stayed because it is on air. */
export function cleanupNotice(t: PlannerT, lang: Lang, result: PlannerCleanupResult): string {
  const scope = cleanupScopeLabel(result.year, result.months, shortMonthNames(lang));
  const done = t('cleanup_done', { count: result.deleted, scope });
  if (result.skipped.length === 0) return done;
  return `${done} ${t('cleanup_skipped', { count: result.skipped.length, names: result.skipped.map((s) => s.name).join(', ') })}`;
}
