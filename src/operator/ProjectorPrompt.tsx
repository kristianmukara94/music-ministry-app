import { useEffect } from 'react';
import { MonitorOff, Presentation, X } from 'lucide-react';
import { setUi, useUi } from '../state/ui';

/**
 * Shown when a Mass Queue item is played while the projector is off. Nothing goes live until the operator either turns
 * the projector on and goes live, or dismisses the prompt. Escape dismisses it too.
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
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-amber-500/40 bg-stone-950 p-6 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-300">
              <MonitorOff size={20} aria-hidden />
            </span>
            <h2 id="projector-prompt-title" className="text-lg font-black tracking-wider text-stone-100 uppercase">
              Projector is OFF
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-stone-700 text-stone-400 hover:text-stone-100"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <p id="projector-prompt-message" className="text-sm text-stone-300">
          Please turn on the projector before launching queue items to the display.
        </p>
        <p className="truncate text-xs font-semibold text-stone-500" title={prompt.label}>
          {prompt.label}
        </p>

        <footer className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="flex h-10 items-center rounded-lg border border-stone-700 bg-stone-900 px-4 text-xs font-bold tracking-wider text-stone-200 uppercase hover:border-stone-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => prompt.turnOnAndGo()}
            className="flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-4 text-xs font-bold tracking-wider text-stone-950 uppercase shadow-md shadow-amber-950/40 hover:bg-amber-400"
          >
            <Presentation size={14} aria-hidden /> Turn On Projector &amp; Go Live
          </button>
        </footer>
      </div>
    </div>
  );
}
