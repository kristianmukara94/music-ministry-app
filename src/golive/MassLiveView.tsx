import { useState } from 'react';
import { AlertTriangle, Check, ClipboardList, Music, Play } from 'lucide-react';
import { dispatch, useLive } from '../live/store';
import { BackgroundPanel } from '../operator/BackgroundPanel';
import { FramePreview, ProjectorView } from '../output/ProjectorView';
import { LowerThirdStage } from '../output/LowerThirdView';
import { lyricBottomOf } from '../../shared/lyric-area.js';
import { SecondaryControls } from '../praise-worship/SecondaryControls';
import { SlideTypography } from '../praise-worship/SlideTypography';
import { usePwT } from '../praise-worship/strings';
import { usePlannerT } from '../planner/strings';
import { BLOCKS } from '../planner/types';
import { useT } from '../i18n/strings';
import { setUi } from '../state/ui';
import type { QueueItem } from '../../shared/live.js';
import { frameAt, goLiveMassAt, goWithin, playMassAt, queueOnAir, stepMass, stepsOf, useHymnOf } from './massLive';
import { useGoLiveT } from './strings';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const pad2 = (n: number) => String(n).padStart(2, '0');

const CARD = 'rounded-[10px] border border-line bg-panel';
const EYEBROW = 'text-[11px] font-semibold tracking-wider text-accent uppercase';
const BTN =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const BTN_GO =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-ok bg-ok px-5 text-sm font-extrabold text-canvas shadow-md transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ok/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
// The bottom row matches the Praise & Worship console: one line of compact controls that never wraps.
const ROW_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-fg/20 bg-panel-2 px-2.5 text-xs font-semibold text-fg/90 transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
const ROW_NEXT =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const ROW_TOGGLE = (on: boolean) =>
  `inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2 text-xs font-semibold transition ${on ? 'border-accent bg-accent/15 text-accent' : 'border-fg/20 bg-panel-2 text-fg/90 hover:bg-fg/10'}`;
const STAGE = 'relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-canvas';

/** The kind of each queue item, as a short tag. */
const MODULE_TAG: Record<QueueItem['module'], string> = {
  bible: 'Bible',
  notes: 'Prayer',
  lyrics: 'Song',
  lectionary: 'Reading',
  announcements: 'Announcement',
  media: 'Media',
  mass_order: 'Holy Mass',
  custom: 'Note',
};

