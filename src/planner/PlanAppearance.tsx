// Plan Appearance in the Planner: the toolbar button (with a swatch of the plan's look) and its drawer, where the operator sets the default
// background and type of every slide in a Holy Mass or Praise & Worship plan, with a live 16:9 preview drawn by the projector's own renderer.
// Changes show at once in the drawer and are saved (and sent to the screens, when the plan is loaded in Go Live) a moment later.
// The rules are in shared/plan-appearance.js; the saving and the live state in ./planAppearanceStore.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlignCenter, AlignLeft, AlignRight, Check, ChevronDown, Eye, EyeOff, Film, ImageIcon, Minus, Palette, Pin, PinOff, Plus, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import {
  PLAN_APPEARANCE_DEFAULT,
  PLAN_COLOR_PRESETS,
  PLAN_DIM_MAX,
  PLAN_FONTS,
  PLAN_FONT_SIZES,
  PLAN_TEXT_COLORS,
  PLAN_WEIGHT_CSS,
  planAppearanceBadge,
  planFontCss,
  planFontSizeLabel,
  stepPlanFontSize,
  type PlanAppearance,
  type PlanBackgroundType,
  type PlanFontSize,
  type PlanKind,
  type PlanTypography,
} from '../../shared/plan-appearance.js';
import { planSlideLookCount } from '../../shared/slide-look.js';
import { TEXT_FONTS, normalizeHex } from '../../shared/text-style.js';
import type { Frame } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { NO_DRAG, TITLE_BAR_CLEARANCE } from '../components/appRegion';
import { FramePreview } from '../output/ProjectorView';
import { PlanLookOverride } from '../output/outputState';
import { getSlideImageUrl } from '../output/slideImage';
import { PwStageFace, type Shown } from '../praise-worship/CurrentNextPreview';
import type { MediaAsset } from '../media/types';
import { changePlanAppearance, clearPlanSlideOverrides, flushPlanAppearance, loadPlanAppearance, usePlanAppearance, usePlanAppearances } from './planAppearanceStore';
import { usePlannerT, type PlannerT } from './strings';

type Sample = 'song' | 'prayer';
type JumpKey = 'background' | 'size' | 'color';

// Synthetic sample slides only: the preview never shows a real song, prayer or reading.
const SAMPLE_LINES = ['Sample Song Line', 'Sample Song Line Two', 'Sample Song Line Three', 'Sample Song Line Four'];
const SAMPLE_PRAYER = 'Sample Prayer Line, read together by everyone gathered here.\nSample Prayer Line Two, a second line of the same prayer.';

const MASS_SAMPLES: Record<Sample, Frame> = {
  song: { kind: 'lyrics', title: 'Sample Plan Title', label: 'VERSE 1', text: SAMPLE_LINES.join('\n') },
  prayer: { kind: 'text', title: 'Sample Plan Title', headline: 'Sample Prayer', text: SAMPLE_PRAYER, bg: null },
};

