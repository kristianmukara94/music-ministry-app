import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { bridge } from '../../live/bridge';
import { useLive } from '../../live/store';
import { SLIDE_FONT_SCALES, SLIDE_FONTS, type ProjectorSettings } from '../../../shared/projector-settings.js';
import { TEXT_FONTS, type TextFontFamily } from '../../../shared/text-style.js';
import { textCaseOf } from '../../../shared/text-fit.js';
import { BACKDROP_THEMES, backdropThemeOf, withBackdropTheme, type BackdropThemeId } from '../../../shared/stage-cue.js';
import { TextCaseSwitch } from '../../components/TextCaseSwitch';
import { SlotTitleToggle } from '../../operator/SlotTitleToggle';
import { BackgroundPanel } from '../../operator/BackgroundPanel';
import { useGoLiveT } from '../strings';
import { BTN, BTN_ACTIVE, CARD, CARD_TITLE } from './styles';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const ROW = 'flex flex-wrap items-center justify-between gap-2';
const LABEL = 'text-xs text-muted';

/** The swatch each quick theme shows: the colour it sets, lit from one corner as the stage reads it. */
const SWATCH: Record<BackdropThemeId, string> = {
  burgundy: 'linear-gradient(135deg, #3a1218, #2a0c10 55%, #120406)',
  obsidian: 'linear-gradient(135deg, #24262e, #15161b 55%, #0a0b0e)',
  ember: 'linear-gradient(135deg, #3a2810, #291c0c 55%, #110b04)',
  midnight: 'linear-gradient(135deg, #1b2747, #0f172a 55%, #070b15)',
};

/**
 * Stage Typography & Backdrop, beside the slide editor on both consoles. Letter Casing (Aa | AA | aa), Text Scale (A−, the readout that puts it
 * back to 100%, A+, 50%–250%) and Max (song lyrics edge to edge, each line whole at the largest size that fits; see edgeToEdgeBox and
 * fitWholeLines in shared/text-fit.js) are projector settings: saved through bridge.projector.save, they reach the projector, the mirror, the TV
 * and both monitors at once, and the case is applied before any line is fitted or balanced. The slide on air, its background and its video keep
 * playing. The backdrop's quick themes colour the Live slide background (Praise & Worship slides); Media Background opens the full picker.
 */
export function TypographyCard({ backdrop = true }: { backdrop?: boolean }) {
  const t = useGoLiveT();
  const settings = useLive((s) => s.state.settings);
  const slideBackground = useLive((s) => s.state.welcome.slideBackground);
  const [error, setError] = useState<string | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const index = SLIDE_FONT_SCALES.indexOf(settings.slideFontScale);
  const textCase = textCaseOf(settings.textCase);
  const max = settings.edgeToEdge === true;
  const theme = backdropThemeOf(slideBackground);

  const save = (patch: Partial<ProjectorSettings>) => {
    setError(null);
    bridge.projector.save(patch).catch((err) => setError(errorText(err)));
  };
  const step = (delta: number) => {
    const next = SLIDE_FONT_SCALES[index + delta];
    if (next !== undefined) save({ slideFontScale: next });
  };
  const pickTheme = (id: BackdropThemeId) => {
    setError(null);
    bridge.welcome.save({ slideBackground: withBackdropTheme(slideBackground, id) }).catch((err) => setError(errorText(err)));
  };

  return (
    <section aria-labelledby="stage-typography" className={`${CARD} flex flex-col gap-3 p-4`}>
      <h2 id="stage-typography" className={`${CARD_TITLE} border-b border-line pb-2.5`}>{t('consoleTypography')}</h2>
      <div className={ROW}>
        <span className={LABEL}>{t('consoleCasing')}</span>
        <TextCaseSwitch
          size="xs"
          value={textCase}
          onChange={(mode) => mode !== textCase && save({ textCase: mode })}
          labels={{ group: t('typoTextCase'), original: t('typoTextCaseOriginal'), uppercase: t('typoTextCaseUpper'), lowercase: t('typoTextCaseLower') }}
        />
      </div>
      <div className={ROW}>
        <span className={LABEL}>{t('consoleScale')}</span>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label={t('typoSmaller')} title={t('typoSmaller')} onClick={() => step(-1)} disabled={index <= 0} className={`${BTN} w-9 px-0 font-extrabold`}>
            A−
          </button>
          <button
            type="button"
            aria-live="polite"
            aria-label={`${Math.round(settings.slideFontScale * 100)}% · ${t('typoReset')}`}
            title={t('typoReset')}
            onClick={() => save({ slideFontScale: 1 })}
            disabled={settings.slideFontScale === 1}
            className="h-8 w-12 rounded-lg font-mono text-xs font-bold text-accent tabular-nums transition hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
          >
            {Math.round(settings.slideFontScale * 100)}%
          </button>
          <button type="button" aria-label={t('typoLarger')} title={t('typoLarger')} onClick={() => step(1)} disabled={index >= SLIDE_FONT_SCALES.length - 1} className={`${BTN} w-9 px-0 font-extrabold`}>
            A+
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={max}
            aria-label={t('typoEdgeToEdgeHint')}
            title={t('typoEdgeToEdgeHint')}
            onClick={() => save({ edgeToEdge: !max })}
            className={`${max ? '!border-gold !bg-gold/20 !text-gold' : ''} ${BTN} font-extrabold tracking-wider`}
          >
            {t('typoEdgeToEdge')}
          </button>
        </div>
      </div>
      <div className={ROW}>
        <label htmlFor="stage-font" className={LABEL}>{t('consoleFont')}</label>
        <div className="flex min-w-0 items-center gap-1.5">
          <select
            id="stage-font"
            value={settings.slideFont ?? ''}
            onChange={(e) => save({ slideFont: e.target.value || null })}
            className="h-8 w-36 min-w-0 truncate rounded-lg border border-line bg-panel-2 px-2 text-xs font-semibold text-fg outline-none focus:border-accent"
          >
            <option value="">{t('consoleFontCurrent')}</option>
            {SLIDE_FONTS.map((key) => (
              <option key={key} value={key}>
                {TEXT_FONTS[key as TextFontFamily].label}
              </option>
            ))}
          </select>
          <SlotTitleToggle live />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className={ROW}>
          <span className={LABEL}>{t('consoleBackdrop')}</span>
          <button type="button" aria-pressed={mediaOpen} aria-expanded={mediaOpen} onClick={() => setMediaOpen((o) => !o)} className={mediaOpen ? BTN_ACTIVE : BTN}>
            <ImageIcon size={13} aria-hidden /> {t('consoleMediaBg')}
          </button>
        </div>
        {backdrop && (
          <>
            <div role="radiogroup" aria-label={t('consoleBackdrop')} className="grid grid-cols-2 gap-2">
              {BACKDROP_THEMES.map(({ id }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={theme === id}
                  onClick={() => pickTheme(id)}
                  className={`${theme === id ? BTN_ACTIVE : BTN} h-auto justify-start py-1.5 text-left whitespace-normal`}
                >
                  <span aria-hidden className="size-5 shrink-0 rounded border border-white/15" style={{ background: SWATCH[id] }} />
                  {t(`backdrop_${id}`)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted">{t('consoleBackdropHint')}</p>
          </>
        )}
        {mediaOpen && <BackgroundPanel onClose={() => setMediaOpen(false)} />}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
