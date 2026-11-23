import { useEffect, useRef } from 'react';
import { Radio, X } from 'lucide-react';
import { lyricBottomOf } from '../../shared/lyric-area.js';
import { type QuickLiveSession, heldFrame, quickLiveCounter, quickLiveIndex, quickLiveJumpAction, quickLiveJumpItems, quickLiveNextFrame, quickLiveShouldClose, quickLiveStepAction } from '../../shared/quick-live.js';
import { NO_DRAG, DRAG, TITLE_BAR_CLEARANCE } from '../components/appRegion';
import { dispatch, useLive } from '../live/store';
import { FramePreview } from '../output/ProjectorView';
import { LowerThirdStage } from '../output/LowerThirdView';
import { isTextEntry } from '../praise-worship/textEntry';
import { BTN, BTN_PRIMARY, EYEBROW, MONITOR } from './console/styles';
import { restoreMainLive } from './mainLive';
import { closeQuickLivePreview, exitQuickLivePreview, useQuickLivePreview } from './quickLiveSession';
import { useGoLiveT } from './strings';

/** Every control in the popup: clickable over the frameless window's drag regions (see appRegion.ts), whatever sits under it. */
const CONTROL = 'pointer-events-auto no-drag';

/** Leaves the popup: the parked run comes back, or the item comes off the screen. */
const exit = () => void exitQuickLivePreview(restoreMainLive).catch((err) => window.alert(err instanceof Error ? err.message : String(err)));

/** Back (-1) or Next (+1) through the item on air. Read from the live state at the press, so a key held down never steps from a stale place. */
function step(delta: 1 | -1) {
  const action = quickLiveStepAction(useQuickLivePreview.getState().session, useLive.getState().state.projector, delta);
  if (action) dispatch(action);
}

/** A slide jump pill: that slide of the song as a direct show. Read from the live state at the press. */
function jump(index: number) {
  const action = quickLiveJumpAction(useQuickLivePreview.getState().session, useLive.getState().state.projector, index);
  if (action) dispatch(action);
}

/**
 * The Quick-Live Mini Output Preview: a compact card that opens when a library LIVE button puts a song, prayer, reading or passage on the
 * projector. Two 16:9 monitors (the slide on air, drawn as the projector draws it, and the next one), Back and Next, and one way out: Return to
 * Main Live when the LIVE press parked the Holy Mass or a Praise & Worship lineup, End Live & Close otherwise. The × and Escape do the same.
 * The Planner stays in sight behind a light backdrop. The popup closes by itself when a main run is back on air (the top bar's Back to Main
 * Live, the Go Live console), so it never lingers over the run.
 */
