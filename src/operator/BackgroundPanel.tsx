import { useEffect } from 'react';
import { X } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { BackgroundControls } from '../settings/BackgroundControls';
import { SLIDE_CANVAS_COLOR } from '../../shared/welcome-settings.js';

/**
 * The Live slide background panel. It opens inside the Live panel, above its bottom row (Back, Next slide, Background, Lower third, Blackout),
 * and closes with its × button, Escape, or the Background button again. It edits the Live slide background only: the title, prayer, lyric and
 * scripture slides. The Welcome background has its own controls on the Welcome settings page and is not changed from here. A change updates
 * the Current and Next slides, the Live preview and the projector as it is saved.
 */
export function BackgroundPanel({ onClose }: { onClose: () => void }) {
  // The Live slide background: saved on its own, and used only by the Live set's slides.
  const slide = useLive((s) => s.state.welcome.slideBackground);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section aria-label="Live slide background" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line-strong bg-panel-2 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black tracking-widest text-fg uppercase">Live slide background</h3>
          <p className="mt-0.5 text-xs text-muted">Behind the title, prayer, lyric and scripture slides.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close background" title="Close background" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-panel hover:text-fg">
          <X size={16} aria-hidden />
        </button>
      </header>
      <BackgroundControls value={slide} save={(patch) => bridge.welcome.save({ slideBackground: { ...slide, ...patch } })} unsetColor={SLIDE_CANVAS_COLOR} />
    </section>
  );
}
