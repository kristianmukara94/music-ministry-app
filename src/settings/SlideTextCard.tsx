import { useEffect, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { PROJECTOR_SETTINGS_DEFAULTS as DEFAULTS, SLIDE_FONT_SCALES, SLIDE_FONTS, type ProjectorSettings as Settings } from '../../shared/projector-settings.js';
import { TEXT_FONT_GROUPS, TEXT_FONTS, slideFontCss } from '../../shared/text-style.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { Card, FOCUS, SUB } from './settingsUi';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const STEP = `grid size-9 shrink-0 place-items-center rounded-lg border border-fg/20 bg-panel-2 text-fg/90 transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;

/**
 * How big, and in what font, slide text is drawn. The choice is the projector's own setting, so it reaches every projected slide:
 * lyrics, readings, prayers and announcements. The pages that show this card say what it means for their own content in `note`.
 * `sample` is the text drawn in the preview, so the preview looks like what the page is about.
 */
export function SlideTextCard({ id, sample, note }: { id: string; sample: string[]; note: string }) {
  const settings = useLive((s) => s.state.settings);
  const [scaleDraft, setScaleDraft] = useState(settings.slideFontScale);
  const [error, setError] = useState<string | null>(null);

  // The slider follows the saved size when it changes from somewhere else, such as the Live panel's A− and A+.
  useEffect(() => setScaleDraft(settings.slideFontScale), [settings.slideFontScale]);

  const save = (patch: Partial<Settings>) => {
    setError(null);
    bridge.projector.save(patch).catch((err) => setError(errorText(err)));
  };

  const index = Math.max(0, SLIDE_FONT_SCALES.indexOf(scaleDraft));
  const last = SLIDE_FONT_SCALES.length - 1;
  const stepTo = (next: number) => {
    const scale = SLIDE_FONT_SCALES[Math.min(last, Math.max(0, next))];
    setScaleDraft(scale);
    save({ slideFontScale: scale });
  };
  const isDefault = settings.slideFont === DEFAULTS.slideFont && settings.slideFontScale === DEFAULTS.slideFontScale;

  return (
    <Card
      id={id}
      title="Slide text"
      detail="The font and size of the words on the projector. It applies to all projected text, whatever the page."
      action={
        <button
          type="button"
          onClick={() => save({ slideFont: DEFAULTS.slideFont, slideFontScale: DEFAULTS.slideFontScale })}
          disabled={isDefault}
          className={`flex shrink-0 items-center gap-1.5 rounded text-[11px] font-bold tracking-wider whitespace-nowrap text-fg/60 uppercase transition-colors hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:text-fg/60 ${FOCUS}`}
        >
          <RotateCcw size={12} aria-hidden /> Reset to defaults
        </button>
      }
    >
      {/* A slide in miniature. Its type is sized as a share of its width, as the projector sizes it, so the preview is true at any window size. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div role="img" aria-label="Preview of a slide at the chosen font and size" className="aspect-video w-full overflow-hidden rounded-lg border border-line bg-black" style={{ containerType: 'inline-size' }}>
          <div className="grid h-full place-items-center p-[6%] text-center text-white" style={{ fontFamily: slideFontCss(settings.slideFont), fontSize: `${4.2 * scaleDraft}cqw`, lineHeight: 1.3 }}>
            <p>
              {sample.map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-fg">Font</span>
            <select
              value={settings.slideFont ?? ''}
              onChange={(e) => save({ slideFont: e.target.value || null })}
              className={`h-10 rounded-lg border border-fg/20 bg-panel px-3 text-sm text-fg outline-none focus:border-accent ${FOCUS}`}
            >
              <option value="">Keep each slide's own look</option>
              {TEXT_FONT_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.keys.filter((key) => SLIDE_FONTS.includes(key)).map((key) => (
                    <option key={key} value={key}>{TEXT_FONTS[key].label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-fg">Text size</span>
              <span aria-live="polite" className="rounded-full border border-accent/30 bg-panel px-2.5 py-1 font-mono text-xs font-semibold text-accent tabular-nums">
                {Math.round(scaleDraft * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Smaller text" onClick={() => stepTo(index - 1)} disabled={index <= 0} className={STEP}>
                <Minus size={15} aria-hidden />
              </button>
              <input
                type="range"
                min={0}
                max={last}
                step={1}
                value={index}
                aria-label="Slide text size"
                aria-valuetext={`${Math.round(scaleDraft * 100)} percent`}
                onChange={(e) => setScaleDraft(SLIDE_FONT_SCALES[Number(e.target.value)])}
                onPointerUp={() => save({ slideFontScale: scaleDraft })}
                onKeyUp={() => save({ slideFontScale: scaleDraft })}
                onBlur={() => scaleDraft !== settings.slideFontScale && save({ slideFontScale: scaleDraft })}
                className={`h-1.5 min-w-0 flex-1 cursor-pointer accent-accent ${FOCUS}`}
              />
              <button type="button" aria-label="Larger text" onClick={() => stepTo(index + 1)} disabled={index >= last} className={STEP}>
                <Plus size={15} aria-hidden />
              </button>
            </div>
            <div className="flex justify-between font-mono text-[10px] text-fg/50" aria-hidden>
              <span>{Math.round(SLIDE_FONT_SCALES[0] * 100)}%</span>
              <span>100%</span>
              <span>{Math.round(SLIDE_FONT_SCALES[last] * 100)}%</span>
            </div>
          </div>
          <p className={SUB}>{note}</p>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Card>
  );
}