/** The Mass's order of service: the queue, grouped by its liturgical block, with what is done, what is on, and what is missing. */
function MassLineup({ items, cursor, onPick, busy }: { items: QueueItem[]; cursor: number; onPick: (i: number) => void; busy: boolean }) {
  const t = useGoLiveT();
  const tPlan = usePlannerT();
  const blockTitle = (block: QueueItem['block']) => {
    const def = BLOCKS.find((b) => b.id === block);
    return def ? tPlan(def.titleKey as Parameters<typeof tPlan>[0]) : '';
  };
  const done = Math.max(0, cursor);
  let lastBlock: string | null = null;
  return (
    <section aria-labelledby="mass-lineup" className={`${CARD} flex min-w-0 flex-col p-4`}>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 id="mass-lineup" className="text-lg font-bold tracking-tight">{t('massOrder')}</h2>
        <span className="font-mono text-xs text-muted">{t('massDoneOf', { done, total: items.length })}</span>
      </div>
      <ol className="flex flex-col gap-1">
        {items.map((item, i) => {
          const header = item.block !== lastBlock ? blockTitle(item.block) : null;
          lastBlock = item.block;
          const isDone = i < cursor;
          const current = i === cursor;
          return (
            <li key={`${item.module}-${item.sourceId}-${i}`} className="flex flex-col">
              {header && <span className="mt-2 mb-1 px-1 text-[10px] font-bold tracking-wider text-fg/50 uppercase first:mt-0">{header}</span>}
              <button
                type="button"
                onClick={() => onPick(i)}
                disabled={busy || item.stale}
                aria-current={current ? 'step' : undefined}
                title={item.stale ? t('massMissingHint') : undefined}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed ${
                  current ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5' : 'border-transparent hover:bg-fg/[0.06]'
                } ${item.stale ? 'opacity-50' : ''}`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full font-mono text-xs ${
                    isDone ? 'bg-ok text-canvas' : current ? 'bg-accent text-on-accent' : 'bg-panel-2 text-muted'
                  }`}
                >
                  {isDone ? <Check size={14} aria-hidden /> : pad2(i + 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-[15px] leading-tight ${isDone ? 'text-muted' : 'font-semibold'} ${item.stale ? 'line-through' : ''}`}>{item.label}</span>
                  <span className="text-[10px] font-semibold tracking-wider text-fg/45 uppercase">{MODULE_TAG[item.module]}</span>
                </span>
                {item.stale && <span className="shrink-0 text-[10px] font-extrabold tracking-wide text-danger uppercase">{t('massMissing')}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The Mass's live console, in the same layout as the Praise & Worship one: the order of Mass on the left, the slide on screen and the next one
 * in the middle with the controls beneath, and the outputs on the right. Every item plays here, without switching panels.
 */
export function MassLiveView({ planName }: { planName: string | null }) {
  const t = useGoLiveT();
  const tp = usePwT();
  const tMain = useT();
  const tPlan = usePlannerT();
  const live = useLive((s) => s.state);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queue = live.queue;
  const cursor = live.queueCursor;
  const onAir = queueOnAir(live);
  // While the Mass has the projector, the console follows the slide on screen. Otherwise it shows what is ready to go.
  const frame = onAir ? live.projector.live : live.projector.staged;
  const hymn = useHymnOf(frame);

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

  if (queue.length === 0) {
    return (
      <div className={`${CARD} flex flex-col items-start gap-4 p-6`}>
        <ClipboardList size={28} className="text-accent" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight">{t('massEmptyTitle')}</h2>
          <p className="text-sm text-muted">{t('massEmptyHint')}</p>
        </div>
        <button type="button" className={BTN} onClick={() => setUi({ view: 'planner' })}>
          {t('massOpenPlanner')}
        </button>
      </div>
    );
  }

  const item = cursor >= 0 ? queue[cursor] : null;
  const firstPlayable = queue.findIndex((q) => !q.stale);
  /** The liturgical block an item sits in, in the operator's language. */
  const blockTitle = (q: QueueItem) => {
    const def = BLOCKS.find((b) => b.id === q.block);
    return def ? tPlan(def.titleKey as Parameters<typeof tPlan>[0]) : '';
  };
  const steps = onAir ? stepsOf(frame, hymn) : null;
  const nextInItem = steps && steps.index + 1 < steps.count ? frameAt(frame, steps.index + 1, hymn) : null;
  const nextItemIndex = queue.findIndex((q, i) => i > cursor && !q.stale);
  const nextItem = nextItemIndex >= 0 ? queue[nextItemIndex] : null;
  const missing = queue.filter((q) => q.stale).length;
  const lowerOn = live.lowerThird.live != null;
  const blackout = live.projector.live.kind === 'blackout';
  const projectorOn = live.outputs.projector;
  // Something other than the Mass has the projector while the Mass has a place: offer to put the Mass back.
  const otherOnAir = cursor >= 0 && projectorOn && !onAir && live.projector.live.kind !== 'idle' && live.projector.live.kind !== 'blackout';
  const atStart = cursor <= 0 && (!steps || steps.index === 0);
  const atEnd = nextItemIndex < 0 && (!steps || steps.index >= steps.count - 1);

  return (
    <div className="flex flex-col gap-5">
      {/* The Mass at a glance: on air or not, the plan, and the way to clear the screen. */}
      <div className={`${CARD} flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3`}>
        <span
          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-sm font-extrabold tracking-[0.18em] uppercase ${
            onAir ? 'border-danger/60 bg-danger/15 text-danger' : 'border-fg/20 bg-fg/[0.06] text-fg/60'
          }`}
        >
          <span aria-hidden className={`size-2 rounded-full ${onAir ? 'animate-pulse bg-danger' : 'bg-fg/50'}`} />
          {onAir ? t('massOnAir') : t('massOffAir')}
        </span>
        {planName && (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-xs text-fg/60">{t('massPlanLabel')}</span>
            <span className="truncate text-base font-semibold text-fg">{planName}</span>
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={`${BTN} hover:!border-danger/60 hover:!text-danger`}
            disabled={live.projector.live.kind === 'idle'}
            onClick={() => window.confirm(t('massConfirmClear')) && dispatch({ type: 'projector/clear' })}
          >
            {t('massClear')}
          </button>
        </div>
      </div>

      {otherOnAir && item && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-accent bg-panel-2 px-5 py-3">
          <span>{t('massTakeOverBanner', { item: item.label })}</span>
          <button type="button" className={BTN} disabled={busy} onClick={() => void run(() => playMassAt(cursor))}>
            {t('massTakeOver')}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] @6xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(260px,320px)]">
        <MassLineup items={queue} cursor={cursor} busy={busy} onPick={(i) => void run(() => playMassAt(i))} />

        <section aria-labelledby="mass-live-title" className={`${CARD} flex min-w-0 flex-col gap-4 p-5`}>
          {item ? (
            <div className="min-w-0">
              <p className={EYEBROW}>
                {t(onAir ? 'massNowEyebrow' : 'massReadyEyebrow', {
                  n: pad2(cursor + 1),
                  total: queue.length,
                  block: blockTitle(item),
                })}
              </p>
              <h2 id="mass-live-title" className="mt-1 text-2xl leading-tight font-bold tracking-tight">{item.label}</h2>
              {item.module === 'lyrics' && hymn && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  <li className="flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
                    <Music size={11} aria-hidden /> {hymn.title}
                  </li>
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <h2 id="mass-live-title" className="text-2xl leading-tight font-bold tracking-tight">{t('massReadyTitle', { name: planName ?? '' })}</h2>
              <p className="text-sm text-muted">{t('massReadyHint')}</p>
              {firstPlayable >= 0 && (
                <button type="button" className={BTN_GO} disabled={busy} onClick={() => void run(() => goLiveMassAt(firstPlayable, planName))}>
                  <Play size={16} aria-hidden fill="currentColor" /> {t('massStart', { name: queue[firstPlayable].label })}
                </button>
              )}
            </div>
          )}

          {/* The slide on screen, with the next one beside it: the next slide of this item, or the next item. */}
          {item && (
            <div className="@container/preview">
              <div className="grid grid-cols-1 gap-4 @md/preview:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <figure className="flex min-w-0 flex-col gap-1.5">
                  <figcaption className={EYEBROW}>{t('massCurrent')}</figcaption>
                  <div className={STAGE}>
                    <FramePreview frame={frame} />
                  </div>
                </figure>
                <figure className="flex min-w-0 flex-col gap-1.5">
                  <figcaption className={EYEBROW}>{nextInItem ? t('massNextSlide') : t('massNextItemCard')}</figcaption>
                  {nextInItem ? (
                    <div className={STAGE}>
                      <FramePreview frame={nextInItem} />
                    </div>
                  ) : nextItem ? (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 p-3 text-center">
                      <span className="text-[10px] font-semibold tracking-wider text-fg/50 uppercase">{MODULE_TAG[nextItem.module]}</span>
                      <span className="line-clamp-3 text-sm font-bold text-fg">{nextItem.label}</span>
                    </div>
                  ) : (
                    <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-fg/15 p-3 text-center text-sm text-muted">
                      {t('massEndOfQueue')}
                    </div>
                  )}
                </figure>
              </div>
            </div>
          )}

          {item && (
            <div className="flex flex-col gap-2">
              <h3 className={EYEBROW}>{t('massJump')}</h3>
              {steps ? (
                <ol className="flex flex-wrap gap-1.5">
                  {steps.labels.map((label, i) => {
                    const here = i === steps.index;
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => void run(() => goWithin(i))}
                          disabled={busy}
                          aria-current={here ? 'step' : undefined}
                          aria-label={t('massSlideLabel', { label, n: i + 1, total: steps.count })}
                          className={`grid h-10 min-w-12 place-items-center rounded-full border px-3 font-mono text-sm font-bold transition ${
                            here ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 bg-panel-2 text-fg/85 hover:border-accent hover:text-accent'
                          }`}
                        >
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-sm text-muted">{t('massOneSlide')}</p>
              )}
            </div>
          )}

          {backgroundOpen && <BackgroundPanel onClose={() => setBackgroundOpen(false)} />}

          {/* One line, no scrollbar: the same controls as the Praise & Worship console. */}
          <div className="sticky bottom-0 z-10 -mx-5 -mb-5 flex min-w-0 flex-nowrap items-center justify-between gap-1.5 overflow-hidden rounded-b-[10px] border-t border-line bg-panel px-5 py-3">
            <button type="button" className={ROW_BTN} disabled={busy || atStart} onClick={() => void run(() => stepMass(-1))}>
              {tp('back')}
            </button>
            <button type="button" className={ROW_NEXT} disabled={busy || atEnd} onClick={() => void run(() => stepMass(1))}>
              {tp('next')}
            </button>
            <span className="flex-1" />
            <button type="button" aria-pressed={backgroundOpen} aria-expanded={backgroundOpen} className={ROW_TOGGLE(backgroundOpen)} onClick={() => setBackgroundOpen((open) => !open)}>
              <span className="hidden @3xl/pw:inline">{tMain('top.background')}</span>
              <span className="@3xl/pw:hidden">BG</span>
            </button>
            <button type="button" aria-pressed={lowerOn} className={ROW_TOGGLE(lowerOn)} onClick={() => dispatch({ type: 'lowerThird/toggle' })}>
              <span className="hidden @3xl/pw:inline">{tp('lowerThirdToggle')}</span>
              <span className="@3xl/pw:hidden">L3</span>: {lowerOn ? tp('on') : tp('off')}
            </button>
            <button type="button" aria-pressed={blackout} className={ROW_TOGGLE(blackout)} onClick={() => dispatch({ type: 'projector/blackout' })}>
              <span className="hidden @3xl/pw:inline">{tp('blackoutToggle')}</span>
              <span className="@3xl/pw:hidden">BLK</span>: {blackout ? tp('on') : tp('off')}
            </button>
            <SlideTypography />
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-5 @4xl/pw:col-span-2 @6xl/pw:col-span-1">
          <section aria-labelledby="mass-outputs" className={`${CARD} flex flex-col gap-3 p-4`}>
            <h2 id="mass-outputs" className="text-lg font-bold">{tp('outputs')}</h2>
            <span className="text-sm text-muted">{tp('congregation')}</span>
            <div className="relative aspect-video overflow-hidden rounded-lg border border-line">
              <ProjectorView mirror embedded />
            </div>
            <span className="text-sm text-muted">{tp('livestream')}</span>
            <div data-theme="default" className="relative aspect-video overflow-hidden rounded-lg border border-line bg-canvas [container-type:size]">
              {live.lowerThird.live ? (
                <LowerThirdStage value={live.lowerThird.live} lyricBottomShare={lyricBottomOf(live.projector.live)} />
              ) : (
                <div className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-fg/50">
                  {tp('lowerThirdToggle')}: {tp('off')}
                </div>
              )}
            </div>
          </section>

          <SecondaryControls />

          <section aria-labelledby="mass-next-up" className={`${CARD} flex flex-col gap-1 p-4`}>
            <h2 id="mass-next-up" className={EYEBROW}>{tp('nextUp')}</h2>
            {nextItem ? (
              <>
                <p className="text-2xl font-bold tracking-tight">{nextItem.label}</p>
                <p className="text-sm font-semibold text-fg/60">{MODULE_TAG[nextItem.module]}</p>
              </>
            ) : (
              <p className="text-muted">{t('massEndOfQueue')}</p>
            )}
          </section>

          <section aria-labelledby="mass-preflight" className={`${CARD} flex flex-col gap-2 p-4`}>
            <h2 id="mass-preflight" className={EYEBROW}>{t('massPreflight')}</h2>
            {missing === 0 && projectorOn ? (
              <p className="flex items-center gap-2 text-sm text-ok">
                <Check size={15} aria-hidden /> {t('massPreflightOk')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {missing > 0 && (
                  <li className="flex items-start gap-2 text-warn">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {t('massPreflightMissing', { n: missing })}
                  </li>
                )}
                {!projectorOn && (
                  <li className="flex items-start gap-2 text-fg/70">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {t('massPreflightProjector')}
                  </li>
                )}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
