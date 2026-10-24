import { useState } from 'react';
import { Eraser, Send } from 'lucide-react';
import type { LowerThird, LowerThirdTemplate } from '../../shared/live.js';
import { dispatch, useLive } from '../live/store';
import { LowerThirdStage } from '../output/LowerThirdView';

/** The three layouts. Field labels say what each line is for, so the operator knows what to type. */
const TEMPLATES: { id: LowerThirdTemplate; label: string; line1Label: string; line2Label: string | null }[] = [
  { id: 'nameplate', label: 'Nameplate', line1Label: 'Name', line2Label: 'Role or ministry' },
  { id: 'intention', label: 'Mass intention', line1Label: 'Intention', line2Label: 'Requested by' },
  { id: 'response', label: 'Response', line1Label: 'Response, e.g. R: And with your spirit', line2Label: null },
];

const input = 'h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';
const button =
  'flex h-9 items-center gap-2 rounded-md px-4 text-xs font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Lower third editor. Type the lines, check the preview, then show. The preview uses the same layout as the
 * output, so what the operator sees is what the screen gets. Nothing reaches the output until Show.
 */
export function LowerThirdDeck() {
  const live = useLive((s) => s.state.lowerThird.live);
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

  return (
    <section aria-label="Lower third editor" className="rounded-xl border border-line bg-panel p-4 backdrop-blur-md">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-widest text-fg/50 uppercase">Lower third</div>
          <h2 className="text-sm font-bold text-fg">Template editor</h2>
        </div>
        <div role="radiogroup" aria-label="Template" className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={template === t.id}
              onClick={() => setTemplate(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                template === t.id ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line text-fg/70 hover:bg-white/5 hover:text-fg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

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
            <button type="button" onClick={show} disabled={!value} className={`${button} bg-emerald-600 text-white shadow-md hover:bg-emerald-500`}>
              <Send size={14} aria-hidden /> Show
            </button>
            <button type="button" onClick={clear} disabled={!live} className={`${button} border border-line-strong hover:bg-panel-2`}>
              <Eraser size={14} aria-hidden /> Clear
            </button>
          </div>
        </div>

        <div
          aria-label="Lower third preview"
          className="relative aspect-video overflow-hidden rounded-md border border-line bg-gradient-to-br from-[#3a1020] to-[#100306] [container-type:inline-size]"
        >
          {value ? <LowerThirdStage value={value} /> : <p className="absolute inset-0 grid place-items-center text-xs text-muted">Type a line to preview it.</p>}
        </div>
      </div>
    </section>
  );
}
