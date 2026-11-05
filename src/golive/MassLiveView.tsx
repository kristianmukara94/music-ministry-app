import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ClipboardList, Play, Plus, RotateCcw, X } from 'lucide-react';
import { dispatch, useLive } from '../live/store';
import { BackgroundPanel } from '../operator/BackgroundPanel';
import { FramePreview, ProjectorView } from '../output/ProjectorView';
import { LowerThirdStage } from '../output/LowerThirdView';
import { lyricBottomOf } from '../../shared/lyric-area.js';
import { deckThumb, massLineup } from '../../shared/flow-insert.js';
import { slotById } from '../../shared/mass-slots.js';
import { removeFromFlow, resetMassOrder } from '../planner/plan-api';
import { SecondaryControls } from '../praise-worship/SecondaryControls';
import { SlideTypography } from '../praise-worship/SlideTypography';
import { IntroSlideToggle } from '../praise-worship/IntroSlideToggle';
import { clock } from '../praise-worship/LiveView';
import { useNow } from '../operator/useNow';
import { songTitleFrame } from '../../shared/stage-plan-row.js';
import { MassHotEdit } from './MassHotEdit';
import { usePwT } from '../praise-worship/strings';
import { usePlannerT } from '../planner/strings';
import { BLOCKS } from '../planner/types';
import { useT } from '../i18n/strings';
import { setUi } from '../state/ui';
import { blackoutOverMass, welcomeOverMass, type QueueItem } from '../../shared/live.js';
import { endMassSession, frameAt, goLiveMassAt, goWithin, massShowing, playMassAt, slotNameAt, stepMass, stepsOf, useHymnOf, useMassClock, useNoteOf } from './massLive';
import { LiveStageCanvas, type StageChipGroup } from '../components/LiveStageCanvas';
import { useGoLiveT } from './strings';
import { InFlowSlidePickerModal } from './InFlowSlidePickerModal';

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

/**
 * The Mass's order of service: the queue, grouped by its liturgical block, with what is done, what is on, and what is missing. Every one of the
 * 17 Holy Mass slots is shown, an empty one in its place, so slides put in never hide the order of Mass. Each row has a ✕ (on hover or
 * keyboard focus) that takes it out: a slot's item leaves the slot empty, any other row is gone.
 */
