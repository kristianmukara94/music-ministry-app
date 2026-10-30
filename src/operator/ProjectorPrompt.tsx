import { useEffect } from 'react';
import { MonitorOff, Presentation, X } from 'lucide-react';
import { setUi, useUi } from '../state/ui';

/**
 * Shown when a live launch (a Mass Queue item or a Praise & Worship segment) finds the projector off. The operator can turn
 * the projector on and go live, skip to test in the app only, or cancel. Escape cancels too.
 */
export function ProjectorPrompt() {
  const prompt = useUi((s) => s.projectorPrompt);

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUi({ projectorPrompt: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt]);

  if (!prompt) return null;
  const dismiss = () => setUi({ projectorPrompt: null });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={dismiss}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="projector-prompt-title"
        aria-describedby="projector-prompt-message"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-accent/40 bg-panel p-6 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-accent/40 bg-accent/15 text-accent">
              <MonitorOff size={20} aria-hidden />
            </span>
            <h2 id="projector-prompt-title" className="text-lg font-bold tracking-tight text-fg">
              Projector is OFF
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/20 text-fg/60 hover:text-fg"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-1.5">
          <p id="projector-prompt-message" className="text-sm text-fg/80">
            Please turn on the projector before launching queue items to the display.
          </p>
          <p className="truncate text-xs font-semibold text-fg/50" title={prompt.label}>
            {prompt.label}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* 1. The main action. */}
          <button
            type="button"
            onClick={() => prompt.turnOnAndGo()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 hover:brightness-110"
          >
            <Presentation size={14} aria-hidden /> Turn On Projector &amp; Go Live
          </button>

          {/* 2. Test without the projector. Only offered where the item can go live in the app alone. */}
          {prompt.skip && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => prompt.skip?.()}
                className="flex h-11 w-full items-center justify-center rounded-lg border border-fg/30 bg-panel-2 px-4 text-xs font-bold tracking-wider text-fg uppercase hover:border-fg/50"
              >
                Skip, test without projector
              </button>
              <p className="text-center text-[11px] text-fg/50">
                Goes live in the app only. Won&apos;t ask again until you turn the projector on.
              </p>
            </div>
          )}

          {/* 3. Cancel: a text button on its own line. It changes nothing. */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={dismiss}
              className="h-9 px-3 text-xs font-bold tracking-wider text-fg/60 uppercase hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