const PW_SAMPLES: Record<Sample, Shown> = {
  song: {
    slide: { kind: 'lyrics', label: 'VERSE 1', chip: 'V1', text: SAMPLE_LINES.join('\n'), hymnId: 0, hymnTitle: 'Sample Song Title', sectionId: 'sample-v1' },
    segmentName: 'Sample Segment',
    type: 'song',
    index: 1,
    total: 4,
  },
  prayer: { slide: { kind: 'prayer', label: 'Sample Prayer', text: SAMPLE_PRAYER }, segmentName: 'Sample Segment', type: 'prayer', index: 0, total: 2 },
};

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
const CHIP = `inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const chipClass = (on: boolean) => `${CHIP} ${on ? 'border-accent bg-accent text-on-accent shadow' : 'border-fg/20 bg-surface text-fg hover:border-fg/40'}`;
// The preview docks (sticky, compact) once the body is scrolled past DOCK_ON, and undocks near the top (DOCK_OFF) so it never flickers.
const DOCK_ON = 24;
const DOCK_OFF = 8;
const DOCK_PREVIEW_HEIGHT = 145; // px, 16:9 kept by the aspect ratio
const LABEL = 'text-xs font-bold tracking-wider text-fg/80 uppercase';

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Button

/** The Planner toolbar's Plan Appearance button, with a swatch of the plan's look and its mode. It opens the drawer. */
export function PlanAppearanceButton({ kind, planId, planName }: { kind: PlanKind; planId: number; planName?: string }) {
  const t = usePlannerT();
  const appearance = usePlanAppearance(kind, planId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void loadPlanAppearance(kind, planId);
  }, [kind, planId]);
  const badge = planAppearanceBadge(appearance);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={NO_DRAG}
        className={`inline-flex h-10 items-center gap-2 rounded-full border border-fg/20 bg-surface px-3 text-sm font-bold text-fg shadow-sm transition hover:border-accent ${FOCUS}`}
      >
        <Swatch badge={badge} />
        <span>{t('appearance_button')}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ${badge.custom ? 'bg-accent text-on-accent' : 'bg-fg/10 text-fg'}`}>
          {badge.custom ? t('appearance_badge_custom') : t('appearance_badge_global')}
        </span>
      </button>
      {open && <PlanAppearanceDrawer kind={kind} planId={planId} planName={planName} onClose={() => setOpen(false)} />}
    </>
  );
}

