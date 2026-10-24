import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Presentation } from 'lucide-react';
import type { Frame } from '../../shared/live.js';
import { rosaryT } from '../../shared/rosary-i18n.js';
import { BACKGROUND_COLORS, fontCss, parseTextStyle, sanitizeTextStyle } from '../../shared/text-style.js';
import type { TextStyle } from '../../shared/text-style';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { useUi } from '../state/ui';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import type { MediaAsset } from '../media/types';
import {
  beadPosition,
  DECADE_BEADS,
  DECADES,
  INTRO_BEADS,
  mysteryTypeFor,
  positionOfClosing,
  positionOfDecade,
  positionOfIntro,
  stepAt,
  TOTAL_POSITIONS,
} from '../../shared/rosary-logic.js';
import type { RosaryT } from './strings';
import { onRosaryChanged } from './refresh';
import { loadChunkOptions, splitPrayerText, type ChunkOptions } from './rosaryUtils';
import { MYSTERY_TYPES, type Mystery, type MysteryType, type RosaryPrayer } from './types';

const api = bridge.rosary;
const LANGUAGES = ['en', 'tl', 'ceb'] as const;
type RosaryLang = (typeof LANGUAGES)[number];

type RosaryFrame = Extract<Frame, { kind: 'rosary' }>;

const STYLE_KEY = 'apccmma.rosary.style';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const button =
  'flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';

/** The text in the chosen language, or English when that language has none yet. */
function localized(lang: string, en: string, tl: string, ceb: string): { text: string; fallback: boolean } {
  if (lang === 'tl' && tl) return { text: tl, fallback: false };
  if (lang === 'ceb' && ceb) return { text: ceb, fallback: false };
  return { text: en, fallback: lang !== 'en' };
}

/** Labels for one language. The deck keeps its own language, so this does not read the sidebar. */
const tFor = (lang: RosaryLang): RosaryT => (key, vars) => rosaryT(lang, key, vars);

