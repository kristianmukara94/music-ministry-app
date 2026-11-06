import { useEffect } from 'react';
import { FileX, MonitorOff, PanelBottom } from 'lucide-react';
import { dispatch, useLive } from '../live/store';
import { quickLiveBand } from '../praise-worship/useQuickLiveController';
import { isTextEntry } from '../praise-worship/textEntry';
import type { LyT } from './strings';
import type { Hymn } from './types';

const BTN =
  'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-bold tracking-wide uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const OFF = 'border-fg/15 bg-panel-2 text-fg/80 hover:bg-fg/10 hover:text-fg';

/**
 * The Live Cues quick controls: Black Screen, Clear Text and the Lower 3rd switch. They run the same live actions as the top bar, so
 * every window sees the change. B and C work as keys while `keys` is on (Go Live is armed and no dialog is open), and never while typing.
 */
export function LiveQuickControls({ hymn, keys, t }: { hymn: Hymn | null; keys: boolean; t: LyT }) {
  const blackedOut = useLive((s) => s.state.projector.live.kind === 'blackout');
  const somethingOnScreen = useLive((s) => s.state.projector.live.kind !== 'idle');
  const lowerLive = useLive((s) => s.state.lowerThird.live !== null);
  const lowerStaged = useLive((s) => s.state.lowerThird.staged !== null);

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
    <div role="toolbar" aria-label={t('quickControls')} className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line p-3">
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
        disabled={!lowerLive && !hymn && !lowerStaged}
        title={t('lowerThirdHint')}
        className={`${BTN} ml-auto ${lowerLive ? 'border-accent bg-accent/20 text-accent' : OFF}`}
      >
        <PanelBottom size={13} aria-hidden /> {t('lowerThird')}
        <span aria-hidden className={`relative ml-0.5 h-3.5 w-6 rounded-full transition ${lowerLive ? 'bg-accent' : 'bg-fg/25'}`}>
          <span className={`absolute top-0.5 size-2.5 rounded-full bg-canvas transition-all ${lowerLive ? 'left-3' : 'left-0.5'}`} />
        </span>
      </button>
    </div>
  );
}