function Swatch({ badge }: { badge: ReturnType<typeof planAppearanceBadge> }) {
  return (
    <span aria-hidden className="relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-full border border-fg/30" style={{ backgroundColor: badge.color ?? undefined }}>
      {badge.thumb && !badge.motion && <img src={getSlideImageUrl(badge.thumb)} alt="" className="absolute inset-0 size-full object-cover" />}
      {badge.motion && <Film size={12} className="relative text-white drop-shadow" />}
      {!badge.custom && <Palette size={13} className="text-fg" />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Drawer

function PlanAppearanceDrawer({ kind, planId, planName, onClose }: { kind: PlanKind; planId: number; planName?: string; onClose: () => void }) {
  const t = usePlannerT();
  const appearance = usePlanAppearance(kind, planId) ?? PLAN_APPEARANCE_DEFAULT;
  const error = usePlanAppearances((s) => s.errors[`${kind}:${planId}`] ?? null);
  const loaded = useLive((s) => (kind === 'mass' ? s.state.queuePlanId === planId : s.state.pw?.sessionId === planId));
  const overrides = useLive((s) => (loaded ? planSlideLookCount(s.state.slideLooks, kind, planId) : 0));
  const [sample, setSample] = useState<Sample>('song');
  const [cleared, setCleared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const fullHeight = useRef(0);
  const [scrolled, setScrolled] = useState(false);
  const [floatOn, setFloatOn] = useState(true);
  const [spacer, setSpacer] = useState(0);
  const docked = scrolled && floatOn;

  const onBodyScroll = () => {
    const top = bodyRef.current?.scrollTop ?? 0;
    // Remember the full-size height just before docking, so the layout below can keep its place.
    if (!docked && top > DOCK_ON && previewRef.current) fullHeight.current = previewRef.current.offsetHeight;
    setScrolled((was) => (was ? top > DOCK_OFF : top > DOCK_ON));
  };
  // While docked the card is shorter than it was; the difference is kept as bottom margin so nothing below jumps up or down.
  useLayoutEffect(() => {
    if (!docked) {
      setSpacer(0);
      return;
    }
    const now = previewRef.current?.offsetHeight ?? 0;
    setSpacer(Math.max(0, fullHeight.current - now));
  }, [docked, showPreview, sample]);

  // Quick-jump: scrolls the drawer body to a section in one tap (no mouse wheel needed). Smooth unless the system asks for less motion.
  const jumpTo = (key: JumpKey) => {
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>(`[data-jump="${key}"]`);
    if (!body || !target) return;
    const top = body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top: Math.max(0, top), behavior: calm ? 'auto' : 'smooth' });
  };

  // Any change saves (after a short pause) and turns on Custom Plan Look: a choice made here is meant to be seen.
  const change = (next: Partial<PlanAppearance>, keepMode = false) => {
    setSaving(true);
    setCleared(false);
    changePlanAppearance(kind, planId, { ...appearance, ...next, enabled: keepMode ? (next.enabled ?? appearance.enabled) : true });
  };
  const setBackground = (patch: Partial<PlanAppearance['background']>) => change({ background: { ...appearance.background, ...patch } });
  const setType = (patch: Partial<PlanTypography>) => {
    const typography: PlanTypography = { ...appearance.typography, ...patch };
    for (const key of Object.keys(patch) as (keyof PlanTypography)[]) if (patch[key] === undefined) delete typography[key];
    change({ typography });
  };

  useEffect(() => {
    if (!saving) return;
    const timer = window.setTimeout(() => setSaving(false), 700);
    return () => window.clearTimeout(timer);
  }, [saving, appearance]);

  // Escape closes (an open font list takes it first, and closes itself); anything still waiting is saved on the way out. Run once per plan:
  // the parent's onClose is a new function each render, so it is read through a ref, and focus is never pulled off the control in use.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // The scroll body takes focus (not a control), so Page Up/Down and the arrow keys scroll the drawer straight away.
    (bodyRef.current ?? dialogRef.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dialogRef.current?.querySelector('[data-font-list]')) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      flushPlanAppearance(kind, planId);
    };
  }, [kind, planId]);

  const preview = appearance.enabled ? appearance : null;
  const subtitle = kind === 'mass' ? t('appearance_subtitle_mass') : t('appearance_subtitle_pw');

  return createPortal(
    <div className="fixed inset-0 z-[80]" style={NO_DRAG}>
      <div aria-hidden className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" style={NO_DRAG} onClick={onClose} />
      {/* A viewport-bounded flex column (top and bottom pinned, so it can never be taller than the window): only the body scrolls. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-appearance-title"
        tabIndex={-1}
        style={{ ...NO_DRAG, top: TITLE_BAR_CLEARANCE }}
        className="absolute right-0 bottom-0 flex max-h-screen w-[min(620px,100vw)] flex-col overflow-hidden border-l border-fg/15 bg-surface text-fg shadow-2xl shadow-black/50 outline-none"
      >
        <header className="flex items-start gap-3 border-b border-fg/10 px-5 py-3" style={NO_DRAG}>
          <div className="min-w-0 flex-1">
            <h2 id="plan-appearance-title" className="text-xl font-extrabold tracking-tight">
              {t('appearance_title')}
            </h2>
            <p className="mt-0.5 truncate text-sm text-fg/80">{planName ? `${planName} · ${subtitle}` : subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('appearance_close')} className={`grid size-9 place-items-center rounded-full border border-fg/20 hover:bg-fg/10 ${FOCUS}`}>
            <X size={18} aria-hidden />
          </button>
        </header>

        {/* Quick-jump pills: one tap to Background, Size & Font or Color & Shadow, so a touchpad never has to scroll far. */}
        <nav aria-label={t('appearance_jump')} className="flex flex-wrap items-center gap-1.5 border-b border-fg/10 px-5 py-2" style={NO_DRAG}>
          {(
            [
              ['background', t('appearance_jump_background')],
              ['size', t('appearance_jump_size')],
              ['color', t('appearance_jump_color')],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" data-jump-pill={key} onClick={() => jumpTo(key)} className={chipClass(false)}>
              {label}
            </button>
          ))}
        </nav>

        <div
          ref={bodyRef}
          data-plan-scroll
          tabIndex={-1}
          onScroll={onBodyScroll}
          style={{ ...NO_DRAG, touchAction: 'pan-y' }}
          className="plan-appearance-scroll min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4 outline-none"
        >
          {/* Live 16:9 preview, drawn by the projector's own renderer with the draft look. */}
          <section
            ref={previewRef}
            aria-label={t('appearance_preview')}
            data-plan-preview-dock={docked ? 'floating' : 'full'}
            style={{ ...NO_DRAG, touchAction: 'pan-y', marginBottom: docked && spacer ? spacer : undefined }}
            className={
              docked
                ? 'sticky top-0 z-20 -mx-5 -mt-4 space-y-1.5 border-b border-accent/50 bg-surface px-5 py-2 shadow-lg shadow-black/40 ring-1 ring-accent/30 backdrop-blur-md transition-shadow'
                : 'space-y-1.5'
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL}>{t('appearance_preview')}</span>
              <div className="flex items-center gap-1">
                <button type="button" data-preview-toggle aria-pressed={!showPreview} aria-expanded={showPreview} aria-controls="plan-appearance-preview" onClick={() => setShowPreview((v) => !v)} className={chipClass(false)}>
                  {showPreview ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  {showPreview ? t('appearance_hide_preview') : t('appearance_show_preview')}
                </button>
                <button
                  type="button"
                  data-preview-pin
                  aria-pressed={floatOn}
                  title={floatOn ? t('appearance_preview_unpin') : t('appearance_preview_pin')}
                  onClick={() => setFloatOn((v) => !v)}
                  className={chipClass(false)}
                >
                  {floatOn ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
                  {floatOn ? t('appearance_preview_unpin') : t('appearance_preview_pin')}
                </button>
                <div role="radiogroup" aria-label={t('appearance_sample')} className="flex gap-1">
                  {(['song', 'prayer'] as const).map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={sample === s} onClick={() => setSample(s)} className={chipClass(sample === s)}>
                      {s === 'song' ? t('appearance_sample_song') : t('appearance_sample_prayer')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {showPreview && (
              <div id="plan-appearance-preview" className="space-y-1.5">
                {/* Full size: capped near a third of the window height. Docked: a fixed compact height. Width follows, keeping 16:9. */}
                <div
                  data-plan-preview
                  className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg border border-fg/20 bg-black [container-type:size]"
                  style={{ maxWidth: docked ? `${(DOCK_PREVIEW_HEIGHT * 16) / 9}px` : 'calc(34vh * 16 / 9)' }}
                >
                  <PlanLookOverride.Provider value={preview}>
                    {kind === 'mass' ? <FramePreview frame={MASS_SAMPLES[sample]} /> : <PwStageFace shown={PW_SAMPLES[sample]} />}
                  </PlanLookOverride.Provider>
                  {/* Title Safe guide: the words stay inside it at every size and font. */}
                  <div aria-hidden className="pointer-events-none absolute inset-[5%] rounded-sm border border-dashed border-white/40" />
                </div>
                {!docked && <p className="text-xs text-fg/75">{t('appearance_title_safe')}</p>}
              </div>
            )}
          </section>

          {/* Mode and quick actions */}
          <section className="space-y-3">
            <span className={LABEL}>{t('appearance_mode')}</span>
            <div role="radiogroup" aria-label={t('appearance_mode')} className="grid grid-cols-2 gap-2">
              {([false, true] as const).map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  role="radio"
                  aria-checked={appearance.enabled === on}
                  onClick={() => change({ enabled: on }, true)}
                  className={`flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition ${FOCUS} ${
                    appearance.enabled === on ? 'border-accent bg-accent text-on-accent shadow' : 'border-fg/20 bg-surface hover:border-fg/40'
                  }`}
                >
                  {on ? <Sparkles size={16} aria-hidden /> : <Palette size={16} aria-hidden />}
                  {on ? t('appearance_mode_custom') : t('appearance_mode_global')}
                </button>
              ))}
            </div>
            {!appearance.enabled && <p className="text-xs text-fg/75">{t('appearance_mode_global_hint')}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" title={t('appearance_reset_tip')} onClick={() => change(PLAN_APPEARANCE_DEFAULT, true)} className={chipClass(false)}>
                <RotateCcw size={14} aria-hidden />
                {t('appearance_reset')}
              </button>
              <button
                type="button"
                title={t('appearance_overwrite_tip')}
                disabled={overrides === 0}
                onClick={() => {
                  clearPlanSlideOverrides(kind, planId);
                  setCleared(true);
                }}
                className={chipClass(false)}
              >
                <Check size={14} aria-hidden />
                {t('appearance_overwrite')}
              </button>
            </div>
            <p role="status" className="text-xs text-fg/75">
              {cleared ? t('appearance_overwrite_done') : overrides > 0 ? t('appearance_overwrite_count', { count: overrides }) : t('appearance_overwrite_none')}
            </p>
          </section>

          <BackgroundSection t={t} appearance={appearance} setBackground={setBackground} />
          <TypographySection t={t} typography={appearance.typography} setType={setType} />
        </div>

        <footer className="space-y-1 border-t border-fg/10 px-5 py-2 text-xs" style={NO_DRAG}>
          {error ? (
            <p role="alert" className="font-semibold text-danger">
              {error}
            </p>
          ) : (
            <p role="status" className="font-semibold text-fg/80">
              {saving ? t('appearance_saving') : t('appearance_saved')} · {loaded ? t('appearance_loaded') : t('appearance_not_loaded')}
            </p>
          )}
          <p className="text-fg/75">{t('appearance_precedence')}</p>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Background

function BackgroundSection({ t, appearance, setBackground }: { t: PlannerT; appearance: PlanAppearance; setBackground: (patch: Partial<PlanAppearance['background']>) => void }) {
  const bg = appearance.background;
  const [media, setMedia] = useState<MediaAsset[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const reload = () => bridge.media.list().then(setMedia).catch(() => setMedia([]));
  useEffect(() => {
    void reload();
  }, []);

  const kindOf = (type: PlanBackgroundType) => (type === 'motion' ? 'video' : 'image');
  const assetOf = (id: string | undefined) => media?.find((m) => String(m.id) === id) ?? null;

  // A tab keeps the chosen file only when it is of the tab's kind, so a picture is never played as a motion clip.
  const pickTab = (type: PlanBackgroundType) => {
    if (type === bg.type) return;
    const current = assetOf(bg.mediaId);
    const keep = type !== 'color' && current?.mediaType === kindOf(type);
    if (type === 'color' || keep) setBackground({ type });
    else setBackground({ type, mediaPath: undefined, mediaId: undefined });
  };

  const importInto = async (type: PlanBackgroundType) => {
    setImporting(true);
    setImportError(null);
    try {
      const before = new Set((media ?? []).map((m) => m.id));
      const result = await bridge.media.importMedia(null);
      const list = await bridge.media.list();
      setMedia(list);
      // The newest file of the tab's kind is picked, so one import is one step.
      const added = list.filter((m) => !before.has(m.id) && m.mediaType === kindOf(type)).sort((a, b) => b.id - a.id)[0];
      if (added) setBackground({ type, mediaPath: added.src });
      if (result.failed.length > 0) setImportError(result.failed.join(', '));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const tabs: { type: PlanBackgroundType; label: string; icon: ReactNode }[] = [
    { type: 'color', label: t('appearance_bg_color'), icon: <Palette size={15} aria-hidden /> },
    { type: 'image', label: t('appearance_bg_image'), icon: <ImageIcon size={15} aria-hidden /> },
    { type: 'motion', label: t('appearance_bg_motion'), icon: <Film size={15} aria-hidden /> },
  ];
  const assets = (media ?? []).filter((m) => m.mediaType === kindOf(bg.type));

  return (
    <section className="space-y-3" data-jump="background">
      <span className={LABEL}>{t('appearance_background')}</span>
      <div role="tablist" aria-label={t('appearance_background')} className="grid grid-cols-3 gap-1 rounded-full border border-fg/20 bg-panel-2 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.type}
            type="button"
            role="tab"
            aria-selected={bg.type === tab.type}
            onClick={() => pickTab(tab.type)}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full text-sm font-bold transition ${FOCUS} ${
              bg.type === tab.type ? 'bg-accent text-on-accent shadow' : 'text-fg hover:bg-fg/10'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* The colour is the slide's ground under a picture or clip too, and what shows while none is picked. */}
      <ColorRow
        label={t('appearance_bg_color')}
        value={bg.color ?? PLAN_APPEARANCE_DEFAULT.background.color ?? '#000000'}
        presets={PLAN_COLOR_PRESETS.map((p) => ({ hex: p.hex, label: p.label }))}
        customLabel={t('appearance_custom_color')}
        hexLabel={t('appearance_hex')}
        onChange={(color) => setBackground({ color })}
      />

      {bg.type !== 'color' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{bg.type === 'image' ? t('appearance_bg_image') : t('appearance_bg_motion')}</span>
            <button type="button" onClick={() => void importInto(bg.type)} disabled={importing} className={chipClass(false)}>
              <Upload size={14} aria-hidden />
              {importing ? t('appearance_importing') : t('appearance_import')}
            </button>
          </div>
          {media !== null && assets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-fg/25 px-3 py-4 text-center text-sm text-fg/80">
              {bg.type === 'image' ? t('appearance_no_images') : t('appearance_no_motion')}
            </p>
          ) : (
            <div role="listbox" aria-label={bg.type === 'image' ? t('appearance_bg_image') : t('appearance_bg_motion')} className="plan-appearance-scroll grid max-h-56 grid-cols-3 gap-2 overflow-y-auto overscroll-auto pr-1 sm:grid-cols-4">
              {assets.map((asset) => {
                const on = bg.mediaId === String(asset.id);
                const thumb = asset.thumbSrc ?? (asset.mediaType === 'image' ? asset.src : null);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    title={asset.filename}
                    onClick={() => setBackground({ mediaPath: asset.src })}
                    className={`group relative aspect-video overflow-hidden rounded-md border-2 bg-black transition ${FOCUS} ${on ? 'border-accent' : 'border-transparent hover:border-fg/40'}`}
                  >
                    {thumb ? (
                      <img src={getSlideImageUrl(thumb)} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <Film size={18} aria-hidden className="absolute inset-0 m-auto text-white/80" />
                    )}
                    {asset.mediaType === 'video' && <Film size={12} aria-hidden className="absolute top-1 left-1 text-white drop-shadow" />}
                    {on && (
                      <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-accent text-on-accent">
                        <Check size={12} aria-hidden />
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[10px] text-white">{asset.filename}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!bg.mediaId && assets.length > 0 && <p className="text-xs text-fg/75">{bg.type === 'image' ? t('appearance_pick_image') : t('appearance_pick_motion')}</p>}
          {importError && (
            <p role="alert" className="text-xs font-semibold text-danger">
              {importError}
            </p>
          )}
        </div>
      )}

      <label className="block space-y-1">
        <span className="flex items-center justify-between text-sm font-semibold">
          {t('appearance_dim')}
          <span className="font-mono text-xs">{Math.round((bg.dimOpacity ?? 0) * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={PLAN_DIM_MAX}
          step={0.05}
          value={bg.dimOpacity ?? 0}
          onChange={(e) => setBackground({ dimOpacity: Number(e.target.value) })}
          className="w-full accent-[var(--color-accent)]"
          style={{ ...NO_DRAG, touchAction: 'pan-y' }}
        />
        <span className="block text-xs text-fg/75">{t('appearance_dim_hint')}</span>
      </label>
    </section>
  );
}

/** Colour swatches, the system colour picker and a hex box. */
function ColorRow({
  label,
  value,
  presets,
  customLabel,
  hexLabel,
  onChange,
  globalChip,
}: {
  label: string;
  value: string | null;
  presets: { hex: string; label: string }[];
  customLabel: string;
  hexLabel: string;
  onChange: (hex: string) => void;
  globalChip?: ReactNode;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {globalChip}
      {presets.map((p) => (
        <button
          key={p.hex}
          type="button"
          title={p.label}
          aria-label={p.label}
          aria-pressed={value === p.hex}
          onClick={() => onChange(p.hex)}
          className={`size-8 rounded-full border-2 transition ${FOCUS} ${value === p.hex ? 'border-accent ring-2 ring-accent/50' : 'border-fg/30 hover:border-fg/60'}`}
          style={{ backgroundColor: p.hex }}
        />
      ))}
      <label className={`relative size-8 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-fg/40 ${FOCUS}`} title={customLabel}>
        <span className="sr-only">{customLabel}</span>
        <input type="color" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        <span aria-hidden className="absolute inset-0" style={{ background: value ?? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} />
      </label>
      <input
        aria-label={hexLabel}
        value={text}
        maxLength={7}
        onChange={(e) => {
          setText(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
        }}
        className={`h-8 w-24 rounded-md border border-fg/20 bg-surface px-2 font-mono text-xs text-fg uppercase ${FOCUS}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Typography

function TypographySection({ t, typography, setType }: { t: PlannerT; typography: PlanTypography; setType: (patch: Partial<PlanTypography>) => void }) {
  const size = typography.fontSizeScale;
  const globalChip = (on: boolean, clear: () => void) => (
    <button type="button" title={t('appearance_global_tip')} aria-pressed={on} onClick={clear} className={chipClass(on)}>
      {t('appearance_global')}
    </button>
  );
  return (
    <section className="space-y-4">
      <span className={LABEL}>{t('appearance_typography')}</span>

      <Field label={t('appearance_font_size')} jump="size">
        <div className="flex flex-wrap items-center gap-1.5">
          {globalChip(size === undefined, () => setType({ fontSizeScale: undefined }))}
          <button type="button" aria-label={t('appearance_smaller')} title={t('appearance_smaller')} disabled={size === PLAN_FONT_SIZES[0]} onClick={() => setType({ fontSizeScale: stepPlanFontSize(size, -1) })} className={chipClass(false)}>
            <Minus size={14} aria-hidden />A
          </button>
          {PLAN_FONT_SIZES.map((s: PlanFontSize) => (
            <button key={String(s)} type="button" aria-pressed={size === s} onClick={() => setType({ fontSizeScale: s })} className={chipClass(size === s)}>
              {planFontSizeLabel(s)}
            </button>
          ))}
          <button type="button" aria-label={t('appearance_larger')} title={t('appearance_larger')} disabled={size === 'max'} onClick={() => setType({ fontSizeScale: stepPlanFontSize(size, 1) })} className={chipClass(false)}>
            <Plus size={14} aria-hidden />A
          </button>
        </div>
      </Field>

      <span className={LABEL}>{t('appearance_font_style')}</span>
      <Field label={t('appearance_font_family')}>
        <FontPicker t={t} value={typography.fontFamily} onChange={(fontFamily) => setType({ fontFamily })} />
      </Field>

      <Field label={t('appearance_weight')}>
        <div className="flex flex-wrap gap-1.5">
          {globalChip(typography.fontWeight === undefined, () => setType({ fontWeight: undefined }))}
          {(['normal', 'semibold', 'bold'] as const).map((w) => (
            <button key={w} type="button" aria-pressed={typography.fontWeight === w} onClick={() => setType({ fontWeight: w })} className={chipClass(typography.fontWeight === w)} style={{ fontWeight: PLAN_WEIGHT_CSS[w] }}>
              {t(`appearance_weight_${w}`)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('appearance_case')}>
        <div className="flex flex-wrap gap-1.5">
          {globalChip(typography.textCase === undefined, () => setType({ textCase: undefined }))}
          {(['none', 'upper'] as const).map((c) => (
            <button key={c} type="button" aria-pressed={typography.textCase === c} onClick={() => setType({ textCase: c })} className={chipClass(typography.textCase === c)}>
              {t(`appearance_case_${c}`)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('appearance_align')}>
        <div className="flex flex-wrap gap-1.5">
          {globalChip(typography.textAlign === undefined, () => setType({ textAlign: undefined }))}
          {(
            [
              ['center', <AlignCenter key="c" size={14} aria-hidden />],
              ['left', <AlignLeft key="l" size={14} aria-hidden />],
              ['right', <AlignRight key="r" size={14} aria-hidden />],
            ] as const
          ).map(([a, icon]) => (
            <button key={a} type="button" aria-pressed={typography.textAlign === a} onClick={() => setType({ textAlign: a })} className={chipClass(typography.textAlign === a)}>
              {icon}
              {t(`appearance_align_${a}`)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('appearance_text_color')} jump="color">
        <ColorRow
          label={t('appearance_text_color')}
          value={typography.textColor ?? null}
          presets={PLAN_TEXT_COLORS.map((hex) => ({ hex, label: hex }))}
          customLabel={t('appearance_custom_color')}
          hexLabel={t('appearance_hex')}
          onChange={(textColor) => setType({ textColor })}
          globalChip={globalChip(typography.textColor === undefined, () => setType({ textColor: undefined }))}
        />
      </Field>

      <Field label={t('appearance_shadow')}>
        <div className="flex flex-wrap gap-1.5">
          {globalChip(typography.textShadow === undefined, () => setType({ textShadow: undefined }))}
          {([true, false] as const).map((on) => (
            <button key={String(on)} type="button" aria-pressed={typography.textShadow === on} onClick={() => setType({ textShadow: on })} className={chipClass(typography.textShadow === on)}>
              {on ? t('appearance_shadow_on') : t('appearance_shadow_off')}
            </button>
          ))}
        </div>
      </Field>
    </section>
  );
}

function Field({ label, children, jump }: { label: string; children: ReactNode; jump?: JumpKey }) {
  return (
    <div className="space-y-1.5" data-jump={jump}>
      <div className="text-sm font-semibold">{label}</div>
      {children}
    </div>
  );
}

/** The Font Family dropdown: each font named in its own typeface, serif and sans-serif projection fonts, plus Global. */
function FontPicker({ t, value, onChange }: { t: PlannerT; value: string | undefined; onChange: (key: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => [undefined, ...PLAN_FONTS] as (string | undefined)[], []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const labelOf = (key: string | undefined) => (key ? (TEXT_FONTS as Record<string, { label: string }>)[key]?.label ?? key : t('appearance_global'));
  return (
    <div
      ref={boxRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-fg/20 bg-surface px-3 text-left text-base text-fg ${FOCUS}`}
        style={{ fontFamily: value ? planFontCss(value) ?? undefined : undefined }}
      >
        {labelOf(value)}
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <ul role="listbox" data-font-list aria-label={t('appearance_font_family')} className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-fg/20 bg-surface p-1 shadow-xl shadow-black/40">
          {options.map((key) => (
            <li key={key ?? 'global'}>
              <button
                type="button"
                role="option"
                aria-selected={value === key}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-base ${FOCUS} ${value === key ? 'bg-accent text-on-accent' : 'text-fg hover:bg-fg/10'}`}
                style={{ fontFamily: key ? planFontCss(key) ?? undefined : undefined }}
              >
                <span>{labelOf(key)}</span>
                {key === undefined && <span className="font-sans text-xs">{t('appearance_global_tip')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
