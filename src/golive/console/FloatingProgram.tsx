import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useLive } from '../../live/store';
import { NO_DRAG } from '../../components/appRegion';
import { miniScreenShown } from '../../../shared/stage-cue.js';
import { useQuickLivePreview } from '../quickLiveSession';
import { useGoLiveT } from '../strings';
import { consoleOutputActions } from './TransportBar';
import { BTN, BTN_DANGER_ACTIVE, BTN_PRIMARY, EYEBROW, MONITOR } from './styles';

interface Props {
  /** The two stage monitors: the mini screen docks once their bottom edge has scrolled up past the top of the window. */
  anchor: RefObject<HTMLElement | null>;
  /** The slide on air, drawn as the program monitor draws it. */
  program: ReactNode;
  /** "03 / 12", or null for an item of one slide. */
  counter: string | null;
  onBack: () => void;
  onNext: () => void;
  backDisabled: boolean;
  nextDisabled: boolean;
  /** Opens the Output Preview Editor on the slide on air. */
  onEdit: (() => void) | null;
  /** True while the console has a dialog of its own open: the mini screen steps aside. */
  suspended?: boolean;
  /** The run is on air: the title reads Program · Live. Standing by, it says so instead of claiming the screen. */
  live?: boolean;
}

const SM = '!h-7 !px-2 !text-[11px] no-drag';

/**
 * The floating Program mini screen. Scrolled down to Jump to Cue or the editor, the operator still sees the slide on air in the bottom-right
 * corner, with Back, Next, Edit and Blackout under it. Hide folds it into a small bar (Program · 03 / 12) with Unhide; ↑ Main Mode scrolls
 * back up to the monitors. It steps aside while a dialog or the Quick-Live popup is open. No-drag throughout, as anything over the window is.
 */
export function FloatingProgram({ anchor, program, counter, onBack, onNext, backDisabled, nextDisabled, onEdit, suspended = false, live = true }: Props) {
  const t = useGoLiveT();
  const docked = useMonitorsScrolledAway(anchor, suspended);
  const [hidden, setHidden] = useState(false);
  const blackout = useLive((s) => s.state.projector.live.kind === 'blackout');
  const textHidden = useLive((s) => s.state.projector.textHidden === true);
  if (!docked) return null;
  const toMain = () => anchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (hidden) {
    return createPortal(
      <aside
        aria-label={t('consoleMiniBarLabel')}
        style={NO_DRAG}
        data-floating-program="hidden"
        className="no-drag fixed right-4 bottom-4 z-40 flex items-center gap-2.5 rounded-xl border border-line-strong bg-surface/95 px-3 py-2 shadow-2xl backdrop-blur"
      >
        <span className="font-mono text-[11px] text-fg/85 tabular-nums">{t('consoleMiniBar', { pos: counter ?? '—' })}</span>
        <button type="button" style={NO_DRAG} onClick={() => setHidden(false)} className={`${BTN_PRIMARY} ${SM}`}>
          {t('consoleMiniUnhide')}
        </button>
        <button type="button" style={NO_DRAG} onClick={toMain} className={`${BTN} ${SM}`}>
          {t('consoleMiniMain')}
        </button>
      </aside>,
      document.body,
    );
  }

  return createPortal(
    <aside
      aria-label={t('consoleMiniLabel')}
      style={NO_DRAG}
      data-floating-program="shown"
      className="no-drag fixed right-4 bottom-4 z-40 flex w-[356px] max-w-[calc(100vw-2rem)] flex-col gap-2.5 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`${EYEBROW} ${live ? 'text-accent' : 'text-muted'}`}>{t(live ? 'consoleMiniTitle' : 'consoleMiniStandby')}</span>
          {counter && <span className="font-mono text-[11px] text-muted tabular-nums">{counter}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" style={NO_DRAG} onClick={() => setHidden(true)} className={`${BTN} ${SM}`}>
            {t('consoleMiniHide')}
          </button>
          <button type="button" style={NO_DRAG} onClick={toMain} className={`${BTN} ${SM}`}>
            {t('consoleMiniMain')}
          </button>
        </div>
      </div>
      <div className={MONITOR} aria-hidden>
        {program}
        {blackout ? (
          <div className="absolute inset-0 z-30 grid place-items-center bg-black text-[11px] font-bold text-danger">{t('consoleBlackoutOverlay')}</div>
        ) : textHidden ? (
          <div className="absolute inset-x-0 top-0 z-30 bg-black/80 py-0.5 text-center text-[10px] font-bold text-warn">{t('consoleHiddenOverlay')}</div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" style={NO_DRAG} disabled={backDisabled} onClick={onBack} className={`${BTN} ${SM}`}>
            {t('consoleMiniBack')}
          </button>
          <button type="button" style={NO_DRAG} disabled={nextDisabled} onClick={onNext} className={`${BTN_PRIMARY} ${SM}`}>
            {t('consoleMiniNext')}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" style={NO_DRAG} disabled={!onEdit} onClick={onEdit ?? undefined} className={`${BTN} ${SM}`}>
            {t('consoleMiniEdit')}
          </button>
          <button type="button" style={NO_DRAG} aria-pressed={blackout} aria-keyshortcuts="B" onClick={consoleOutputActions.blackout} className={`${blackout ? BTN_DANGER_ACTIVE : BTN} ${SM}`}>
            {t('consoleMiniBlackout')}
          </button>
        </div>
      </div>
    </aside>,
    document.body,
  );
}

/**
 * Whether the monitors have scrolled up out of sight (their bottom edge above the dock threshold), read on every scroll of any scrolling box
 * (the console scrolls inside the operator window's main pane, not the window) and on resize. False while `suspended`, while any dialog is
 * open, and while the Quick-Live popup is up.
 */
function useMonitorsScrolledAway(anchor: RefObject<HTMLElement | null>, suspended: boolean): boolean {
  const quickLive = useQuickLivePreview((s) => s.session !== null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const read = () => {
      const el = anchor.current;
      const blocked = suspended || quickLive || document.querySelector('[aria-modal="true"]') !== null;
      setAway(el ? miniScreenShown({ monitorsBottom: el.getBoundingClientRect().bottom, blocked }) : false);
    };
    read();
    // Capture, so a scroll inside the main pane (which does not bubble) is heard too.
    window.addEventListener('scroll', read, { capture: true, passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read, { capture: true });
      window.removeEventListener('resize', read);
    };
  }, [anchor, suspended, quickLive]);
  return away;
}
