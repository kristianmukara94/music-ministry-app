import { useEffect, useState } from 'react';
import { AArrowDown, AArrowUp, FileX, MonitorOff, PanelBottom } from 'lucide-react';
import { SLIDE_FONT_SCALES } from '../../shared/projector-settings.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { useProjectionLocked } from '../live/license';
import { quickLiveBand } from '../praise-worship/useQuickLiveController';
import { isTextEntry } from '../praise-worship/textEntry';
import type { LyT } from './strings';
import type { Hymn } from './types';

const BTN =
  'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-bold tracking-wide uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const OFF = 'border-fg/15 bg-panel-2 text-fg/80 hover:bg-fg/10 hover:text-fg';
const STEP =
  'grid size-8 place-items-center rounded-md border border-fg/15 bg-panel-2 text-fg/80 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

/**
 * The slide text size, from 70% to 150%. It is the projector setting the Holy Mass and Praise & Worship consoles step too (slideFontScale), so
 * the projector, the TV and every preview follow it at once. It never changes the song in the library.
 */
function FontSizeStepper({ t }: { t: LyT }) {
  const scale = useLive((s) => s.state.settings.slideFontScale);
  const [error, setError] = useState<string | null>(null);
  const index = SLIDE_FONT_SCALES.indexOf(scale);
  const step = (delta: number) => {
    const next = SLIDE_FONT_SCALES[index + delta];
    if (next === undefined) return;
    setError(null);
    bridge.projector.save({ slideFontScale: next }).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div role="group" aria-label={t('fontSize')} title={error ?? t('fontSize')} className="flex items-center gap-1">
      <button type="button" onClick={() => step(-1)} disabled={index <= 0} aria-label={t('fontSmaller')} title={t('fontSmaller')} className={STEP}>
        <AArrowDown size={15} aria-hidden />
      </button>
      <span aria-live="polite" className={`w-10 text-center font-mono text-[11px] font-bold tabular-nums ${error ? 'text-danger' : 'text-accent'}`}>
        {Math.round(scale * 100)}%
      </span>
      <button type="button" onClick={() => step(1)} disabled={index >= SLIDE_FONT_SCALES.length - 1} aria-label={t('fontLarger')} title={t('fontLarger')} className={STEP}>
        <AArrowUp size={15} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The Live Cues emergency bar: Blackout, Clear Text, the Lower 3rd switch and the slide text size. They run the same live actions as the top
 * bar, so every window sees the change. B and C work as keys while `keys` is on (Go Live is armed and no dialog is open), and never while typing.
 */
export function LiveQuickControls({ hymn, keys, t }: { hymn: Hymn | null; keys: boolean; t: LyT }) {
  const blackedOut = useLive((s) => s.state.projector.live.kind === 'blackout');
  const somethingOnScreen = useLive((s) => s.state.projector.live.kind !== 'idle');
  const lowerLive = useLive((s) => s.state.lowerThird.live !== null);
  const lowerStaged = useLive((s) => s.state.lowerThird.staged !== null);
  const locked = useProjectionLocked();

  const blackout = () => dispatch({ type: 'projector/blackout' });
  const clearText = () => dispatch({ type: 'projector/clear' });
  /** On: shows a band naming the open song (or the one already staged). Off: takes the band down and keeps it staged. */
  const toggleLower = () => {
    if (!lowerLive && hymn) dispatch({ type: 'lowerThird/stage', value: quickLiveBand(hymn) });
    dispatch({ type: 'lowerThird/toggle' });
  };

  useEffect(() => {
    if (!keys) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        dispatch({ type: 'projector/blackout' });
      } else if (key === 'c') {
        e.preventDefault();
        dispatch({ type: 'projector/clear' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);

  return (
    <div role="toolbar" aria-label={t('quickControls')} className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-canvas/40 p-3">
      <button
        type="button"
        onClick={blackout}
        aria-pressed={blackedOut}
        aria-keyshortcuts={keys ? 'B' : undefined}
        title={keys ? `${t('blackout')} (B)` : t('blackout')}
        className={`${BTN} ${blackedOut ? 'border-warn bg-warn/20 text-warn' : OFF}`}
      >
        <MonitorOff size={13} aria-hidden /> {t('blackout')}
        {keys && <span className="kbd">B</span>}
      </button>
      <button
        type="button"
        onClick={clearText}
        disabled={!somethingOnScreen}
        aria-keyshortcuts={keys ? 'C' : undefined}
        title={keys ? `${t('clearText')} (C)` : t('clearText')}
        className={`${BTN} ${OFF}`}
      >
        <FileX size={13} aria-hidden /> {t('clearText')}
        {keys && <span className="kbd">C</span>}
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={lowerLive}
        onClick={toggleLower}
        disabled={!lowerLive && (locked || (!hymn && !lowerStaged))}
        title={t('lowerThirdHint')}
        className={`${BTN} ${lowerLive ? 'border-accent bg-accent/20 text-accent' : OFF}`}
      >
        <PanelBottom size={13} aria-hidden /> {t('lowerThird')}
        <span aria-hidden className={`relative ml-0.5 h-3.5 w-6 rounded-full transition ${lowerLive ? 'bg-accent' : 'bg-fg/25'}`}>
          <span className={`absolute top-0.5 size-2.5 rounded-full bg-canvas transition-all ${lowerLive ? 'left-3' : 'left-0.5'}`} />
        </span>
      </button>
      <div className="ml-auto">
        <FontSizeStepper t={t} />
      </div>
    </div>
  );
}