function MassLineup({
  items,
  cursor,
  onPick,
  onRemove,
  onAdd,
  onReset,
  busy,
}: {
  items: QueueItem[];
  cursor: number;
  onPick: (i: number) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const t = useGoLiveT();
  const tPlan = usePlannerT();
  const blockTitle = (block: string) => {
    const def = BLOCKS.find((b) => b.id === block);
    return def ? tPlan(def.titleKey as Parameters<typeof tPlan>[0]) : '';
  };
  const done = Math.max(0, cursor);
  let lastBlock: string | null = null;
  const sectionHeader = (block: string) => {
    const header = block !== lastBlock ? blockTitle(block) : null;
    lastBlock = block;
    return header && <span className="mt-2 mb-1 px-1 text-[10px] font-bold tracking-wider text-fg/50 uppercase first:mt-0">{header}</span>;
  };
  return (
    <section aria-labelledby="mass-lineup" className={`${CARD} flex min-w-0 flex-col p-4`}>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 id="mass-lineup" className="text-lg font-bold tracking-tight">{t('massOrder')}</h2>
        <span className="font-mono text-xs text-muted">{t('massDoneOf', { done, total: items.length })}</span>
      </div>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-accent/50 px-3 text-xs font-bold tracking-wide text-accent uppercase transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={13} aria-hidden /> {t('inflowOpen')}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          title={t('massConfirmReset')}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-fg/20 px-3 text-xs font-bold tracking-wide text-fg/70 uppercase transition hover:border-danger/60 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={13} aria-hidden /> {t('massResetOrder')}
        </button>
      </div>
      <ol className="flex flex-col gap-1">
        {massLineup(items).map((entry) => {
          if ('slot' in entry) {
            const { slot } = entry;
            return (
              <li key={`slot-${slot.id}`} className="flex flex-col">
                {sectionHeader(slot.block)}
                <div className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-dashed border-fg/15 px-3 py-2 text-left opacity-60">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-fg/25 font-mono text-[11px] text-muted">{slot.position}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] leading-tight text-fg/70">{slot.name}</span>
                    <span className="text-[10px] font-semibold tracking-wider text-fg/45 uppercase">{t('massEmptySlot')}</span>
                  </span>
                </div>
              </li>
            );
          }
          const i = entry.index;
          const item = items[i];
          const header = sectionHeader(item.block);
          const slot = slotById(item.slot);
          const isDone = i < cursor;
          const current = i === cursor;
          return (
            <li key={`${item.module}-${item.sourceId}-${i}`} className="flex flex-col">
              {header}
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  disabled={busy || item.stale}
                  aria-current={current ? 'step' : undefined}
                  title={item.stale ? t('massMissingHint') : undefined}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-lg border py-2 pr-9 pl-3 text-left transition disabled:cursor-not-allowed ${
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
                  {deckThumb(item) && (
                    <img src={deckThumb(item)!} alt="" loading="lazy" className="h-8 w-14 shrink-0 rounded border border-line object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`truncate text-[15px] leading-tight ${isDone ? 'text-muted' : 'font-semibold'} ${item.stale ? 'line-through' : ''}`}>{item.label}</span>
                    <span className="truncate text-[10px] font-semibold tracking-wider text-fg/45 uppercase">
                      {slot ? `${slot.position}. ${slot.name} · ` : ''}
                      {MODULE_TAG[item.module]}
                    </span>
                  </span>
                  {item.stale && <span className="shrink-0 text-[10px] font-extrabold tracking-wide text-danger uppercase">{t('massMissing')}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  disabled={busy}
                  aria-label={t(slot ? 'massRemoveSlot' : 'massRemove', { item: item.label })}
                  title={t(slot ? 'massRemoveSlot' : 'massRemove', { item: item.label })}
                  className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg/50 opacity-0 transition group-hover:opacity-100 hover:bg-danger/15 hover:text-danger focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none disabled:hidden"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Asks before Reset order takes the added slide rows out. Escape or a click outside cancels; Cancel has the focus, so Enter cannot reset by slip. */
function ConfirmResetModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const t = useGoLiveT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-body" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-fg/20 bg-panel p-6 shadow-2xl">
        <h2 id="reset-title" className="flex items-center gap-2 text-lg font-bold">
          <RotateCcw size={18} className="text-danger" aria-hidden /> {t('massResetOrder')}
        </h2>
        <p id="reset-body" className="text-sm text-fg/80">{t('massConfirmReset')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus className={BTN} onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className={`${BTN} !border-danger/60 !bg-danger/15 !text-danger hover:!bg-danger/25`} onClick={onConfirm}>
            {t('massResetOrder')}
          </button>
        </div>
      </div>
    </div>
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
  const [notice, setNotice] = useState<string | null>(null);
  // The Add slides picker, while it is open.
  const [adding, setAdding] = useState(false);
  // The Reset order confirmation, while it is open.
  const [confirmingReset, setConfirmingReset] = useState(false);
  // A step whose stanza the operator double-clicked to edit, handed to the live editor.
  const [editRequest, setEditRequest] = useState<number | null>(null);
  const { liveSince, itemSince } = useMassClock();
  const now = useNow().getTime();

  // A confirmation fades on its own, so it never sits over later work.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const queue = live.queue;
  const cursor = live.queueCursor;
  // The Mass has the screen, with the projector window open or not (the TV and phones, or the app alone).
  const onAir = massShowing(live);
  // The welcome screen or Blackout is up over the Mass: the Mass keeps its place, and the slide it covers waits staged under it.
  const covered = welcomeOverMass(live) || blackoutOverMass(live);
  // While the Mass has the screen, the console follows the slide on screen. Otherwise, or under a cover, it shows what is staged.
  const frame = onAir && !covered ? live.projector.live : live.projector.staged;
  const hymn = useHymnOf(frame);
  // The prayer behind a prayer's slide, for its next slide.
  const note = useNoteOf(frame);

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

  /** Puts the loaded plan back to its Holy Mass order, once the operator has confirmed it in the dialog. */
  const resetOrder = () => {
    setConfirmingReset(false);
    void run(async () => {
      const removed = await resetMassOrder();
      setNotice(removed > 0 ? t('massResetDone', { n: removed }) : t('massResetNone'));
    });
  };

  /**
   * Takes a row out of the Mass (the lineup's ✕). A row on screen is only taken out once the operator confirms, since the next item then goes
   * on screen in its place; any other row goes straight away, with a notice saying what went.
   */
  const removeRow = (i: number) => {
    const row = queue[i];
    if (!row) return;
    if (i === cursor && onAir && !window.confirm(t('massConfirmRemoveLive', { item: row.label }))) return;
    void run(async () => {
      const removed = await removeFromFlow(i);
      const slot = slotById(removed.slot);
      setNotice(slot ? t('massSlotCleared', { item: removed.label, slot: `${slot.position}. ${slot.name}` }) : t('massRemoved', { item: removed.label }));
    });
  };

  // A loaded plan with nothing in it still shows its slots, so slides can be added to them here.
  if (queue.length === 0 && live.queuePlanId == null) {
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
  // The slides of the item the console shows, on screen or staged and ready, so its chips are there before it goes up too.
  const steps = item ? stepsOf(frame, hymn) : null;
  // Next and Back step inside the item only while it is on screen; from a staged item they move through the queue.
  const liveSteps = onAir ? steps : null;
  const nextInItem = steps && steps.index + 1 < steps.count ? frameAt(frame, steps.index + 1, hymn, slotNameAt(live), note) : null;
  const nextItemIndex = queue.findIndex((q, i) => i > cursor && !q.stale);
  const nextItem = nextItemIndex >= 0 ? queue[nextItemIndex] : null;
  // A song after this item opens on its title card, so that card is what comes next. Any other item is shown by its name.
  const nextItemFrame = nextItem?.module === 'lyrics' ? songTitleFrame({ id: Number(nextItem.sourceId), title: nextItem.label, stanzas: [] }, slotById(nextItem.slot)?.name) : null;
  const isSong = item?.module === 'lyrics' && hymn !== null;
  const chips = (steps?.labels ?? []).map((label, i) => ({ index: i, label, name: isSong && i === 0 ? tp('titleChip') : label }));
  // As in Praise & Worship: a song's title card chip on a row of its own, then its sections under the song's title. Any other item is one row.
  const chipGroups: StageChipGroup[] = isSong
    ? [
        { key: 'title', label: null, chips: chips.filter((chip) => chip.index === 0) },
        { key: `song-${hymn!.id}`, label: hymn!.title, chips: chips.filter((chip) => chip.index > 0) },
      ].filter((group) => group.chips.length > 0)
    : [{ key: 'item', label: null, chips }];
  const missing = queue.filter((q) => q.stale).length;
  const lowerOn = live.lowerThird.live != null;
  const blackout = live.projector.live.kind === 'blackout';
  const projectorOn = live.outputs.projector;
  // Something other than the Mass has the projector while the Mass has a place: offer to put the Mass back.
  const otherOnAir = cursor >= 0 && projectorOn && !onAir && live.projector.live.kind !== 'idle' && live.projector.live.kind !== 'blackout';
  // Under the welcome screen or Blackout, Next and Back always work: they put the covered slide back.
  const atStart = !covered && cursor <= 0 && (!liveSteps || liveSteps.index === 0);
  const atEnd = !covered && nextItemIndex < 0 && (!liveSteps || liveSteps.index >= liveSteps.count - 1);

  return (
    <div className="flex flex-col gap-5">
      {/* The Mass at a glance: on air or not, the plan, and the ways to clear the screen or end the Mass. */}
      <div className={`${CARD} flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3`}>
        <span
          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-sm font-extrabold tracking-[0.18em] uppercase ${
            onAir ? 'border-danger/60 bg-danger/15 text-danger' : 'border-fg/20 bg-fg/[0.06] text-fg/60'
          }`}
        >
          <span aria-hidden className={`size-2 rounded-full ${onAir ? 'animate-pulse bg-danger' : 'bg-fg/50'}`} />
          {onAir ? tp('liveBadge') : tp('offAir')}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-fg/60">{tp('sessionTime')}</span>
          <span className="font-mono text-2xl tabular-nums text-fg">{clock(liveSince ? now - liveSince : 0)}</span>
        </span>
        {planName && (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-xs text-fg/60">{t('massPlanLabel')}</span>
            <span className="truncate text-base font-semibold text-fg">{planName}</span>
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <IntroSlideToggle />
          <button
            type="button"
            className={`${BTN} hover:!border-danger/60 hover:!text-danger`}
            disabled={live.projector.live.kind === 'idle'}
            onClick={() => window.confirm(t('massConfirmClear')) && dispatch({ type: 'projector/clear' })}
          >
            {t('massClear')}
          </button>
          <button type="button" className={`${BTN} hover:!border-danger/60 hover:!text-danger`} disabled={cursor < 0} onClick={() => window.confirm(t('massConfirmEnd')) && endMassSession()}>
            {tp('endSession')}
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
      {notice && (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok/10 px-4 py-2 text-sm text-ok">
          {notice}
        </p>
      )}
      {adding && (
        <InFlowSlidePickerModal
          queue={queue}
          cursor={cursor}
          t={t}
          onClose={() => setAdding(false)}
          onDone={(message) => {
            setAdding(false);
            setNotice(message);
          }}
        />
      )}
      {confirmingReset && <ConfirmResetModal onConfirm={resetOrder} onClose={() => setConfirmingReset(false)} />}

      <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] @6xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(260px,320px)]">
        <MassLineup items={queue} cursor={cursor} busy={busy} onPick={(i) => void run(() => playMassAt(i))} onRemove={removeRow} onAdd={() => setAdding(true)} onReset={() => setConfirmingReset(true)} />

        <section aria-labelledby="mass-live-title" className={`${CARD} flex min-w-0 flex-col gap-4 p-5`}>
          {item ? (
            <LiveStageCanvas
              titleId="mass-live-title"
              eyebrow={t(onAir ? 'massNowEyebrow' : 'massReadyEyebrow', { n: pad2(cursor + 1), total: queue.length, block: blockTitle(item) })}
              title={item.label}
              songs={item.module === 'lyrics' && hymn ? [{ id: hymn.id, title: hymn.title }] : []}
              activeSongId={onAir ? hymn?.id : null}
              // The Holy Mass items have no planned length, so the item's time counts up with no target.
              aside={
                <div className="flex min-w-40 items-baseline justify-between gap-3">
                  <span className="text-sm text-muted">{t('massItemTime')}</span>
                  <span className="font-mono">{clock(onAir && itemSince ? now - itemSince : 0)}</span>
                </div>
              }
              // The slide on screen, with the next one beside it: the next slide of this item, or the next item.
              preview={
                <div className="@container/preview">
                  <div className="grid grid-cols-1 gap-4 @md/preview:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <figure className="flex min-w-0 flex-col gap-1.5">
                      <figcaption className={EYEBROW}>{t('massCurrent')}</figcaption>
                      <div className={STAGE}>
                        <FramePreview frame={frame} />
                        {steps && (
                          <span className="absolute right-2 bottom-2 rounded-full bg-black/75 px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-white shadow">
                            {steps.index + 1} / {steps.count}
                          </span>
                        )}
                      </div>
                    </figure>
                    <figure className="flex min-w-0 flex-col gap-1.5">
                      <figcaption className={EYEBROW}>{nextInItem ? t('massNextSlide') : t('massNextItemCard')}</figcaption>
                      {nextInItem ? (
                        <div className={STAGE}>
                          <FramePreview frame={nextInItem} />
                          <span className="absolute right-2 bottom-2 rounded-full bg-black/75 px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-white shadow">
                            {steps!.index + 2} / {steps!.count}
                          </span>
                        </div>
                      ) : nextItemFrame ? (
                        <div className={STAGE}>
                          <FramePreview frame={nextItemFrame} />
                        </div>
                      ) : nextItem ? (
                        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-stone-950 p-3 text-center text-white">
                          <span className="text-[10px] font-semibold tracking-wider text-white/50 uppercase">{MODULE_TAG[nextItem.module]}</span>
                          <span className="line-clamp-3 text-sm font-bold">{nextItem.label}</span>
                        </div>
                      ) : (
                        <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-fg/15 p-3 text-center text-sm text-muted">
                          {t('massEndOfQueue')}
                        </div>
                      )}
                    </figure>
                  </div>
                </div>
              }
              jumpHeading={tp('jumpToSection')}
              groups={chipGroups}
              activeIndex={steps?.index ?? -1}
              onSelect={(i) => void run(() => goWithin(i, frame))}
              chipLabel={(chip) => t('massSlideLabel', { label: chip.name, n: chip.index + 1, total: steps?.count ?? 1 })}
              disabled={busy}
              onChipDoubleClick={isSong ? (i) => setEditRequest(i) : undefined}
              noChips={<p className="text-sm text-muted">{t('massOneSlide')}</p>}
            >
              <MassHotEdit
                t={tp}
                hymn={isSong ? hymn : null}
                onAir={isSong && liveSteps ? liveSteps.index : null}
                editRequest={editRequest}
                onEditHandled={() => setEditRequest(null)}
                onShow={(step) => void run(() => goWithin(step))}
              />
            </LiveStageCanvas>
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
