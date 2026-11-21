// Per-slide looks: the Output Preview Editor's "This Slide" formatting. A look overrides, for one slide only, the projector settings every
// slide is drawn with: the letter case, the alignment, the text scale (50%–250%), MAX (edge to edge) and, on a Praise & Worship slide, the
// stage backdrop. Looks live in the live state (`slideLooks`), so the projector, the TV, the mirror and both console monitors draw them at
// once, and they are kept for this run of the app only: Song Lyrics, the Lectionary and the Hub are never changed by one.
//
// A look is found by its slide's key. A Praise & Worship frame carries its key (`lookKey`, stamped by frameFor: the card and the step), and a
// Holy Mass frame is keyed by its place: the loaded plan, the queue row and the slide in that row. The words are not part of either key, so
// a slide keeps its look when its words are edited.

import { SLIDE_FONT_SCALES } from './projector-settings.js';
import { TEXT_CASES, textCaseOf } from './text-fit.js';
import { BACKDROP_THEMES } from './stage-cue.js';

/** The alignments a slide can take. */
export const SLIDE_ALIGNS = Object.freeze(['left', 'center', 'right']);

/**
 * The alignment a slide's words are drawn with: the one chosen (on the slide, for every slide, or in the slide's own style), else centred.
 * Centre is the one default for every kind of slide (songs, Bible passages, readings, psalms, prayers and notes), so a slide with no
 * alignment chosen never falls back to the page's left.
 */
export const slideTextAlign = (align) => (SLIDE_ALIGNS.includes(align) ? align : 'center');

/** The settings a look can override, in the order the editor shows them. */
export const SLIDE_LOOK_KEYS = Object.freeze(['textCase', 'align', 'fontScale', 'maxFit', 'backdrop']);

/** The look as it may be saved: only known keys with valid values. Null when nothing is left (no override). */
export function sanitizeSlideLook(look) {
  if (!look || typeof look !== 'object') return null;
  const out = {};
  if (TEXT_CASES.includes(look.textCase)) out.textCase = look.textCase;
  if (SLIDE_ALIGNS.includes(look.align)) out.align = look.align;
  const scale = Math.round(Number(look.fontScale) * 10) / 10;
  if (look.fontScale != null && SLIDE_FONT_SCALES.includes(scale)) out.fontScale = scale;
  if (typeof look.maxFit === 'boolean') out.maxFit = look.maxFit;
  if (BACKDROP_THEMES.some((t) => t.id === look.backdrop)) out.backdrop = look.backdrop;
  return Object.keys(out).length > 0 ? out : null;
}

/** True when the look overrides anything. */
export const hasSlideLook = (look) => sanitizeSlideLook(look) !== null;

/**
 * The formatting a slide is drawn with: its own look over the projector settings. `globalBackdrop` is the quick theme the Live slide
 * background shows now (backdropThemeOf), or null. `hasOverride` lights the editor's Reset Override.
 */
export function resolveSlideLook(settings, look, globalBackdrop = null) {
  const own = sanitizeSlideLook(look) ?? {};
  const align = SLIDE_ALIGNS.includes(settings?.slideAlign) ? settings.slideAlign : null;
  return {
    textCase: own.textCase ?? textCaseOf(settings?.textCase),
    align: own.align ?? align,
    fontScale: own.fontScale ?? (SLIDE_FONT_SCALES.includes(settings?.slideFontScale) ? settings.slideFontScale : 1),
    maxFit: own.maxFit ?? settings?.edgeToEdge === true,
    backdrop: own.backdrop ?? globalBackdrop ?? null,
    hasOverride: Object.keys(own).length > 0,
  };
}

/**
 * One formatting change from the editor. In "This Slide" scope it goes into the slide's look (`look`); in "All Slides" scope it is a change
 * to the projector settings (`settings`) or to the Live slide background (`backdrop`), and the slide's own value for it is dropped, so the
 * new setting shows on this slide too. A text scale step turns MAX off, as the typography card's A− and A+ do.
 */
export function lookChange(look, key, value, scope) {
  const own = { ...(sanitizeSlideLook(look) ?? {}) };
  if (scope === 'slide') {
    own[key] = value;
    if (key === 'fontScale') own.maxFit = false;
    return { look: sanitizeSlideLook(own), settings: null, backdrop: null };
  }
  delete own[key];
  if (key === 'fontScale') delete own.maxFit;
  const settings =
    key === 'textCase' ? { textCase: value }
    : key === 'align' ? { slideAlign: value }
    : key === 'fontScale' ? { slideFontScale: value, edgeToEdge: false }
    : key === 'maxFit' ? { edgeToEdge: value }
    : null;
  return { look: sanitizeSlideLook(own), settings, backdrop: key === 'backdrop' ? value : null };
}

