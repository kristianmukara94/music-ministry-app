// The projector frames of the rosary, shared by the deck and the Settings preview, so the preview shows what the projector will.
import type { Frame } from '../../shared/live.js';
import { rosaryT } from '../../shared/rosary-i18n.js';
import { stepAt, type RosaryStep } from '../../shared/rosary-logic.js';
import { PRESENTATION_DEFAULTS, sanitizePresentation, type RosaryPresentation } from '../../shared/rosary-presentation.js';
import { parseTextStyle, sanitizeTextStyle } from '../../shared/text-style.js';
import type { TextStyle } from '../../shared/text-style';
import type { RosaryT } from './strings';
import { splitPrayerText, type ChunkOptions } from './rosaryUtils';
import type { Mystery, MysteryType, RosaryPrayer } from './types';

export const ROSARY_LANGUAGES = ['en', 'tl', 'ceb'] as const;
export type RosaryLang = (typeof ROSARY_LANGUAGES)[number];

export type RosaryFrame = Extract<Frame, { kind: 'rosary' }>;

const STYLE_KEY = 'apccmma.rosary.style';
const PRESENTATION_KEY = 'apccmma.rosary.presentation';

/** The text in the chosen language, or English when that language has none yet. */
export function localized(lang: string, en: string, tl: string, ceb: string): { text: string; fallback: boolean } {
  if (lang === 'tl' && tl) return { text: tl, fallback: false };
  if (lang === 'ceb' && ceb) return { text: ceb, fallback: false };
  return { text: en, fallback: lang !== 'en' };
}

/** Labels for one language. The deck keeps its own language, so this does not read the sidebar. */
export const tFor = (lang: RosaryLang): RosaryT => (key, vars) => rosaryT(lang, key, vars);

/** The deck's text style, remembered on this machine only. A failed read or write keeps the default. */
export function loadDeckStyle(): TextStyle {
  try {
    return parseTextStyle(localStorage.getItem(STYLE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveDeckStyle(style: TextStyle) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    /* storage unavailable: the style still applies for this session */
  }
}

/** The presentation options set in Settings (bead tracker, optional prayers, default background), on this machine. */
export function loadPresentation(): RosaryPresentation {
  try {
    return sanitizePresentation(JSON.parse(localStorage.getItem(PRESENTATION_KEY) ?? 'null'));
  } catch {
    return { ...PRESENTATION_DEFAULTS };
  }
}

export function savePresentation(options: RosaryPresentation) {
  try {
    localStorage.setItem(PRESENTATION_KEY, JSON.stringify(sanitizePresentation(options)));
  } catch {
    /* storage unavailable: the options still apply for this session */
  }
}

const prayerName = (t: RosaryT, kind: RosaryStep['kind']) => t(`prayer_${kind}`);

/**
 * The bead tracker line for a step: "2nd Joyful Mystery · Hail Mary 4 of 10" in a decade, "Introductory Prayers · Hail Mary 2 of 3"
 * in the introduction, and "Closing · Hail Holy Queen" at the end.
 */
export function trackerText(step: RosaryStep, type: MysteryType, t: RosaryT): string {
  if (step.section === 'intro') {
    return `${t('section_intro')} · ${step.bead !== null ? t('introBeadOf', { n: step.bead }) : prayerName(t, step.kind)}`;
  }
  if (step.section === 'closing') return `${t('closing')} · ${prayerName(t, step.kind)}`;
  const mystery = t('trackerMystery', { ordinal: t(`ordinal_${step.decade ?? 1}`), kind: t(`kind_${type}`) });
  if (step.kind === 'announce') return mystery;
  return `${mystery} · ${step.kind === 'hail_mary' ? t('beadOf', { n: step.bead ?? 0 }) : prayerName(t, step.kind)}`;
}

/**
 * The projector frame and fallback flag for one position in the sequence. Shared by the deck's preview, its staging on each
 * step, its take action and the Settings preview, so every surface shows the same slide.
 */
export function buildStep(
  position: number,
  type: MysteryType,
  mysteries: Mystery[],
  prayers: RosaryPrayer[],
  lang: RosaryLang,
  style: TextStyle,
  options: ChunkOptions,
  chunk: number,
  presentation: RosaryPresentation = PRESENTATION_DEFAULTS,
): { frame: RosaryFrame; fallback: boolean } {
  const t = tFor(lang);
  const step = stepAt(position, presentation);
  const frameStyle = sanitizeTextStyle(style);
  const tracker = presentation.beadTracker ? trackerText(step, type, t) : undefined;
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
  const prayerLabel = () => prayerName(t, step.kind);
  const base = { kind: 'rosary' as const, style: frameStyle, ...(tracker ? { tracker } : {}) };

  if (step.section === 'intro') {
    return {
      frame: { ...base, section: t('section_intro'), decade: '', mystery: '', scripture: '', prayer: prayerLabel(), text: pray.text, part: pray.part, bead: step.bead, stage: 'prayer' },
      fallback,
    };
  }

  if (step.section === 'closing') {
    return {
      frame: { ...base, section: t(`set_${type}`), decade: t('closing'), mystery: '', scripture: '', prayer: prayerLabel(), text: pray.text, part: pray.part, bead: null, stage: 'prayer' },
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
        ...base,
        section,
        decade,
        mystery,
        scripture,
        prayer: t('announce'),
        text: m ? pick(m.meditationEn, m.meditationTl, m.meditationCeb) : '',
        bead: null,
        stage: 'announce',
      },
      fallback,
    };
  }

  const label = step.kind === 'hail_mary' ? t('beadOf', { n: step.bead ?? 0 }) : prayerLabel();
  return {
    frame: { ...base, section, decade, mystery, scripture, prayer: label, text: pray.text, part: pray.part, bead: step.bead, stage: 'prayer' },
    fallback,
  };
}
