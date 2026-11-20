import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { bridge } from '../../live/bridge';
import { dispatch, useLive } from '../../live/store';
import { NO_DRAG } from '../../components/appRegion';
import { SLIDE_FONT_SCALES } from '../../../shared/projector-settings.js';
import { applyTextCase, type TextCase } from '../../../shared/text-fit.js';
import { BACKDROP_THEMES, backdropThemeOf, balanceLines, lineStats, pad2, toTitleCase, withBackdropTheme, type BackdropThemeId } from '../../../shared/stage-cue.js';
import { editorDraftChanged as draftChanged, lookChange, resolveSlideLook, sanitizeSlideLook, stepScale, SLIDE_ALIGNS, type SlideAlign, type SlideLook, type SlideLookKey } from '../../../shared/slide-look.js';
import { useGoLiveT } from '../strings';
import { setCueMeta, useCueMetaOf } from './cueMeta';
import type { SlideEditTarget } from './SlideEditorCard';
import { BTN, BTN_ACTIVE, BTN_DANGER, BTN_DANGER_ACTIVE, BTN_PRIMARY, EYEBROW, MONITOR } from './styles';

/** One slide as the editor opens it, built by the console for any cue of the item on air. */
export interface EditorCue {
  /** The cue's place in its item (0-based) and the item's slide count, for the stepper. */
  index: number;
  count: number;
  /** The slide's key for its own look and its cue notes (shared/slide-look.js). Null: neither applies (a black step). */
  lookKey: string | null;
  /** The words, the Section Tag, Add After, Duplicate and Delete, through the console's copy-on-write paths. Null: words not editable here. */
  target: SlideEditTarget | null;
  /** The slide's tag and words as shown, for a slide with no target. */
  tag: string;
  text: string;
  /** True for the slide on the screen now: Save then updates it on air. */
  onAir: boolean;
  /** The slide as the projector draws it, with the editor's words and look in place of the saved ones. */
  preview: (draft: { text: string; look: SlideLook | null }) => ReactNode;
  /** Puts this slide on screen (Save & Go Live). */
  goLive: () => Promise<void> | void;
}

interface Props {
  /** The cue being edited. */
  index: number;
  /** Builds the editor's cue for any slide of the item, or null when there is none. */
  cueAt: (index: number) => EditorCue | null;
  /** The segment or item the slide belongs to, for the header. */
  title: string;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Offer the Stage Backdrop quick themes (Praise & Worship slides draw them). */
  backdrop?: boolean;
}

interface Fields {
  text: string;
  tag: string | null;
  label: string;
  notes: string;
  look: SlideLook | null;
}

interface Draft extends Fields {
  /** The slide the draft is for. */
  slideId: string;
  /** The slide as saved when the draft was made: a save made elsewhere resets a draft that has no change of its own. */
  from: Fields;
}



const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const FIELD = 'w-full rounded-lg border border-line bg-canvas/60 px-2.5 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-60';
const SM = '!h-7 !px-2 !text-[11px]';
const CASES: { value: TextCase; label: string }[] = [
  { value: 'original', label: 'Aa' },
  { value: 'uppercase', label: 'AA' },
  { value: 'lowercase', label: 'aa' },
];
/** The quick theme swatches, as the typography card shows them. */
const SWATCH: Record<BackdropThemeId, string> = {
  burgundy: 'linear-gradient(135deg, #3a1218, #2a0c10 55%, #120406)',
  obsidian: 'linear-gradient(135deg, #24262e, #15161b 55%, #0a0b0e)',
  ember: 'linear-gradient(135deg, #3a2810, #291c0c 55%, #110b04)',
  midnight: 'linear-gradient(135deg, #1b2747, #0f172a 55%, #070b15)',
};
const CSS_CASE: Record<TextCase, 'none' | 'uppercase' | 'lowercase'> = { original: 'none', uppercase: 'uppercase', lowercase: 'lowercase' };

