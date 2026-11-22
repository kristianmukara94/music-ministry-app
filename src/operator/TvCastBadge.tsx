import { useEffect, useState } from 'react';
import { Cast } from 'lucide-react';
import { bridge } from '../live/bridge';
import { setUi } from '../state/ui';
import { topBarCastLabel } from '../../shared/tv-cast-view.js';

/** The number of TVs with a cast session, read every 2.5 seconds. Zero when the bridge has no TV cast (a plain browser). */
export function useCastingCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const read = () =>
      bridge.tvCast
        .status()
        .then((s) => alive && setCount(s.casting))
        .catch(() => alive && setCount(0));
    void read();
    const timer = window.setInterval(read, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return count;
}

/** The top bar badge while TVs are casting: `Casting · 2 TVs`. It opens Settings, Connections, Remote view. Nothing is drawn otherwise. */
export function TvCastBadge() {
  const label = topBarCastLabel(useCastingCount());
  if (!label) return null;
  return (
    <button
      type="button"
      onClick={() => setUi({ view: 'settings', settingsSection: 'remote' })}
      title="Nearby TV Cast is sending live slides. Open Remote view settings."
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ok/50 bg-ok/15 px-2.5 text-xs font-semibold whitespace-nowrap text-ok hover:bg-ok/25 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    >
      <Cast className="size-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