/** The deck's text style, remembered on this machine only. A failed read or write keeps the default. */
function loadStyle(): TextStyle {
  try {
    return parseTextStyle(localStorage.getItem(STYLE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveStyle(style: TextStyle) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    /* storage unavailable: the style still applies for this session */
  }
}

/**
 * The projector frame and fallback flag for one position in the sequence. Shared by the preview,
 * the staging on each step, and the take action, so the screen always shows what the deck shows.
 */
function buildStep(
  position: number,
  type: MysteryType,
  mysteries: Mystery[],
  prayers: RosaryPrayer[],
  lang: RosaryLang,
  style: TextStyle,
  options: ChunkOptions,
  chunk: number,
): { frame: RosaryFrame; fallback: boolean } {
  const t = tFor(lang);
  const step = stepAt(position);
  const frameStyle = sanitizeTextStyle(style);
  let fallback = false;
  const pick = (en: string, tl: string, ceb: string) => {
    const r = localized(lang, en, tl, ceb);
    if (r.fallback) fallback = true;
    return r.text;
  };
  /** The slide of a prayer that is shown. A long prayer is split, and `chunk` picks which slide. */
  const prayerPart = (key: string) => {
    const row = prayers.find((p) => p.key === key);
    const slides = splitPrayerText(row ? pick(row.textEn, row.textTl, row.textCeb) : '', options);
    const slide = slides[Math.min(chunk, Math.max(slides.length - 1, 0))];
    return {
      text: slide?.text ?? '',
      part: slides.length > 1 && slide ? { index: slide.partIndex, total: slide.totalParts } : undefined,
    };
  };
  const pray = prayerPart(step.kind);
  const prayerLabel = () => (step.kind === 'hail_mary' ? t('prayer_hail_mary') : t(`prayer_${step.kind}`));

  if (step.section === 'intro') {
    return {
      frame: {
        kind: 'rosary',
        section: t('section_intro'),
        decade: '',
        mystery: '',
        scripture: '',
        prayer: prayerLabel(),
        text: pray.text, part: pray.part,
        bead: step.bead,
        stage: 'prayer',
        style: frameStyle,
      },
      fallback,
    };
  }

  if (step.section === 'closing') {
    return {
      frame: {
        kind: 'rosary',
        section: t(`set_${type}`),
        decade: t('closing'),
        mystery: '',
        scripture: '',
        prayer: prayerLabel(),
        text: pray.text, part: pray.part,
        bead: null,
        stage: 'prayer',
        style: frameStyle,
      },
      fallback,
    };
  }

  const section = t(`set_${type}`);
  const m = mysteries.find((x) => x.mysteryType === type && x.decadeNumber === step.decade);
  const mystery = m ? pick(m.titleEn, m.titleTl, m.titleCeb) : '';
  const decade = t('decade', { n: step.decade ?? 0 });
  const scripture = m?.scriptureRef ?? '';

  if (step.kind === 'announce') {
    return {
      frame: {
        kind: 'rosary',
        section,
        decade,
        mystery,
        scripture,
        prayer: t('announce'),
        text: m ? pick(m.meditationEn, m.meditationTl, m.meditationCeb) : '',
        bead: null,
        stage: 'announce',
        style: frameStyle,
      },
      fallback,
    };
  }

  const label = step.kind === 'hail_mary' ? t('beadOf', { n: step.bead ?? 0 }) : prayerLabel();
  return {
    frame: { kind: 'rosary', section, decade, mystery, scripture, prayer: label, text: pray.text, part: pray.part, bead: step.bead, stage: 'prayer', style: frameStyle },
    fallback,
  };
}

export function RosaryDeck() {
  // The deck starts in the app's language and then keeps its own. Changing it here does not change the sidebar.
  const globalLang = useUi((s) => s.lang);
  const [rosaryLanguage, setRosaryLanguage] = useState<RosaryLang>(globalLang as RosaryLang);
  const lang = rosaryLanguage;
  const t = tFor(lang);
  const projectorLive = useLive((s) => s.state.projector.live);
  const background = useLive((s) => s.state.projector.background);
  const [mysteries, setMysteries] = useState<Mystery[] | null>(null);
  const [prayers, setPrayers] = useState<RosaryPrayer[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const todaySet = mysteryTypeFor(new Date()) as MysteryType;
  const [type, setType] = useState<MysteryType>(todaySet);
  const [position, setPosition] = useState(0);
  const [style, setStyle] = useState<TextStyle>(loadStyle);
  // The slide of a long prayer that is showing (0-based), and how prayers are split. The split settings live in Settings.
  const [chunk, setChunk] = useState(0);
  const [options, setOptions] = useState<ChunkOptions>(loadChunkOptions);

  // Loads the text on mount, and again after Settings saves or imports it. The staged frame follows the new data.
  const [contentVersion, setContentVersion] = useState(0);
  useEffect(() => onRosaryChanged(() => setContentVersion((v) => v + 1)), []);
  useEffect(() => {
    Promise.all([api.getMysteries(), api.getPrayers()])
      .then(([m, p]) => {
        setMysteries(m);
        setPrayers(p);
        setOptions(loadChunkOptions());
      })
      .catch((err) => setError(errorText(err)));
  }, [contentVersion]);

  // Backgrounds come from the Media Library. Listed once; a file added later shows after the deck is reopened.
  useEffect(() => {
    bridge.media.list().then(setMedia).catch(() => undefined);
  }, []);

  /** The frame for a position in a given language and style. Used when either is changing. */
  const build = (pos: number, l: RosaryLang = lang, s: TextStyle = style, c: number = chunk) =>
    mysteries ? buildStep(pos, type, mysteries, prayers, l, s, options, c) : null;
  const frameAt = (pos: number, c: number = chunk) => build(pos, lang, style, c);

  // Keep the staged frame in step with the set, language and split settings, so the preview never shows an old prayer.
  useEffect(() => {
    const built = frameAt(position);
    if (built) dispatch({ type: 'projector/stage', frame: built.frame });
  }, [type, mysteries, prayers, lang, options]);

  /** Re-sends the current step to the projector when it is already live, so a change shows at once. */
  const sendIfLive = (built: ReturnType<typeof build>) => {
    if (!built) return;
    dispatch({ type: 'projector/stage', frame: built.frame });
    if (projectorLive.kind === 'rosary') dispatch({ type: 'projector/take' });
  };

  /**
   * Picking a language in the deck. While a rosary is on the projector, the current step is re-sent in
   * the new language and taken, so the congregation screen and the mirror change together. Otherwise only
   * the deck changes.
   */
  const changeLanguage = (next: RosaryLang) => {
    if (next === lang) return;
    setRosaryLanguage(next);
    sendIfLive(build(position, next));
  };

  const changeStyle = (patch: TextStyle) => {
    const next = { ...style, ...patch };
    setStyle(next);
    saveStyle(sanitizeTextStyle(next) ?? {});
    sendIfLive(build(position, lang, next));
  };

  /** Empty id clears the background. Picking a file puts it on the background layer straight away. */
  const pickBackground = (id: string) => {
    if (!id) {
      dispatch({ type: 'background/clear' });
      return;
    }
    const asset = media.find((m) => String(m.id) === id);
    // Audio plays in the Media Library, so it cannot be a background.
    if (!asset || asset.mediaType === 'audio') return;
    dispatch({ type: 'background/stage', media: { kind: 'media', mediaType: asset.mediaType, src: asset.src, title: asset.filename } });
    dispatch({ type: 'background/take' });
  };

  /** Stages a step at a slide and, once the rosary is on screen, takes it straight away. */
  const show = (pos: number, c: number) => {
    const built = frameAt(pos, c);
    if (!built) return;
    dispatch({ type: 'projector/stage', frame: built.frame });
    // Each step goes straight to the screen once the rosary is on it. The operator does not press Enter every time.
    if (projectorLive.kind === 'rosary') dispatch({ type: 'projector/take' });
  };

  /** Moves to a step, starting at its first slide unless `c` names another. */
  const goTo = (pos: number, c = 0) => {
    const next = Math.min(Math.max(0, pos), TOTAL_POSITIONS - 1);
    setPosition(next);
    setChunk(c);
    show(next, c);
  };

  /** Slides in the prayer at a step. A step with one slide, or no prayer, has one. */
  const slidesAt = (pos: number) => frameAt(pos, 0)?.frame.part?.total ?? 1;

  /**
   * Next or previous slide of a long prayer. Past the last slide, the next press moves to the next step. Before the
   * first slide, the previous press goes to the last slide of the step before.
   */
  const stepSlide = (delta: 1 | -1) => {
    const current = (frameAt(position)?.frame.part?.index ?? 1) - 1;
    const target = current + delta;
    if (target >= 0 && target < slidesAt(position)) {
      setChunk(target);
      show(position, target);
    } else if (delta > 0) {
      goTo(position + 1);
    } else if (position > 0) {
      goTo(position - 1, slidesAt(position - 1) - 1);
    }
  };

  const take = () => {
    const built = frameAt(position);
    if (!built) return;
    dispatch({ type: 'projector/stage', frame: built.frame });
    dispatch({ type: 'projector/take' });
  };

  // Hotkeys: Space and Right advance, Left goes back, Enter takes live. Left and Right step through the slides of a long prayer
  // first. Re-bound each render so they see the current position.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().paletteOpen) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepSlide(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepSlide(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        take();
      } else {
        return;
      }
      // A focused button would also activate on Space or Enter, so focus is released after a hotkey.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) {
    return (
      <div className="p-5">
        <div role="alert" className="rounded-md border border-danger/40 bg-panel px-4 py-2 text-sm text-danger">{error}</div>
      </div>
    );
  }
  if (!mysteries) return <p className="p-5 text-sm text-muted">{t('loading')}</p>;
  if (mysteries.length === 0) {
    return (
      <div className="p-5">
        <div className="rounded-xl border border-line bg-panel p-8">
          <h1 className="text-4xl font-black uppercase condensed">{t('title')}</h1>
          <p className="mt-2 max-w-xl text-muted">{t('noData')}</p>
        </div>
      </div>
    );
  }

  const built = frameAt(position);
  if (!built) return null;
  const { frame, fallback } = built;
  const step = stepAt(position);

  // Sections for the left-hand list: the introduction, each decade, then the two closing prayers.
  const sections: { key: string; label: string; start: number; active: boolean }[] = [
    { key: 'intro', label: t('section_intro'), start: positionOfIntro(), active: step.section === 'intro' },
    ...Array.from({ length: DECADES }, (_, i) => i + 1).map((d) => {
      const m = mysteries.find((x) => x.mysteryType === type && x.decadeNumber === d);
      return {
        key: `decade-${d}`,
        label: `${d}. ${m ? localized(lang, m.titleEn, m.titleTl, m.titleCeb).text : ''}`,
        start: positionOfDecade(d),
        active: step.section === 'decade' && step.decade === d,
      };
    }),
    { key: 'hail_holy_queen', label: t('prayer_hail_holy_queen'), start: positionOfClosing('hail_holy_queen'), active: step.kind === 'hail_holy_queen' },
    { key: 'litany_loreto', label: t('prayer_litany_loreto'), start: positionOfClosing('litany_loreto'), active: step.kind === 'litany_loreto' },
  ];

  // The bead strip runs over the introduction (3 Hail Marys) and each decade (10). It is clickable.
  const beadCount = step.section === 'intro' ? INTRO_BEADS : step.section === 'decade' ? DECADE_BEADS : 0;
  const beadsDone = Array.from({ length: beadCount }, (_, i) => i + 1).filter((n) => beadPosition(step, n) < position).length;
  const previewStyle = sanitizeTextStyle(style);
  const bgSelected = media.find((m) => m.src === background.live?.src);

  return (
    <section aria-labelledby="rosary-heading" className="flex flex-col gap-4 p-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="eyebrow text-fg">{t('eyebrow')}</div>
          <h1 id="rosary-heading" className="mt-1 text-[44px] leading-none font-black uppercase condensed">{t('title')}</h1>
          <p className="mt-2 text-[15px] text-muted">{t('subtitle')}</p>
        </div>

        {/* The deck's own language. It starts in the app language and does not change the sidebar. */}
        <div role="group" aria-label={t('title')} className="flex items-center gap-1 rounded-lg border border-fg/10 bg-black/40 p-1">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => changeLanguage(l)}
              className={`rounded-md px-3 py-1 text-xs font-semibold uppercase transition-all ${
                lang === l
                  ? 'bg-accent text-on-accent shadow-[0_0_10px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]'
                  : 'text-fg/60 hover:bg-fg/5 hover:text-fg'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-panel p-4">
            <h2 className="eyebrow mb-2">{t('setHeading')}</h2>
            <div role="tablist" className="flex flex-col gap-1">
              {MYSTERY_TYPES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={type === m}
                  onClick={() => setType(m)}
                  className={`flex items-center justify-between gap-2 rounded-md border-l-2 px-3 py-2 text-left text-sm font-semibold ${
                    type === m ? 'border-accent bg-panel-2 text-fg' : 'border-transparent text-muted hover:bg-panel-2 hover:text-fg'
                  }`}
                >
                  <span>{t(`set_${m}`)}</span>
                  {m === todaySet && (
                    <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">
                      {t('todaySet')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-panel p-4">
            <h2 className="eyebrow mb-2">{t('sectionsHeading')}</h2>
            <ol className="flex flex-col gap-1">
              {sections.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    aria-current={s.active ? 'step' : undefined}
                    onClick={() => goTo(s.start)}
                    className={`flex w-full items-center rounded-md border-l-2 px-3 py-2 text-left text-sm ${
                      s.active ? 'border-accent bg-panel-2 text-fg' : 'border-transparent text-muted hover:bg-panel-2 hover:text-fg'
                    }`}
                  >
                    <span className="min-w-0 truncate">{s.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl border border-line bg-panel p-4">
            <h2 className="eyebrow mb-2">{t('backgroundHeading')}</h2>
            {media.length === 0 ? (
              <p className="text-xs text-muted">{t('mediaEmpty')}</p>
            ) : (
              <select
                aria-label={t('backgroundHeading')}
                value={bgSelected ? String(bgSelected.id) : ''}
                onChange={(e) => pickBackground(e.target.value)}
                className="h-9 w-full rounded-md border border-line-strong bg-canvas px-2 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="">{t('backgroundNone')}</option>
                {media.map((m) => (
                  <option key={m.id} value={m.id}>{m.filename}</option>
                ))}
              </select>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-panel p-6 backdrop-blur-md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="eyebrow">{frame.decade ? `${frame.section} · ${frame.decade}` : frame.section}</p>
            <p className="text-xs text-muted tabular-nums">{t('stepOf', { n: position + 1, total: TOTAL_POSITIONS })}</p>
          </div>

          {frame.mystery && <h2 className="text-[40px] leading-none font-black uppercase condensed">{frame.mystery}</h2>}
          {frame.scripture && (
            <p className="text-sm text-muted">
              {t('scripture')}: {frame.scripture}
            </p>
          )}

          {/* The card is a preview of the slide: a background colour, the chosen face, colour and alignment. */}
          {/* The operator text is a fixed size and scrolls inside its card. The chosen font size applies only to the projector and mirror. */}
          <div
            className="max-h-[60vh] overflow-y-auto rounded-xl border border-stone-800 bg-stone-900/60 p-6"
            style={{ backgroundColor: previewStyle?.bgColor }}
          >
            <p className="eyebrow mb-3 text-accent">{frame.prayer}</p>
            <p
              className="text-xl leading-relaxed whitespace-pre-line text-stone-200"
              style={{
                color: previewStyle?.textColor,
                fontFamily: fontCss(previewStyle),
                textAlign: previewStyle?.textAlign,
              }}
            >
              {frame.text || t('noText')}
            </p>
            {fallback && <p className="mt-3 text-xs text-muted">{t('fallbackNote')}</p>}
          </div>

          {/* A long prayer is shown in parts. These step through them, then on to the next step. */}
          {frame.part && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => stepSlide(-1)} className={button}>
                <ChevronLeft size={15} aria-hidden /> Previous Chunk
              </button>
              <span className="text-xs font-bold text-accent tabular-nums">
                Part {frame.part.index} of {frame.part.total}
              </span>
              <button type="button" onClick={() => stepSlide(1)} className={button}>
                Next Chunk <ChevronRight size={15} aria-hidden />
              </button>
            </div>
          )}

          {beadCount > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: beadCount }, (_, i) => i + 1).map((n) => {
                const done = n <= beadsDone;
                const current = step.bead === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={step.section === 'intro' ? `${t('prayer_hail_mary')} ${n}` : t('beadOf', { n })}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => goTo(beadPosition(step, n))}
                    className={`size-8 rounded-full border-2 transition ${
                      current
                        ? 'border-accent bg-accent/40 ring-2 ring-accent'
                        : done
                          ? 'border-accent bg-accent'
                          : 'border-line-strong hover:border-accent'
                    }`}
                  />
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => goTo(position - 1)} disabled={position === 0} className={button}>
              <ChevronLeft size={15} aria-hidden /> {t('previous')}
            </button>
            <button type="button" onClick={() => goTo(position + 1)} disabled={position === TOTAL_POSITIONS - 1} className={button}>
              {t('next')} <ChevronRight size={15} aria-hidden />
            </button>
            <button
              type="button"
              onClick={take}
              className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-extrabold uppercase condensed text-on-accent hover:brightness-105"
            >
              <Presentation size={14} aria-hidden /> {t('takeLive')}
            </button>
            {projectorLive.kind === 'rosary' && <span className="text-xs font-bold text-ok uppercase">● {t('live')}</span>}
            <p className="ml-auto text-xs text-faint">{t('hotkeys')}</p>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <h2 className="eyebrow">{t('styleHeading')}</h2>
            <StyleToolbar style={style} onChange={changeStyle} />
            <ColorField
              label={t('backgroundColor')}
              prefix={t('backgroundColor')}
              value={style.bgColor}
              presets={BACKGROUND_COLORS}
              onChange={(hex) => changeStyle({ bgColor: hex })}
              clearLabel={t('noColor')}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