export function QuickLivePreview() {
  const t = useGoLiveT();
  const session = useQuickLivePreview((s) => s.session);
  const live = useLive((s) => s.state);
  const index = quickLiveIndex(session, live.projector);

  // The popup has seen its item on air: from then on a main run on air means the operator went back to it some other way.
  // Held per session, so a new LIVE press over the open popup waits to see its own item.
  const seenFor = useRef<QuickLiveSession | null>(null);
  if (index >= 0) seenFor.current = session;
  const close = quickLiveShouldClose(session, live, session !== null && seenFor.current === session);
  useEffect(() => {
    if (close) closeQuickLivePreview();
  }, [close]);

  // ← / → (and a clicker's Page Up / Page Down) step the item; Escape leaves. Typing keeps its keys, and a dialog over the popup keeps them too.
  const open = session !== null;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      if (dialogs.some((d) => !d.hasAttribute('data-quick-live'))) return;
      let act: (() => void) | null = null;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') act = () => step(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') act = () => step(-1);
      else if (e.key === 'Escape' && !e.repeat) act = exit;
      if (!act) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      act();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!session) return null;

  const current = index >= 0 ? heldFrame(live.projector) : null;
  const next = quickLiveNextFrame(session, live.projector);
  const counter = quickLiveCounter(session, live.projector);
  const atStart = index <= 0;
  const atEnd = index < 0 || next === null;
  const blackout = live.projector.live.kind === 'blackout';
  const hidden = live.projector.textHidden === true;
  const band = live.lowerThird.live;
  const pills = quickLiveJumpItems(session, live.projector);
  const parkedNote = session.parked === 'mass' ? t('quickLiveParkedMass') : session.parked === 'pw' ? t('quickLiveParkedPw') : t('quickLiveIdle');

  return (
    <div data-quick-live-backdrop className="fixed inset-0 z-50 flex flex-col bg-black/40 pointer-events-auto" style={NO_DRAG}>
      {/* The caption strip stays a window handle, as over the other studios; the card sits below it. */}
      <div aria-hidden className="app-drag shrink-0" style={{ ...DRAG, height: TITLE_BAR_CLEARANCE }} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 pb-4">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-live-title"
          data-quick-live
          data-testid="quick-live-preview"
          className={`${CONTROL} w-full max-w-[680px] rounded-xl border border-accent/40 bg-surface shadow-2xl`}
          style={NO_DRAG}
        >
          <header className="flex items-start gap-3 border-b border-line px-4 py-3">
            <Radio size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className={`${EYEBROW} text-accent`}>{t('quickLiveKicker')}</p>
              <h2 id="quick-live-title" className="truncate text-base font-bold text-fg" title={session.title}>
                {session.title || t('quickLiveTitle')}
              </h2>
              <p className="text-[11px] text-muted">{t('quickLiveTitle')}</p>
            </div>
            <button
              type="button"
              onClick={exit}
              aria-label={t('quickLiveClose')}
              title={`${t('quickLiveClose')} (Esc)`}
              data-testid="quick-live-close"
              className={`${CONTROL} grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-panel-2 text-fg/80 transition hover:border-fg/30 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none`}
              style={NO_DRAG}
            >
              <X size={16} aria-hidden />
            </button>
          </header>

          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <figure className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="flex items-center justify-between gap-2">
                <span className={`${EYEBROW} text-accent`}>{t('quickLiveCurrent')}</span>
                {counter && (
                  <span data-testid="quick-live-counter" className="font-mono text-[11px] text-muted tabular-nums">
                    {counter}
                  </span>
                )}
              </figcaption>
              <div className={MONITOR} data-quick-live-current>
                {current ? (
                  <FramePreview frame={current} />
                ) : (
                  <div className="grid h-full w-full place-items-center p-3 text-center text-xs text-muted">{t('quickLiveOffAir')}</div>
                )}
                {current && band && !blackout && (
                  <div aria-hidden className="pointer-events-none absolute inset-0 z-20 [container-type:size]">
                    <LowerThirdStage value={band} lyricBottomShare={lyricBottomOf(live.projector.live)} />
                  </div>
                )}
                {current && blackout ? (
                  <div role="status" className="absolute inset-0 z-30 grid place-items-center bg-black text-xs font-bold text-danger">
                    {t('quickLiveBlackout')}
                  </div>
                ) : current && hidden ? (
                  <div role="status" className="absolute inset-x-0 top-0 z-30 bg-black/80 px-2 py-1 text-center text-[11px] font-bold text-warn">
                    {t('quickLiveHidden')}
                  </div>
                ) : null}
                {current && (
                  <span className="absolute top-1.5 left-1.5 z-30 rounded-full bg-danger px-2 py-0.5 text-[10px] font-black tracking-wider text-white">
                    {t('quickLiveLive')}
                  </span>
                )}
              </div>
            </figure>

            <figure className="flex min-w-0 flex-col gap-1.5">
              <figcaption className={`${EYEBROW} text-muted`}>{t('quickLiveNext')}</figcaption>
              {next ? (
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={t('quickLivePushNext')}
                  title={t('quickLivePushNext')}
                  data-testid="quick-live-next-monitor"
                  className={`${CONTROL} ${MONITOR} block cursor-pointer text-left transition hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none`}
                  style={NO_DRAG}
                >
                  <span className="pointer-events-none absolute inset-0">
                    <FramePreview frame={next} />
                  </span>
                </button>
              ) : (
                <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-line p-3 text-center text-sm text-muted">
                  {t('quickLiveEndOfItem')}
                </div>
              )}
            </figure>
          </div>

          {pills.length > 0 && (
            <nav aria-label={t('quickLiveJump')} data-testid="quick-live-jump" className={`${CONTROL} flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5`} style={NO_DRAG}>
              {pills.map((p) => (
                <button
                  key={p.index}
                  type="button"
                  onClick={() => jump(p.index)}
                  aria-current={p.current ? 'true' : undefined}
                  data-testid="quick-live-jump-pill"
                  className={`${CONTROL} rounded-full border px-2.5 py-1 text-[11px] font-bold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${p.current ? 'border-accent bg-accent text-black' : 'border-line bg-panel-2 text-fg/80 hover:border-accent/60 hover:text-fg'}`}
                  style={NO_DRAG}
                >
                  {p.label}
                </button>
              ))}
            </nav>
          )}

          <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <button type="button" onClick={() => step(-1)} disabled={atStart} data-testid="quick-live-back" className={`${CONTROL} ${BTN}`} style={NO_DRAG}>
              {t('quickLiveBack')}
            </button>
            <button type="button" onClick={() => step(1)} disabled={atEnd} data-testid="quick-live-next" className={`${CONTROL} ${BTN_PRIMARY}`} style={NO_DRAG}>
              {t('quickLiveNextBtn')}
            </button>
            <span className="hidden text-[11px] text-muted sm:inline">{t('quickLiveKeys')}</span>
            <button
              type="button"
              onClick={exit}
              data-testid="quick-live-exit"
              className={`${CONTROL} ${session.parked ? BTN_PRIMARY : BTN} ml-auto`}
              style={NO_DRAG}
            >
              {session.parked ? t('quickLiveReturn') : t('quickLiveEnd')}
            </button>
            <p className="w-full text-[11px] text-muted">{parkedNote}</p>
          </footer>
        </section>
      </div>
    </div>
  );
}
