import type { ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { clockOf, pad2, timerProgress, type OutputStatus } from '../../../shared/stage-cue.js';
import { useGoLiveT } from '../strings';
import { CARD, BTN, BTN_ACTIVE, STATUS_TONE } from './styles';

export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  titleId: string;
  /** True while this run has the screen: the kicker reads Now Live; otherwise Standing By. */
  live: boolean;
  /** 0-based place of the segment on air in the lineup, and the lineup's length. */
  at: number;
  total: number;
  /** The segment's role: its group in Praise & Worship, its liturgical block in the Holy Mass. */
  role: string;
  /** Every segment of the lineup, for the quick-switcher. `value` is the one on air. */
  options: SegmentOption[];
  value: string;
  onPick: (value: string) => void;
  disabled?: boolean;
  timer: {
    elapsedMs: number;
    plannedMs: number | null;
    running: boolean;
    onToggle: () => void;
    onReset: () => void;
  };
  status: OutputStatus;
  /** Beside the status: the run's own commands (end session, the focus view). */
  actions?: ReactNode;
  /** The toolbar row beside the timer: run readouts and switches (session time, intro slide). */
  tools?: ReactNode;
  /** Under the title: a warning about the segment (no song chosen). */
  alert?: ReactNode;
}

/**
 * The console's header: where the run is (Now Live · Segment 03 of 12 · role), a quick-switcher over every segment of the lineup, the segment
 * timer with Start / Pause and Reset over a progress track that turns red past the plan, and the output status pill that follows the projector.
 */
export function BroadcastHeader({ titleId, live, at, total, role, options, value, onPick, disabled, timer, status, actions, tools, alert }: Props) {
  const t = useGoLiveT();
  const progress = timerProgress(timer.elapsedMs, timer.plannedMs);
  const statusLabel = {
    onAir: t('consoleStatusOnAir'),
    hidden: t('consoleStatusHidden'),
    blackout: t('consoleStatusBlackout'),
    offAir: t('consoleStatusOffAir'),
  }[status];
  return (
    <header aria-labelledby={titleId} className={`${CARD} flex flex-col gap-3 p-4`}>
      {/* Row 1: where the run is, with its status and commands. Row 2: the timer and the run's switches, so the title keeps its room. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-[16rem] flex-1 flex-col">
          <p className="text-xs font-semibold tracking-wide text-accent">
            {t('consoleKicker', { state: t(live ? 'consoleNowLive' : 'consoleStandingBy'), n: pad2(at + 1), total: pad2(total), role })}
          </p>
          {/* The title is the switcher: the segment on air, and a pick away from any other. */}
          <select
            id={titleId}
            aria-label={t('consoleSegmentPick')}
            value={value}
            disabled={disabled}
            onChange={(e) => onPick(e.target.value)}
            className="mt-1 -ml-1.5 max-w-full min-w-0 cursor-pointer self-start truncate [field-sizing:content] rounded-md border border-transparent bg-transparent py-0.5 pr-7 pl-1.5 text-2xl leading-tight font-bold tracking-tight text-fg transition outline-none hover:border-line hover:bg-panel-2 focus-visible:border-accent focus-visible:bg-panel-2 disabled:cursor-not-allowed"
          >
            {/* Nothing picked yet (a Holy Mass not started): a blank first entry, so the title never claims an item that is not up. */}
            {!options.some((o) => o.value === value) && (
              <option value={value} disabled className="bg-surface text-base text-fg">
                {t('consoleNotStarted')}
              </option>
            )}
            {options.map((o, i) => (
              <option key={o.value} value={o.value} disabled={o.disabled} className="bg-surface text-base text-fg">
                {pad2(i + 1)} · {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            role="status"
            data-output-status={status}
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${STATUS_TONE[status]}`}
          >
            <span aria-hidden className={`size-2 rounded-full bg-current ${status === 'offAir' ? '' : 'animate-pulse'}`} />
            {statusLabel}
          </span>
          {actions}
        </div>
      </div>
      {alert}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3">
        <div
          role="group"
          aria-label={t('consoleTimer')}
          className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/60 py-1.5 pr-1.5 pl-3"
        >
          <div className="flex flex-col">
            <span id={`${titleId}-timer`} className="text-[11px] text-muted">
              {t('consoleTimer')}
            </span>
            <span className={`font-mono text-base font-semibold tabular-nums ${progress.over ? 'text-danger' : 'text-fg'}`} aria-live="off">
              {clockOf(timer.elapsedMs / 1000)} / {timer.plannedMs ? clockOf(timer.plannedMs / 1000) : '--:--'}
            </span>
          </div>
          <button type="button" aria-pressed={timer.running} onClick={timer.onToggle} className={timer.running ? BTN_ACTIVE : BTN}>
            {timer.running ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
            {t(timer.running ? 'consoleTimerPause' : 'consoleTimerStart')}
          </button>
          <button type="button" onClick={timer.onReset} className={BTN}>
            <RotateCcw size={13} aria-hidden />
            {t('consoleTimerReset')}
          </button>
        </div>
        {tools}
      </div>
      <div
        role="progressbar"
        aria-labelledby={`${titleId}-timer`}
        aria-valuemin={0}
        aria-valuemax={timer.plannedMs ? Math.round(timer.plannedMs / 1000) : 0}
        aria-valuenow={Math.round(timer.elapsedMs / 1000)}
        aria-valuetext={timer.plannedMs ? undefined : t('consoleTimerNoPlan')}
        className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${progress.over ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </header>
  );
}
