import { useState } from 'react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { SLIDE_FONT_SCALES, SLIDE_FONTS, type ProjectorSettings } from '../../shared/projector-settings.js';
import { TEXT_FONTS, type TextFontFamily } from '../../shared/text-style.js';
import { textCaseOf } from '../../shared/text-fit.js';
import { SlotTitleToggle } from '../operator/SlotTitleToggle';
import { TextCaseSwitch } from '../components/TextCaseSwitch';
import { useGoLiveT } from '../golive/strings';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// One row at the bottom bar's height, locked so it never shrinks or wraps. The font name is truncated rather than widening the row.
const ROW = 'flex min-w-0 shrink items-center gap-1';
// The font name truncates, and the select is narrow in a compact panel and wider in a roomy one (the panel's own container, not the window).
const SELECT = 'h-8 w-20 min-w-0 shrink truncate @3xl/pw:w-28 rounded-lg border border-fg/20 bg-panel-2 px-2 text-xs font-semibold text-fg/90 outline-none focus:border-accent';
const STEP =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-fg/20 bg-panel-2 text-xs font-extrabold text-fg/90 transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
// The readout is a button: a click puts the size back to 100%.
const READOUT =
  'inline-flex h-8 w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg text-xs font-bold tabular-nums text-accent transition hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent';
const PILL = 'inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border px-2 text-[11px] font-extrabold tracking-wider transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';
const PILL_OFF = 'border-fg/20 bg-panel-2 text-fg/80 hover:bg-fg/10 hover:text-fg';
const PILL_ON = 'border-gold bg-gold/20 text-gold';

/**
 * The slide typography on the Go Live bottom bar of both consoles (Holy Mass and Praise & Worship): the font, the text case (Aa / AA / aa), the
 * text size from 50% to 250% (the readout resets it to 100%), and MAX, which draws song lyrics edge to edge at the largest size that fits.
 * Each change is saved with the projector settings, so the projector, the mirror, the TV and the CURRENT / NEXT previews all follow it at once,
 * and the slide on air, its background and its video keep playing. The Settings page and the Live Quick Controls show the same choices.
 */
export function SlideTypography() {
  const t = useGoLiveT();
  const settings = useLive((s) => s.state.settings);
  const [error, setError] = useState<string | null>(null);
  const index = SLIDE_FONT_SCALES.indexOf(settings.slideFontScale);
  const textCase = textCaseOf(settings.textCase);
  const edgeToEdge = settings.edgeToEdge === true;

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
      <TextCaseSwitch
        size="xs"
        value={textCase}
        onChange={(mode) => mode !== textCase && save({ textCase: mode })}
        labels={{ group: t('typoTextCase'), original: t('typoTextCaseOriginal'), uppercase: t('typoTextCaseUpper'), lowercase: t('typoTextCaseLower') }}
      />
      <button type="button" aria-label={t('typoSmaller')} title={t('typoSmaller')} onClick={() => step(-1)} disabled={index <= 0} className={STEP}>
        A−
      </button>
      <button
        type="button"
        aria-live="polite"
        aria-label={`${Math.round(settings.slideFontScale * 100)}% · ${t('typoReset')}`}
        title={t('typoReset')}
        onClick={() => save({ slideFontScale: 1 })}
        disabled={settings.slideFontScale === 1}
        className={READOUT}
      >
        {Math.round(settings.slideFontScale * 100)}%
      </button>
      <button type="button" aria-label={t('typoLarger')} title={t('typoLarger')} onClick={() => step(1)} disabled={index >= SLIDE_FONT_SCALES.length - 1} className={STEP}>
        A+
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={edgeToEdge}
        aria-label={t('typoEdgeToEdgeHint')}
        title={t('typoEdgeToEdgeHint')}
        onClick={() => save({ edgeToEdge: !edgeToEdge })}
        className={`${PILL} ${edgeToEdge ? PILL_ON : PILL_OFF}`}
      >
        {t('typoEdgeToEdge')}
      </button>
      <SlotTitleToggle live />
      {error && <span role="alert" className="whitespace-nowrap text-xs text-danger">{error}</span>}
    </div>
  );
}
