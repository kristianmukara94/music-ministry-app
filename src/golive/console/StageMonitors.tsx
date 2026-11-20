import type { ReactNode } from 'react';
import { useLive } from '../../live/store';
import { LowerThirdStage } from '../../output/LowerThirdView';
import { lyricBottomOf } from '../../../shared/lyric-area.js';
import { useGoLiveT } from '../strings';
import { EYEBROW, MONITOR } from './styles';

interface Props {
  /** The slide on air, drawn by the console with the projector's own components (PwSlideFace, FramePreview). */
  program: ReactNode;
  /** "Slide 03 of 12" over the program monitor, or null for an item of one slide. */
  counter: string | null;
  /** The slide Next puts up, or null at the end of the lineup. */
  next: ReactNode | null;
  /** The caption under the next monitor: "Up next: …", or the last-slide note. */
  upNext: string;
  /** Push Next: puts the next slide on screen (the link, and a click on the next monitor). Null when there is no next slide. */
  onPushNext: (() => void) | null;
  /** Under the welcome screen the program monitor shows the slide waiting under it, with this note. */
  coverNote?: string | null;
}

/**
 * The two stage monitors: CURRENT SLIDE · PROGRAM (7 parts) and NEXT SLIDE · PREVIEW (5 parts), side by side on a wide console and stacked on
 * a narrow one. The program monitor shows what the congregation sees: STAGE BLACKOUT ACTIVE under Blackout, LYRICS HIDDEN under Hide Text,
 * and the lower third's band in place while one is on air. A click on the next monitor (or Push Next) puts that slide up.
 */
export function StageMonitors({ program, counter, next, upNext, onPushNext, coverNote = null }: Props) {
  const t = useGoLiveT();
  const blackout = useLive((s) => s.state.projector.live.kind === 'blackout');
  const hidden = useLive((s) => s.state.projector.textHidden === true);
  const band = useLive((s) => s.state.lowerThird.live);
  const lyricBottom = useLive((s) => lyricBottomOf(s.state.projector.live));
  return (
    <div className="@container/monitors">
      <div className="grid grid-cols-1 gap-4 @2xl/monitors:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <figure className="flex min-w-0 flex-col gap-2">
          <figcaption className="flex items-center justify-between gap-2">
            <span className={`${EYEBROW} text-accent`}>{t('consoleProgram')}</span>
            {counter && <span className="font-mono text-[11px] text-muted tabular-nums">{counter}</span>}
          </figcaption>
          <div className={MONITOR} data-program-monitor>
            {program}
            {band && !blackout && (
              <div aria-hidden className="pointer-events-none absolute inset-0 z-20 [container-type:size]">
                <LowerThirdStage value={band} lyricBottomShare={lyricBottom} />
              </div>
            )}
            {blackout ? (
              <div role="status" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 bg-black text-center text-xs font-bold text-danger">
                <span>{t('consoleBlackoutOverlay')}</span>
                <span className="text-[11px] font-medium text-white/70">{t('consoleOverlayRestore', { key: 'B' })}</span>
              </div>
            ) : hidden ? (
              <div role="status" className="absolute inset-x-0 top-0 z-30 flex items-center justify-center gap-2 bg-black/80 px-2 py-1 text-center text-[11px] font-bold text-warn">
                <span>{t('consoleHiddenOverlay')}</span>
                <span className="font-medium text-white/70">{t('consoleOverlayRestore', { key: 'H' })}</span>
              </div>
            ) : null}
            {coverNote && !blackout && (
              <span className="absolute top-1.5 left-1.5 z-30 rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white">{coverNote}</span>
            )}
          </div>
          <p className="text-[11px] text-muted">{t('consoleShortcuts')}</p>
        </figure>
        <figure className="flex min-w-0 flex-col gap-2">
          <figcaption className="flex items-center justify-between gap-2">
            <span className={`${EYEBROW} text-muted`}>{t('consolePreview')}</span>
            {onPushNext && (
              <button type="button" onClick={onPushNext} title={t('consolePushNextTip')} className="rounded text-[11px] font-bold text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
                {t('consolePushNext')}
              </button>
            )}
          </figcaption>
          {next ? (
            <button
              type="button"
              onClick={onPushNext ?? undefined}
              disabled={!onPushNext}
              aria-label={`${t('consolePushNext')} ${upNext}`}
              className={`${MONITOR} block cursor-pointer text-left transition hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-default`}
            >
              <span className="pointer-events-none absolute inset-0">{next}</span>
            </button>
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-line p-3 text-center text-sm text-muted">{t('consoleEndOfRun')}</div>
          )}
          <p className="line-clamp-2 text-[11px] text-muted">{upNext}</p>
        </figure>
      </div>
    </div>
  );
}