/**
 * Whether the Output Preview Editor's draft (words, tag, cue label, notes and the slide's own look) holds a change of its own against the slide
 * as it was saved when the draft was made. Nothing reaches the screen or the plan until Save: a draft with no change is replaced when the slide
 * changes elsewhere, and a draft with one is kept.
 */
export function editorDraftChanged(draft, from) {
  if (!draft || !from) return false;
  return (
    draft.text !== from.text ||
    (draft.tag ?? null) !== (from.tag ?? null) ||
    (draft.label ?? '') !== (from.label ?? '') ||
    (draft.notes ?? '') !== (from.notes ?? '') ||
    JSON.stringify(sanitizeSlideLook(draft.look)) !== JSON.stringify(sanitizeSlideLook(from.look))
  );
}

/** The next text scale step from `scale` (−1 smaller, +1 larger), or `scale` itself at either end of 50%–250%. */
export function stepScale(scale, delta) {
  const at = SLIDE_FONT_SCALES.indexOf(scale);
  const index = at < 0 ? SLIDE_FONT_SCALES.indexOf(1) : at;
  return SLIDE_FONT_SCALES[Math.min(SLIDE_FONT_SCALES.length - 1, Math.max(0, index + delta))];
}

/** A slide's alignment folded into the frame, in the field each kind of slide already draws it from. Other kinds come back as they are. */
export function frameWithAlign(frame, align) {
  if (!frame || !SLIDE_ALIGNS.includes(align)) return frame;
  if (frame.kind === 'pw' && (frame.slide?.kind === 'lyrics' || frame.slide?.kind === 'prayer')) {
    return frame.slide.align === align ? frame : { ...frame, slide: { ...frame.slide, align } };
  }
  // A deck is a Bible passage or a Holy Mass Order reading; a rosary step is a prayer. Both draw their words from the style's alignment too.
  if (frame.kind === 'lyrics' || frame.kind === 'text' || frame.kind === 'psalm' || frame.kind === 'deck' || frame.kind === 'rosary') {
    return frame.style?.textAlign === align ? frame : { ...frame, style: { ...(frame.style ?? {}), textAlign: align } };
  }
  return frame;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Keys

/** The key of step `index` of a Praise & Worship card (`segmentKey`). */
export const pwLookKey = (segmentKey, index) => `pw:${segmentKey}:${index}`;

/** The key of slide `page` of the Holy Mass queue row `row` in plan `planId`. */
export const massLookKey = (planId, row, page) => `mass:${planId ?? 'none'}:${row}:${page}`;

/**
 * The slide of its item a Holy Mass frame is (0-based), counted as the console counts its cues (massLive.stepsOf): a song's title card is 0
 * and stanza n is n + 1; a deck, a psalm, a picture deck and a prayer's slides count from their own index.
 */
export function framePageOf(frame) {
  if (!frame) return 0;
  if (frame.kind === 'deck' || frame.kind === 'psalm') return Number.isInteger(frame.index) ? frame.index : 0;
  if (frame.kind === 'image') return frame.deck?.index ?? 0;
  if (frame.kind === 'text') return frame.page?.index ?? 0;
  if (frame.kind === 'lyrics') return frame.song ? frame.song.position + 1 : 0;
  return 0;
}

/**
 * The key of the look `frame` is drawn with in `state`, or null. A frame that carries its key uses it. Otherwise a Holy Mass slide on air or
 * staged is keyed by its queue row: only the frame the projector holds, so a thumbnail of some other item never borrows the row's look.
 */
export function slideLookKeyOf(state, frame) {
  if (!frame || typeof frame !== 'object') return null;
  if (typeof frame.lookKey === 'string') return frame.lookKey;
  const p = state?.projector;
  if (!p || p.source !== 'MASS_QUEUE' || !(state.queueCursor >= 0) || !state.queue?.[state.queueCursor]) return null;
  const held = frame === p.live || frame === p.staged || sameFrame(frame, p.live) || sameFrame(frame, p.staged);
  return held ? massLookKey(state.queuePlanId, state.queueCursor, framePageOf(frame)) : null;
}

function sameFrame(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** The look stored for `key` in the live state's `slideLooks`, or null. */
export const slideLookAt = (state, key) => (key ? state?.slideLooks?.[key] ?? null : null);
