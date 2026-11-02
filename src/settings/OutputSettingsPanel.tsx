import { useEffect, useState, type CSSProperties } from 'react';
import { Zap } from 'lucide-react';
import { FADE_MAX_MS, FADE_MIN_MS, SLIDE_FONTS, SLIDE_FONT_SCALES, type ProjectorSettings as Settings } from '../../shared/projector-settings.js';
import { TEXT_COLORS, TEXT_FONT_GROUPS, TEXT_FONTS, slideFontCss } from '../../shared/text-style.js';
import { CARD, CardHeader, FOCUS, GoldSwitch, Row, SUB, Segmented } from './settingsControls';
import { useInstantSetting } from './useInstantSetting';

const TRANSITIONS: { id: Settings['transitionStyle']; text: string }[] = [
  { id: 'fade', text: 'Fade' },
  { id: 'dissolve', text: 'Dissolve' },
  { id: 'push', text: 'Push' },
  { id: 'slideLeft', text: 'Slide left' },
  { id: 'slideRight', text: 'Slide right' },
  { id: 'slideUp', text: 'Slide up' },
  { id: 'zoomIn', text: 'Zoom in' },
];

const TRANSITION_DETAIL: Record<Settings['transitionStyle'], string> = {
  fade: 'The new slide fades in.',
  dissolve: 'The old slide fades out as the new one fades in.',
  push: 'The new slide pushes the old one off to the left.',
  slideLeft: 'The new slide slides in from the right.',
  slideRight: 'The new slide slides in from the left.',
  slideUp: 'The new slide rises into place.',
  zoomIn: 'The new slide grows into place.',
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

interface Props {
  settings: Settings;
  save: (patch: Partial<Settings>) => Promise<boolean>;
  isDefault: (...keys: (keyof Settings)[]) => boolean;
  resetTo: (...keys: (keyof Settings)[]) => void;
}

/** A 0 to 1 slider that saves when it is let go, not on every step, so dragging it does not send a save per pixel. */
function UnitSlider({ label, value, disabled, onSave }: { label: string; value: number; disabled: boolean; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onSave(draft);
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={draft}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={percent(draft)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className={`h-1.5 w-40 cursor-pointer accent-accent disabled:cursor-not-allowed ${FOCUS}`}
      />
      <span className="w-10 text-right font-mono text-xs text-accent tabular-nums">{percent(draft)}</span>
    </div>
  );
}

/**
 * How the output looks and moves: the transitions between slides, the slide font and size, the Media Library background on every slide, and
 * Advanced mode, which draws one text colour, shadow and outline over every slide. Each change saves at once and reaches the projector,
 * the operator's mirror and the previews through the live state.
 */
export function OutputSettingsPanel({ settings, save, isDefault, resetTo }: Props) {
  const [fadeDraft, setFadeDraft] = useState(settings.fadeMs);
  // The slider follows the saved duration when it changes from somewhere else.
  useEffect(() => setFadeDraft(settings.fadeMs), [settings.fadeMs]);
  const advanced = settings.advancedOutput;
  // The colour picker shows each colour on the projector as it is dragged, and writes the settings file once it is still (see useInstantSetting).
  const colour = useInstantSetting(save);
  /** A swatch or Keep is one click: it drops a colour still waiting from the picker, so that one never lands after it. */
  const pickColour = (textColor: string | null) => {
    colour.cancel();
    void save({ textColor });
  };

  return (
    <>
      {/* Transitions: how projected content changes. */}
      <section className={CARD} aria-labelledby="transitions-heading">
        <CardHeader
          id="transitions-heading"
          title="Transitions"
          detail="Control how projected content changes between slides and passages."
          onReset={() => resetTo('transitionsOn', 'transitionStyle', 'fadeMs')}
          resetDisabled={isDefault('transitionsOn', 'transitionStyle', 'fadeMs')}
        />
        <Row title="Use transitions" detail="Animate changes on the preview and projector when supported.">
          <GoldSwitch label="Use transitions" on={settings.transitionsOn} onChange={(transitionsOn) => void save({ transitionsOn })} />
        </Row>
        <Row title="Transition style" detail={settings.transitionsOn ? TRANSITION_DETAIL[settings.transitionStyle] : 'Turn transitions on to choose a style.'} stacked>
          <Segmented label="Transition style" value={settings.transitionStyle} disabled={!settings.transitionsOn} options={TRANSITIONS} onChange={(transitionStyle) => void save({ transitionStyle })} />
        </Row>
        <div className={`flex flex-col gap-2 border-t border-line pt-4 ${settings.transitionsOn ? '' : 'opacity-40'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-fg">Transition duration</div>
              <div className={SUB}>Shorter feels snappier, longer feels smoother. Editing the words on screen never animates.</div>
            </div>
            <span className="rounded-full border border-accent/30 bg-panel px-2.5 py-1 font-mono text-xs font-semibold text-accent tabular-nums">{fadeDraft}ms</span>
          </div>
          <input
            type="range"
            min={FADE_MIN_MS}
            max={FADE_MAX_MS}
            step={50}
            value={fadeDraft}
            disabled={!settings.transitionsOn}
            aria-label="Transition duration in milliseconds"
            onChange={(e) => setFadeDraft(Number(e.target.value))}
            onPointerUp={() => void save({ fadeMs: fadeDraft })}
            onKeyUp={() => void save({ fadeMs: fadeDraft })}
            onBlur={() => fadeDraft !== settings.fadeMs && void save({ fadeMs: fadeDraft })}
            className={`h-1.5 w-full cursor-pointer accent-accent disabled:cursor-not-allowed ${FOCUS}`}
          />
          <div className="flex justify-between font-mono text-[10px] text-fg/50" aria-hidden>
            <span>{FADE_MIN_MS}ms</span>
            <span>{FADE_MAX_MS}ms</span>
          </div>
        </div>
      </section>

      {/* The Media Library background on every slide. */}
      <section className={CARD} aria-labelledby="shared-bg-heading">
        <CardHeader id="shared-bg-heading" title="Background on every slide" onReset={() => resetTo('backgroundEverywhere')} resetDisabled={isDefault('backgroundEverywhere')} />
        <Row
          title="Media Library background behind all slides"
          detail="The picture or video taken from the Media Library shows behind the Live set's slides too, in place of their Live slide background. A background staged while this is on goes on screen at once. A slide with its own picture still shows it."
        >
          <GoldSwitch label="Media Library background behind all slides" on={settings.backgroundEverywhere} onChange={(backgroundEverywhere) => void save({ backgroundEverywhere })} />
        </Row>
      </section>

      {/* Slide font and size: the face and size for slide text on the projector and the TV. */}
      <section className={`${CARD} lg:col-span-2`} aria-labelledby="font-heading">
        <CardHeader id="font-heading" title="Slide text" onReset={() => resetTo('slideFont', 'slideFontScale')} resetDisabled={isDefault('slideFont', 'slideFontScale')} />
        <Row title="Font for slide text" detail="Applies to lyrics, readings, prayers and announcements on the projector and the TV. Keep the current look leaves each slide's own font.">
          <select
            aria-label="Slide font"
            value={settings.slideFont ?? ''}
            onChange={(e) => void save({ slideFont: e.target.value || null })}
            className={`h-10 rounded-lg border border-fg/20 bg-panel px-3 text-sm text-fg outline-none focus:border-accent ${FOCUS}`}
          >
            <option value="">Keep the current look</option>
            {TEXT_FONT_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.keys.filter((key) => SLIDE_FONTS.includes(key)).map((key) => (
                  <option key={key} value={key}>
                    {TEXT_FONTS[key].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Row>
        <Row title="Text size" detail="A share of each slide's own size. Lines wrap to stay on the screen." stacked>
          <Segmented
            label="Text size"
            value={String(settings.slideFontScale)}
            options={SLIDE_FONT_SCALES.map((scale) => ({ id: String(scale), text: percent(scale) }))}
            onChange={(value) => void save({ slideFontScale: Number(value) })}
          />
        </Row>
        <p aria-label="Font preview" className="rounded-lg border border-line bg-panel px-4 py-3 text-2xl text-fg" style={{ fontFamily: slideFontCss(settings.slideFont), fontSize: `${1.5 * settings.slideFontScale}rem` }}>
          Lord, have mercy on us
        </p>
      </section>

      {/* Advanced mode: one text colour, shadow and outline over every slide. */}
      <section className={`${CARD} lg:col-span-2`} aria-labelledby="advanced-heading">
        <CardHeader
          id="advanced-heading"
          title="Advanced mode"
          detail="Live text styling for the projector: one colour, shadow and outline for every slide, over each slide's own look."
          onReset={() => resetTo('advancedOutput', 'textColor', 'textShadow', 'textOutline')}
          resetDisabled={isDefault('advancedOutput', 'textColor', 'textShadow', 'textOutline')}
        />
        <Row title="Advanced mode" detail={advanced ? 'On: the styling below is drawn on the projector now.' : 'Off: each slide keeps its own look. The styling below is kept for when it is turned on.'}>
          <div className="flex items-center gap-2">
            <Zap size={14} className={advanced ? 'text-accent' : 'text-fg/40'} aria-hidden />
            <GoldSwitch label="Advanced mode" on={advanced} onChange={(advancedOutput) => void save({ advancedOutput })} />
          </div>
        </Row>
        <div className={advanced ? 'flex flex-col gap-4' : 'flex flex-col gap-4 opacity-40'}>
          <Row title="Text colour" detail="One colour for all slide text, titles included. Keep each slide's colours leaves them as they are." stacked>
            <div role="radiogroup" aria-label="Text colour" className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={settings.textColor === null}
                disabled={!advanced}
                onClick={() => pickColour(null)}
                className={`h-8 rounded-md border px-3 text-[11px] font-bold tracking-wider uppercase disabled:cursor-not-allowed ${FOCUS} ${
                  settings.textColor === null ? 'border-accent/40 bg-accent/20 text-accent' : 'border-line text-fg/60 hover:text-fg'
                }`}
              >
                Keep each slide's colours
              </button>
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  role="radio"
                  aria-checked={settings.textColor === c.hex}
                  aria-label={c.label}
                  title={c.label}
                  disabled={!advanced}
                  onClick={() => pickColour(c.hex)}
                  className={`size-8 rounded-md border-2 disabled:cursor-not-allowed ${FOCUS} ${settings.textColor === c.hex ? 'border-accent' : 'border-fg/20'}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
              <label className="flex items-center gap-2 text-xs text-fg/70">
                Other
                <input
                  type="color"
                  aria-label="Other text colour"
                  disabled={!advanced}
                  // The colour picker reads only lower-case colours; the setting keeps them in upper case.
                  value={(settings.textColor ?? '#ffffff').toLowerCase()}
                  onChange={(e) => colour.set({ textColor: e.target.value })}
                  onBlur={() => colour.flush()}
                  className="h-8 w-10 cursor-pointer rounded border border-fg/20 bg-panel disabled:cursor-not-allowed"
                />
              </label>
            </div>
          </Row>
          <Row title="Drop shadow" detail="A soft dark shadow behind the text, so it reads over a busy picture. 0% has none.">
            <UnitSlider label="Drop shadow strength" value={settings.textShadow} disabled={!advanced} onSave={(textShadow) => void save({ textShadow })} />
          </Row>
          <Row title="Outline" detail="A thin dark edge around each letter. 0% has none.">
            <UnitSlider label="Outline opacity" value={settings.textOutline} disabled={!advanced} onSave={(textOutline) => void save({ textOutline })} />
          </Row>
          <p
            aria-label="Advanced style preview"
            className={`rounded-lg border border-line bg-[linear-gradient(135deg,#3b2f2f,#1e3a5f)] px-4 py-6 text-center text-3xl font-semibold text-white ${advanced ? 'apcc-advanced-text' : ''} ${advanced && settings.textColor ? 'apcc-text-color' : ''}`}
            style={
              advanced
                ? ({
                    '--apcc-text-shadow': settings.textShadow > 0 ? `0 2px ${4 + settings.textShadow * 10}px rgba(0,0,0,${settings.textShadow})` : 'none',
                    '--apcc-text-stroke': settings.textOutline > 0 ? `1.5px rgba(0,0,0,${settings.textOutline})` : '0 transparent',
                    ...(settings.textColor ? { '--apcc-text-color': settings.textColor } : {}),
                  } as CSSProperties)
                : undefined
            }
          >
            <span>Holy, holy, holy Lord</span>
          </p>
        </div>
      </section>
    </>
  );
}
