import { Pause, Play } from 'lucide-react';
import { dispatch, useLive } from '../../live/store';
import { useGoLiveT } from '../strings';
import { BTN, BTN_ACTIVE, BTN_DANGER_ACTIVE, BTN_PRIMARY } from './styles';

interface Props {
  onBack: () => void;
  onNext: () => void;
  backDisabled: boolean;
  nextDisabled: boolean;
  /** "03 / 12": the slide on air in its item. Null for an item of one slide. */
  counter: string | null;
}

/** Lower Third / Blackout / Hide Text, as the console's B, L and H keys run them. */
export const consoleOutputActions = {
  lowerThird: () => dispatch({ type: 'lowerThird/toggle' }),
  blackout: () => dispatch({ type: 'projector/blackout' }),
  hideText: () => dispatch({ type: 'projector/hideText' }),
} as const;

/**
 * The transport and output bar under the monitors: Back, Next Slide and the slide counter on the left; Lower Third, Blackout and Hide Text on
 * the right, each reading On or Off from the live state. While a lower third is on air its button splits, as the top bar's does, with Pause
 * (or Resume) as its second half.
 */
export function TransportBar({ onBack, onNext, backDisabled, nextDisabled, counter }: Props) {
  const t = useGoLiveT();
  const band = useLive((s) => s.state.lowerThird);
  const blackout = useLive((s) => s.state.projector.live.kind === 'blackout');
  const hidden = useLive((s) => s.state.projector.textHidden === true);
  const bandOn = band.live !== null;
  const state = (on: boolean) => t(on ? 'consoleOn' : 'consoleOff');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={backDisabled} onClick={onBack}>
          {t('consoleBack')}
        </button>
        <button type="button" className={`${BTN_PRIMARY} px-4`} disabled={nextDisabled} onClick={onNext}>
          {t('consoleNext')}
        </button>
        {counter && <span className="ml-1 font-mono text-xs text-muted tabular-nums">{counter}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {bandOn ? (
          <div role="group" aria-label={t('consoleLowerThird', { state: state(true) })} className="flex h-8 overflow-hidden rounded-lg border border-accent bg-accent/15 text-xs font-medium text-accent">
            <button type="button" aria-pressed aria-keyshortcuts="L" onClick={consoleOutputActions.lowerThird} className="px-3 transition hover:bg-accent/15 focus-visible:bg-accent/25 focus-visible:outline-none">
              {t('consoleLowerThird', { state: state(true) })}
            </button>
            <span aria-hidden className="my-1.5 w-px bg-accent/40" />
            <button
              type="button"
              aria-pressed={band.paused}
              title={t('consoleBandPauseTip')}
              onClick={() => dispatch({ type: 'lowerThird/pause' })}
              className={`flex items-center gap-1 px-2.5 transition focus-visible:outline-none ${band.paused ? 'bg-warn/15 font-semibold text-warn hover:bg-warn/25' : 'hover:bg-accent/15 focus-visible:bg-accent/25'}`}
            >
              {band.paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
              {t(band.paused ? 'consoleBandResume' : 'consoleBandPause')}
            </button>
          </div>
        ) : (
          <button type="button" aria-pressed={false} aria-keyshortcuts="L" disabled={band.staged === null} onClick={consoleOutputActions.lowerThird} className={BTN}>
            {t('consoleLowerThird', { state: state(false) })}
          </button>
        )}
        <button type="button" aria-pressed={blackout} aria-keyshortcuts="B" onClick={consoleOutputActions.blackout} className={blackout ? BTN_DANGER_ACTIVE : BTN}>
          {t('consoleBlackout', { state: state(blackout) })}
        </button>
        <button type="button" aria-pressed={hidden} aria-keyshortcuts="H" title={t('consoleHideTextTip')} onClick={consoleOutputActions.hideText} className={hidden ? BTN_ACTIVE : BTN}>
          {t('consoleHideText', { state: state(hidden) })}
        </button>
      </div>
    </div>
  );
}