/**
 * The Output Preview & Slide Editor: one slide of the item on air, with its preview as the congregation will see it. The words can be typed in
 * the Slide Lines box or straight on the preview; 2 Lines, 3 Lines, UPPER and Title reshape them. Output Formatting changes this slide only
 * (its own look, saved with Save) or every slide (the projector settings, at once), and Reset Override drops the slide's own look. Save writes
 * the words through the console's copy-on-write paths (never Song Lyrics, the Lectionary or the Hub) and Save & Go Live then puts the slide up.
 *
 * It is a modal dialog, so the console's keys (← → Space, 1–9, E, B, L, H) give way while it is open, and it is no-drag throughout so a click
 * on it never turns into a window drag over the top bar. Escape closes it.
 */
export function SlideEditorModal({ index, cueAt, title, onIndex, onClose, backdrop = false }: Props) {
  const t = useGoLiveT();
  const cue = cueAt(index);
  const settings = useLive((s) => s.state.settings);
  const slideBackground = useLive((s) => s.state.welcome.slideBackground);
  const savedLook = useLive((s) => (cue?.lookKey ? s.state.slideLooks?.[cue.lookKey] ?? null : null));
  const meta = useCueMetaOf(cue?.lookKey);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scope, setScope] = useState<'slide' | 'global'>('slide');
  const [lowerThird, setLowerThird] = useState(false);
  const [guides, setGuides] = useState(true);
  const [inline, setInline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // A new slide (the stepper, Add After) starts a new draft. So does a save made elsewhere, as long as this draft has no change of its own.
  const slideId = cue ? `${cue.index}|${cue.target?.key ?? cue.lookKey ?? ''}` : '';
  const saved: Fields | null = cue
    ? { text: cue.target?.text ?? cue.text, tag: cue.target?.tag ?? cue.tag, label: meta.label ?? '', notes: meta.notes ?? '', look: savedLook }
    : null;
  const savedId = saved ? JSON.stringify(saved) : '';
  useEffect(() => {
    if (!saved) return;
    setDraft((d) => (d && d.slideId === slideId && draftChanged(d, d.from) ? d : { ...saved, slideId, from: saved }));
  }, [slideId, savedId]);
  useEffect(() => {
    setConfirmDelete(false);
    setError(null);
    setInline(false);
  }, [index]);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  if (!cue || !draft) return null;
  const target = cue.target;
  const resolved = resolveSlideLook(settings, draft.look, backdropThemeOf(slideBackground));
  const stats = lineStats(draft.text);
  const scaleLabel = resolved.maxFit ? 'MAX' : `${Math.round(resolved.fontScale * 100)}%`;
  const editable = target !== null;
  const edit = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** One formatting change, in the scope chosen: this slide's draft look, or the setting for every slide (saved at once). */
  const format = <K extends SlideLookKey>(key: K, value: NonNullable<SlideLook[K]>) => {
    const change = lookChange(draft.look, key, value, scope);
    edit({ look: change.look });
    if (change.settings) void run(() => bridge.projector.save(change.settings!).then(() => undefined));
    if (change.backdrop) void run(() => bridge.welcome.save({ slideBackground: withBackdropTheme(slideBackground, change.backdrop!) }).then(() => undefined));
  };

  const save = (goLive: boolean) =>
    run(async () => {
      if (target && (draft.text !== target.text || draft.tag !== target.tag)) await target.apply(draft.text, draft.tag);
      if (cue.lookKey) {
        dispatch({ type: 'slideLook/set', key: cue.lookKey, look: sanitizeSlideLook(draft.look) });
        setCueMeta(cue.lookKey, { label: draft.label, notes: draft.notes });
      }
      if (goLive && !cue.onAir) await cue.goLive();
      onClose();
    });

  const addAfter = (text: string) =>
    run(async () => {
      if (!target?.add) return;
      await target.add(text, draft.tag);
      onIndex(cue.index + 1);
    });

  const remove = () =>
    run(async () => {
      if (!target?.remove) return;
      await target.remove();
      setConfirmDelete(false);
      if (cue.count <= 1) onClose();
      else onIndex(Math.min(cue.index, cue.count - 2));
    });

  const shownText = applyTextCase(draft.text, resolved.textCase);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      style={NO_DRAG}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="slide-editor-modal-title"
        tabIndex={-1}
        style={NO_DRAG}
        data-slide-editor-modal
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        className="flex max-h-[92vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl outline-none"
      >
        {/* Header: the slide, where it is, and the stepper through the item's slides. */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2 px-5 py-3.5">
          <div className="min-w-0">
            <h2 id="slide-editor-modal-title" className="text-[15px] font-bold text-fg">{t('consoleEdTitle', { n: pad2(cue.index + 1) })}</h2>
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
              <span className="truncate">{title}</span>
              <span className={`shrink-0 rounded-full border px-2 py-px text-[10px] font-bold tracking-wide uppercase ${cue.onAir ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line text-muted'}`}>
                {cue.onAir ? t('consoleEdOnAir') : t('consoleEdStaged')}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="group" aria-label={t('consoleEdStepper')} className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas/60 p-0.5">
              <button type="button" style={NO_DRAG} disabled={busy || cue.index <= 0} onClick={() => onIndex(cue.index - 1)} className={`${BTN} ${SM} border-transparent bg-transparent`}>
                {t('consoleEdPrev')}
              </button>
              <span className="px-2 font-mono text-[11px] text-muted tabular-nums">
                {pad2(cue.index + 1)} / {pad2(cue.count)}
              </span>
              <button type="button" style={NO_DRAG} disabled={busy || cue.index >= cue.count - 1} onClick={() => onIndex(cue.index + 1)} className={`${BTN} ${SM} border-transparent bg-transparent`}>
                {t('consoleEdNext')}
              </button>
            </div>
            <button type="button" style={NO_DRAG} aria-label={t('consoleEdClose')} title={`${t('consoleEdClose')} (Esc)`} disabled={busy} onClick={onClose} className={`${BTN} ${SM} w-7 !px-0`}>
              <X size={14} aria-hidden />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-1 items-start gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {/* Left: the output preview, with the direct-on-preview editor and the safe areas. */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`${EYEBROW} text-accent`}>{t('consoleEdPreview')}</span>
              <div className="flex items-center gap-2">
                <div role="radiogroup" aria-label={t('consoleEdPreviewMode')} className="flex gap-0.5 rounded-lg border border-line bg-canvas/60 p-0.5">
                  <button type="button" role="radio" style={NO_DRAG} aria-checked={!lowerThird} onClick={() => setLowerThird(false)} className={`${!lowerThird ? BTN_ACTIVE : BTN} ${SM}`}>
                    {t('consoleEdFullStage')}
                  </button>
                  <button type="button" role="radio" style={NO_DRAG} aria-checked={lowerThird} onClick={() => setLowerThird(true)} className={`${lowerThird ? BTN_ACTIVE : BTN} ${SM}`}>
                    {t('consoleEdLowerThird')}
                  </button>
                </div>
                <button type="button" style={NO_DRAG} aria-pressed={guides} onClick={() => setGuides((g) => !g)} className={`${guides ? BTN_ACTIVE : BTN} ${SM}`}>
                  {t('consoleEdGuides')}
                </button>
              </div>
            </div>

            <div className={`${MONITOR} ${editable ? 'cursor-text' : ''}`} data-editor-preview>
              {lowerThird ? (
                // The slide's words as they read in a lower-third band over the stage.
                <div className="absolute inset-0 bg-black">
                  <div className="absolute inset-x-[5%] bottom-[8%] rounded-[1.2cqw] border border-white/15 bg-black/80 px-[2.4cqw] py-[1.6cqh] text-left">
                    <div className="truncate text-[1.6cqw] font-semibold text-gold">{`${title} · ${draft.tag ?? cue.tag}`}</div>
                    <div className="line-clamp-2 text-[2.4cqw] leading-tight font-bold text-white">{shownText.split('\n').join(' ') || '—'}</div>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0">{cue.preview({ text: draft.text, look: draft.look })}</div>
              )}
              {guides && (
                <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
                  <div className="absolute inset-[2.5%] rounded-sm border border-dashed border-sky-400/40" />
                  <div className="absolute inset-[5%] rounded-sm border border-dashed border-gold/50" />
                  <span className="absolute top-[5.6%] left-[5.8%] font-mono text-[1.2cqw] text-gold/80">{t('consoleEdTitleSafe')}</span>
                  <span className="absolute top-[3%] right-[3.2%] font-mono text-[1.2cqw] text-sky-300/80">{t('consoleEdActionSafe')}</span>
                </div>
              )}
              {editable && !inline && (
                <button
                  type="button"
                  style={NO_DRAG}
                  aria-label={t('consoleEdInlineOpen')}
                  onClick={() => setInline(true)}
                  className="absolute inset-0 z-10 cursor-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
                />
              )}
              {editable && inline && (
                <InlineEditor
                  value={draft.text}
                  label={t('consoleEdInlineLabel')}
                  align={resolved.align ?? 'center'}
                  textCase={resolved.textCase}
                  onChange={(text) => edit({ text })}
                  onDone={() => setInline(false)}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
              <span className="font-mono tabular-nums" data-editor-stats>
                {t(stats.lines === 1 ? 'consoleEdStatsOne' : 'consoleEdStats', { lines: stats.lines, chars: stats.maxChars, scale: scaleLabel })}
              </span>
              <span>{editable ? t('consoleEdClickHint') : t('consoleEdReadOnly')}</span>
            </div>
          </div>

          {/* Right: the cue's details, the text helpers, and the slide's formatting. */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="min-w-0">
                <label htmlFor="ed-label" className="mb-1.5 block text-xs text-muted">{t('consoleEdLabel')}</label>
                <input
                  id="ed-label"
                  value={draft.label}
                  disabled={!cue.lookKey}
                  maxLength={300}
                  placeholder={t('consoleEdLabelPlaceholder', { n: pad2(cue.index + 1) })}
                  onChange={(e) => edit({ label: e.target.value })}
                  className={`${FIELD} h-9 py-0`}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="ed-tag" className="mb-1.5 block text-xs text-muted">{t('consoleSectionTag')}</label>
                {target?.tagOptions ? (
                  <select id="ed-tag" value={draft.tag ?? ''} disabled={busy} onChange={(e) => edit({ tag: e.target.value })} className={`${FIELD} h-9 py-0`}>
                    {[...new Set([draft.tag ?? '', ...target.tagOptions])].filter(Boolean).map((tag) => (
                      <option key={tag} value={tag} className="bg-surface">
                        {tag}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p id="ed-tag" className={`${FIELD} flex h-9 items-center py-0 text-fg/85`}>
                    <span className="truncate">{draft.tag ?? cue.tag ?? '—'}</span>
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="ed-lines" className="text-xs text-muted">{t('consoleEdLines')}</label>
                <div role="group" aria-label={t('consoleEdHelpers')} className="flex gap-1">
                  <button type="button" style={NO_DRAG} disabled={!editable || busy} onClick={() => edit({ text: balanceLines(draft.text, 2) })} className={`${BTN} ${SM}`}>
                    {t('consoleEd2Lines')}
                  </button>
                  <button type="button" style={NO_DRAG} disabled={!editable || busy} onClick={() => edit({ text: balanceLines(draft.text, 3) })} className={`${BTN} ${SM}`}>
                    {t('consoleEd3Lines')}
                  </button>
                  <button type="button" style={NO_DRAG} disabled={!editable || busy} onClick={() => edit({ text: draft.text.toLocaleUpperCase() })} className={`${BTN} ${SM}`}>
                    {t('consoleEdUpper')}
                  </button>
                  <button type="button" style={NO_DRAG} disabled={!editable || busy} onClick={() => edit({ text: toTitleCase(draft.text) })} className={`${BTN} ${SM}`}>
                    {t('consoleEdTitleCase')}
                  </button>
                </div>
              </div>
              <textarea
                id="ed-lines"
                rows={Math.min(8, Math.max(4, draft.text.split('\n').length))}
                value={draft.text}
                readOnly={!editable}
                disabled={busy}
                onChange={(e) => edit({ text: e.target.value })}
                className={`${FIELD} resize-y leading-snug`}
              />
            </div>

            <div>
              <label htmlFor="ed-notes" className="mb-1.5 block text-xs text-muted">{t('consoleEdNotes')}</label>
              <input
                id="ed-notes"
                value={draft.notes}
                disabled={!cue.lookKey}
                maxLength={300}
                placeholder={t('consoleEdNotesPlaceholder')}
                onChange={(e) => edit({ notes: e.target.value })}
                className={`${FIELD} h-9 py-0`}
              />
            </div>

            <section aria-labelledby="ed-format" className="flex flex-col gap-2.5 border-t border-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="ed-format" className="text-xs font-bold text-fg">{t('consoleEdFormatting')}</h3>
                <div className="flex items-center gap-2">
                  {resolved.hasOverride && (
                    <button type="button" style={NO_DRAG} onClick={() => edit({ look: null })} className="rounded text-[11px] font-bold text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
                      {t('consoleEdReset')}
                    </button>
                  )}
                  <div role="radiogroup" aria-label={t('consoleEdScope')} className="flex gap-0.5 rounded-lg border border-line bg-canvas/60 p-0.5">
                    <button type="button" role="radio" style={NO_DRAG} aria-checked={scope === 'slide'} disabled={!cue.lookKey} onClick={() => setScope('slide')} className={`${scope === 'slide' ? BTN_ACTIVE : BTN} ${SM}`}>
                      {t('consoleEdThisSlide')}
                    </button>
                    <button type="button" role="radio" style={NO_DRAG} aria-checked={scope === 'global'} onClick={() => setScope('global')} className={`${scope === 'global' ? BTN_ACTIVE : BTN} ${SM}`}>
                      {t('consoleEdAllSlides')}
                    </button>
                  </div>
                </div>
              </div>
              {scope === 'global' && <p className="text-[11px] text-muted">{t('consoleEdGlobalHint')}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="radiogroup" aria-label={t('consoleEdCase')} className="flex items-center gap-1">
                  <span className="mr-1 text-[11px] text-muted">{t('consoleEdCase')}</span>
                  {CASES.map((c) => (
                    <button key={c.value} type="button" role="radio" style={NO_DRAG} aria-checked={resolved.textCase === c.value} onClick={() => format('textCase', c.value)} className={`${resolved.textCase === c.value ? BTN_ACTIVE : BTN} ${SM}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div role="radiogroup" aria-label={t('consoleEdAlign')} className="flex items-center gap-1">
                  <span className="mr-1 text-[11px] text-muted">{t('consoleEdAlign')}</span>
                  {SLIDE_ALIGNS.map((a) => (
                    <button key={a} type="button" role="radio" style={NO_DRAG} aria-checked={(resolved.align ?? 'center') === a} onClick={() => format('align', a)} className={`${(resolved.align ?? 'center') === a ? BTN_ACTIVE : BTN} ${SM}`}>
                      {t(ALIGN_LABEL[a])}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-muted">{t('consoleScale')}</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" style={NO_DRAG} aria-label={t('consoleEdSmaller')} disabled={!resolved.maxFit && resolved.fontScale <= SLIDE_FONT_SCALES[0]} onClick={() => format('fontScale', stepScale(resolved.fontScale, -1))} className={`${BTN} ${SM} w-8 !px-0 font-extrabold`}>
                    A−
                  </button>
                  <span className="w-11 text-center font-mono text-[11px] font-bold text-accent tabular-nums" aria-live="polite">{scaleLabel}</span>
                  <button type="button" style={NO_DRAG} aria-label={t('consoleEdLarger')} disabled={!resolved.maxFit && resolved.fontScale >= SLIDE_FONT_SCALES[SLIDE_FONT_SCALES.length - 1]} onClick={() => format('fontScale', stepScale(resolved.fontScale, 1))} className={`${BTN} ${SM} w-8 !px-0 font-extrabold`}>
                    A+
                  </button>
                  <button type="button" role="switch" style={NO_DRAG} aria-checked={resolved.maxFit} onClick={() => format('maxFit', !resolved.maxFit)} className={`${resolved.maxFit ? BTN_ACTIVE : BTN} ${SM} font-extrabold tracking-wider`}>
                    {t('consoleEdMax')}
                  </button>
                </div>
              </div>
              {backdrop && (
                <div role="radiogroup" aria-label={t('consoleBackdrop')} className="grid grid-cols-2 gap-1.5">
                  {BACKDROP_THEMES.map(({ id }) => (
                    <button key={id} type="button" role="radio" style={NO_DRAG} aria-checked={resolved.backdrop === id} onClick={() => format('backdrop', id)} className={`${resolved.backdrop === id ? BTN_ACTIVE : BTN} ${SM} justify-start`}>
                      <span aria-hidden className="size-3.5 shrink-0 rounded border border-white/15" style={{ background: SWATCH[id] }} />
                      {t(`backdrop_${id}`)}
                    </button>
                  ))}
                </div>
              )}
            </section>
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Footer: the slide's own actions on the left, closing and saving on the right. */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" style={NO_DRAG} disabled={busy || !target?.add || !draft.text.trim()} onClick={() => void addAfter(draft.text)} className={BTN}>
              {t('consoleEdDuplicate')}
            </button>
            <button type="button" style={NO_DRAG} disabled={busy || !target?.add} onClick={() => void addAfter(t('consoleEdNewSlideText'))} className={BTN}>
              {t('consoleEdAddAfter')}
            </button>
            {confirmDelete ? (
              <div role="group" aria-label={t('consoleEdDelete')} className="flex gap-1.5">
                <button type="button" style={NO_DRAG} disabled={busy} onClick={() => void remove()} className={BTN_DANGER_ACTIVE}>
                  {t('consoleConfirmDelete')}
                </button>
                {/* Cancel has the focus, so an Enter pressed by slip never deletes. */}
                <button type="button" style={NO_DRAG} autoFocus disabled={busy} onClick={() => setConfirmDelete(false)} className={BTN}>
                  {t('consoleCancel')}
                </button>
              </div>
            ) : (
              <button type="button" style={NO_DRAG} disabled={busy || !target?.remove} title={target && !target.remove ? t('consoleDeleteOne') : undefined} onClick={() => setConfirmDelete(true)} className={BTN_DANGER}>
                {t('consoleEdDelete')}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" style={NO_DRAG} disabled={busy} onClick={onClose} className={BTN}>
              {t('consoleCancel')}
            </button>
            <button type="button" style={NO_DRAG} disabled={busy} onClick={() => void save(false)} className={BTN_ACTIVE}>
              {t('consoleEdSave')}
            </button>
            <button type="button" style={NO_DRAG} disabled={busy} onClick={() => void save(true)} className={BTN_PRIMARY}>
              {cue.onAir ? t('consoleEdSaveUpdate') : t('consoleEdSaveLive')}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const ALIGN_LABEL: Record<SlideAlign, string> = { left: 'consoleAlignLeft', center: 'consoleAlignCenter', right: 'consoleAlignRight' };

/**
 * The words typed straight on the preview: a box over the slide in the slide's own case and alignment, growing with its lines, and in step
 * with the Slide Lines box. Escape or a click away puts the preview back.
 */
function InlineEditor({ value, label, align, textCase, onChange, onDone }: { value: string; label: string; align: SlideAlign; textCase: TextCase; onChange: (text: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-[5%]">
      <textarea
        ref={ref}
        aria-label={label}
        rows={1}
        value={value}
        style={{ ...NO_DRAG, textAlign: align, textTransform: CSS_CASE[textCase] }}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onDone}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
        className="max-h-full w-[92%] resize-none overflow-hidden rounded-lg border-0 bg-transparent px-2 py-1 text-[4.2cqw] leading-[1.15] font-extrabold tracking-tight text-white shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-gold)_75%,transparent)] outline-none"
      />
    </div>
  );
}
