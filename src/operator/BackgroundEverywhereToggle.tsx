import { useState } from 'react';
import { Images } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';

/**
 * Apply staged background to all slides: the one switch for the Media Library's background behind every slide, the Live set's slides
 * included. It sits in the Media Library header and in the Live panel's background panel, and saves the same output setting as the
 * Projector settings page, so all three always agree.
 */
export function BackgroundEverywhereToggle({ compact = false }: { compact?: boolean }) {
  const on = useLive((s) => s.state.settings.backgroundEverywhere);
  const [error, setError] = useState<string | null>(null);
  const toggle = () => {
    setError(null);
    bridge.projector.save({ backgroundEverywhere: !on }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        title={
          on
            ? 'On: the background shows behind every slide, and a staged background goes on screen at once. Click to turn off.'
            : 'Off: the Live set keeps its own slide background. Click to show the Media Library background behind every slide.'
        }
        className={`inline-flex items-center gap-2 rounded-lg border px-3 font-bold tracking-wide uppercase transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
          compact ? 'h-8 text-[11px]' : 'h-9 text-xs'
        } ${on ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 bg-panel-2 text-fg/80 hover:border-accent/50 hover:text-fg'}`}
      >
        <Images size={14} aria-hidden />
        Apply staged background to all slides
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${on ? 'bg-accent text-on-accent' : 'bg-fg/10 text-muted'}`}>{on ? 'On' : 'Off'}</span>
      </button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
