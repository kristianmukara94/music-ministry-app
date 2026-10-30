import { useState } from 'react';
import { ChevronDown, Eraser, MonitorPlay, Send } from 'lucide-react';
import type { LowerThird, LowerThirdTemplate } from '../../shared/live.js';
import { dispatch, useLive } from '../live/store';
import { LowerThirdStage } from '../output/LowerThirdView';

/** The three layouts. Field labels say what each line is for, so the operator knows what to type. */
const TEMPLATES: { id: LowerThirdTemplate; label: string; line1Label: string; line2Label: string | null }[] = [
  { id: 'nameplate', label: 'Nameplate', line1Label: 'Name', line2Label: 'Role or ministry' },
  { id: 'intention', label: 'Mass intention', line1Label: 'Intention', line2Label: 'Requested by' },
  { id: 'response', label: 'Response', line1Label: 'Response, e.g. R: And with your spirit', line2Label: null },
];

const input = 'h-10 w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';
const button =
  'flex h-9 items-center gap-2 rounded-md px-4 text-xs font-bold tracking-wide uppercase transition disabled:cursor-not-allowed disabled:opacity-40';

/** Whether the editor is open is remembered on this machine. A failed read or write just keeps it closed. */
const OPEN_KEY = 'apccmma.media.lowerThirdOpen';
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Lower third editor. Type the lines, check the preview, then show. The preview uses the same layout as the
 * output, so what the operator sees is what the screen gets. Nothing reaches the output until Show.
 * It is folded away until it is needed, so the media library stays the first thing on the page.
 */
export function LowerThirdDeck() {
  const live = useLive((s) => s.state.lowerThird.live);
  const [open, setOpen] = useState(readOpen);
  const [template, setTemplate] = useState<LowerThirdTemplate>('nameplate');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');

  const config = TEMPLATES.find((t) => t.id === template) ?? TEMPLATES[0];
  const value: LowerThird | null = line1.trim()
    ? { template, line1: line1.trim(), ...(config.line2Label && line2.trim() ? { line2: line2.trim() } : {}) }
    : null;

  const show = () => {
    if (value) dispatch({ type: 'lowerThird/show', value });
  };
  const clear = () => dispatch({ type: 'lowerThird/clear' });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* the choice is simply not remembered */
    }
  };

  return (
    <section aria-label="Lower third editor" className="rounded-[10px] border border-line bg-panel">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="lower-third-editor"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
          <MonitorPlay size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold tracking-wider text-fg/60 uppercase">Lower third</span>
          <span className="block truncate text-sm font-bold text-fg">
            {live ? `Showing: ${live.line1}` : 'Show a name, a Mass intention or a response on the screen'}
          </span>
        </span>
        {live && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-ok/60 bg-ok/15 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-ok uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
            Live
          </span>
        )}
        <ChevronDown size={18} aria-hidden className={`shrink-0 text-fg/60 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id="lower-third-editor" className="border-t border-line p-4">
          <div role="radiogroup" aria-label="Template" className="mb-4 flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={template === t.id}
                onClick={() => setTemplate(t.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  template === t.id ? 'border-accent/50 bg-accent/15 text-accent' : 'border-fg/15 text-fg/70 hover:bg-fg/10 hover:text-fg'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-fg/70">{config.line1Label}</span>
                <input value={line1} onChange={(e) => setLine1(e.target.value)} maxLength={160} className={input} />
              </label>
              {config.line2Label && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-fg/70">{config.line2Label}</span>
                  <input value={line2} onChange={(e) => setLine2(e.target.value)} maxLength={160} className={input} />
                </label>
              )}

              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={show} disabled={!value} className={`${button} border border-ok bg-ok text-canvas shadow-md hover:brightness-110`}>
                  <Send size={14} aria-hidden /> Show
                </button>
                <button type="button" onClick={clear} disabled={!live} className={`${button} border border-fg/15 bg-panel-2 text-fg/85 hover:bg-fg/10`}>
                  <Eraser size={14} aria-hidden /> Clear
                </button>
              </div>
            </div>

            <div
              aria-label="Lower third preview"
              className="relative aspect-video overflow-hidden rounded-[10px] border border-line bg-gradient-to-br from-[#3a1020] to-[#100306] [container-type:inline-size]"
            >
              {value ? <LowerThirdStage value={value} /> : <p className="absolute inset-0 grid place-items-center text-xs text-white/50">Type a line to preview it.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
