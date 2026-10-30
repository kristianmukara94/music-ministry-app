import { useState } from 'react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { SLIDE_FONT_SCALES, SLIDE_FONTS, type ProjectorSettings } from '../../shared/projector-settings.js';
import { TEXT_FONTS, type TextFontFamily } from '../../shared/text-style.js';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// One row at the bottom bar's height, locked so it never shrinks or wraps. The font name is truncated rather than widening the row.
const ROW = 'flex min-w-0 shrink items-center gap-1';
// The font name truncates, and the select is narrow in a compact panel and wider in a roomy one (the panel's own container, not the window).
const SELECT = 'h-8 w-20 min-w-0 shrink truncate @3xl/pw:w-28 rounded-lg border border-fg/20 bg-panel-2 px-2 text-xs font-semibold text-fg/90 outline-none focus:border-accent';
const STEP =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-fg/20 bg-panel-2 text-xs font-extrabold text-fg/90 transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
const READOUT = 'inline-flex h-8 w-11 shrink-0 items-center justify-center whitespace-nowrap text-xs font-bold tabular-nums text-accent';

/**
 * The slide typography on the Live panel: the font, and the text size from 70% to 150%. Each change is saved with the projector
 * settings, so the projector, the TV and the thumbnails all follow it at once, and the Settings page shows the same choice.
 */
export function SlideTypography() {
  const settings = useLive((s) => s.state.settings);
  const [error, setError] = useState<string | null>(null);
  const index = SLIDE_FONT_SCALES.indexOf(settings.slideFontScale);

  const save = (patch: Partial<ProjectorSettings>) => {
    setError(null);
    bridge.projector.save(patch).catch((err) => setError(errorText(err)));
  };

  const step = (delta: number) => {
    const next = SLIDE_FONT_SCALES[index + delta];
    if (next !== undefined) save({ slideFontScale: next });
  };

  return (
    <div role="group" aria-label="Slide typography" className={ROW}>
      <select aria-label="Slide font" value={settings.slideFont ?? ''} onChange={(e) => save({ slideFont: e.target.value || null })} className={SELECT}>
        <option value="">Current look</option>
        {SLIDE_FONTS.map((key) => (
          <option key={key} value={key}>
            {TEXT_FONTS[key as TextFontFamily].label}
          </option>
        ))}
      </select>
      <button type="button" aria-label="Smaller text" onClick={() => step(-1)} disabled={index <= 0} className={STEP}>
        A−
      </button>
      <span aria-live="polite" className={READOUT}>
        {Math.round(settings.slideFontScale * 100)}%
      </span>
      <button type="button" aria-label="Larger text" onClick={() => step(1)} disabled={index >= SLIDE_FONT_SCALES.length - 1} className={STEP}>
        A+
      </button>
      {error && <span role="alert" className="whitespace-nowrap text-xs text-danger">{error}</span>}
    </div>
  );
}
