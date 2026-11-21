import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, ClipboardList, Lock, Play, Plus, RotateCcw, X } from 'lucide-react';
import { SlidePreview } from '../announcements/TextSlideModal';
import { lowerThirdOf, stagePrayer } from '../notes/present';
import type { Note } from '../notes/types';
import { useNotesById } from '../notes/useNotes';
import { isGoLiveCopy } from '../notes/slideCopies';
import { screenPagesOf } from '../../shared/prayer-screen.js';
import { sanitizeTextStyle } from '../../shared/text-style.js';
import type { MassSlot } from '../../shared/mass-slots.js';
import { AddSlotNotePrayerModal } from './AddSlotNotePrayerModal';
import { HubSlideSelectionModal } from './HubSlideSelectionModal';
import { noteSource, pickSlides, sectionOfCategory, type NoteSection } from '../../shared/notes.js';
import type { GoLiveKey } from '../../shared/golive-i18n.js';
import { dispatch, useLive } from '../live/store';
import { FramePreview } from '../output/ProjectorView';
import { LowerThirdStage } from '../output/LowerThirdView';
import { deckThumb, massLineup } from '../../shared/flow-insert.js';
import { slotById } from '../../shared/mass-slots.js';
import { removeFromFlow, resetMassOrder } from '../planner/plan-api';
import { SecondaryControls } from '../praise-worship/SecondaryControls';
import { IntroSlideToggle } from '../praise-worship/IntroSlideToggle';
import { clock } from '../praise-worship/LiveView';
import { useNow } from '../operator/useNow';
import { songTitleFrame } from '../../shared/stage-plan-row.js';
import { usePwT } from '../praise-worship/strings';
import { usePlannerT } from '../planner/strings';
import { BLOCKS } from '../planner/types';
import { setUi } from '../state/ui';
import { blackoutOverMass, slotTitleShown, welcomeOverMass, type QueueItem } from '../../shared/live.js';
import { endMassSession, frameAt, goLiveMassAt, goWithin, massShowing, noteRowOffScreen, playMassAt, playMassItemAt, slotNameAt, stepMass, stepsOf, useHymnOf, useMassClock, useNoteOf, type ItemSteps } from './massLive';
import { queueItemFrame } from '../planner/routing';
import { bridge } from '../live/bridge';
import type { Hymn } from '../lyrics/types';
import { useGoLiveT } from './strings';
import { InFlowSlidePickerModal } from './InFlowSlidePickerModal';
import { cueText, outputStatus, pad2 as cuePad2, type Cue } from '../../shared/stage-cue.js';
import { textCaseOf } from '../../shared/text-fit.js';
import { slidePagesOf } from './massSlideCopy';
import { BroadcastHeader } from './console/BroadcastHeader';
import { OutputsCard } from './console/OutputsCard';
import { StageMonitors } from './console/StageMonitors';
import { TransportBar, consoleOutputActions } from './console/TransportBar';
import { CueNavigator } from './console/CueNavigator';
import { SlideEditorCard, type SlideEditTarget } from './console/SlideEditorCard';
import { TypographyCard } from './console/TypographyCard';
import { massPagesTarget, massSongLayout, massSongRemove, songTarget } from './console/editTargets';
import { useConsoleKeys, useSegmentTimer } from './console/hooks';
import { SlideEditorModal, type EditorCue } from './console/SlideEditorModal';
import { FloatingProgram } from './console/FloatingProgram';
import { useCueMeta } from './console/cueMeta';
import { frameOwnLook, massLookKey } from '../../shared/slide-look.js';
import type { Frame, LineRole } from '../../shared/live.js';

/** A Holy Mass slide as the editor previews it: with the words being typed in place of the saved ones. A picture has no words to change. */
function withWords(frame: Frame, text: string): Frame {
  switch (frame.kind) {
    case 'lyrics':
    case 'text':
    case 'rosary':
      return { ...frame, text };
    case 'deck': {
      const lines = frame.slides[frame.index] ?? [];
      const role = (k: number): LineRole => lines[k]?.role ?? lines[0]?.role ?? 'plain';
      const slides = frame.slides.map((slide, i) => (i === frame.index ? text.split('\n').map((line, k) => ({ role: role(k), text: line })) : slide));
      return { ...frame, slides };
    }
    case 'psalm': {
      // The editor shows the pinned response over each verse (slidePagesOf); the preview pins it on its own.
      const response = `R. ${frame.response.trim()}\n`;
      const page = text.startsWith(response) ? text.slice(response.length) : text;
      return { ...frame, pages: frame.pages.map((p, i) => (i === frame.index ? page : p)) };
    }
    default:
      return frame;
  }
}

/** No item: what the selected row's song and prayer loaders read while no row is selected. */
const NO_FRAME: Frame = { kind: 'idle' };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const pad2 = (n: number) => String(n).padStart(2, '0');

const CARD = 'rounded-xl border border-line bg-panel';
const EYEBROW = 'text-[11px] font-semibold tracking-wider text-accent uppercase';
const BTN =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const BTN_GO =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-ok bg-ok px-5 text-sm font-extrabold text-canvas shadow-md transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ok/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
// A note drawer's Stage and Take live buttons.
const ROW_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-fg/20 bg-panel-2 px-2.5 text-xs font-semibold text-fg/90 transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
const ROW_NEXT =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

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

/** The badge on a row that plays a Notes & Prayers note: amber for a prayer the congregation sees, cyan for a private operator cue. */
function NoteBadge({ note, t }: { note: Note; t: ReturnType<typeof useGoLiveT> }) {
  const prayer = note.display !== 'operator';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[9px] font-extrabold tracking-wider text-fg uppercase ${
        prayer ? 'border-amber-500/70 bg-amber-500/20' : 'border-cyan-500/70 bg-cyan-500/20'
      }`}
    >
      <span aria-hidden>{prayer ? '🙏' : '📝'}</span>
      {t(prayer ? 'badgePrayer' : 'badgeNote')}
    </span>
  );
}

/**
 * Under a note's row, once it is picked: the prayer as the screen will show it, with Stage and Take live, or a private note's text, which has
 * neither, so it can never reach the projector from here.
 */
function NoteDrawer({
  note,
  slides = null,
  onStage,
  onTake,
  busy,
  t,
}: {
  note: Note | undefined;
  /** The slides of the prayer the row plays (0-based), or null for every slide. */
  slides?: number[] | null;
  onStage: (n: Note, slides: number[] | null) => void; onTake: () => void; busy: boolean; t: ReturnType<typeof useGoLiveT> }) {
  const titleShown = useLive((s) => slotTitleShown(s.state));
  if (!note) return <p className="mx-1 mt-1 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{t('noteGone')}</p>;
  if (note.display === 'operator') {
    return (
      <div className="mx-1 mt-1 flex flex-col gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/[0.07] p-3">
        <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-fg/70 uppercase">
          <Lock size={11} aria-hidden /> {t('notePrivate')}
        </span>
        <p className="max-h-48 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-fg/90">{note.body || t('noteEmptyText')}</p>
      </div>
    );
  }
  const pages = note.display === 'full' ? pickSlides(screenPagesOf(note), slides) : [];
  return (
    <div className="mx-1 mt-1 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-2.5">
      {note.display === 'full' ? (
        <div className="relative">
          <SlidePreview
            text={pages[0]?.text ?? note.body}
            headline={titleShown || !(pages[0]?.text ?? note.body).trim() ? note.title : null}
            top={pages[0]?.top ?? null}
            bgSrc={null}
            style={{ ...sanitizeTextStyle(note.style), fontSize: pages[0]?.fontPx }}
            className="aspect-video w-full rounded-md border border-fg/15"
          />
          {pages.length > 1 && (
            <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/75 px-2 py-px font-mono text-[10px] font-bold text-white">1 / {pages.length}</span>
          )}
        </div>
      ) : (
        <div data-theme="default" className="relative aspect-video overflow-hidden rounded-md border border-line bg-canvas [container-type:size]">
          <LowerThirdStage value={lowerThirdOf(note)} />
        </div>
      )}
      <div className="flex gap-1.5">
        <button type="button" disabled={busy} onClick={() => onStage(note, slides)} className={`${ROW_BTN} flex-1`}>
          {t('noteStage')}
        </button>
        <button type="button" disabled={busy} onClick={onTake} className={`${ROW_NEXT} flex-1 !bg-ok !text-canvas`}>
          <Play size={12} aria-hidden fill="currentColor" /> {t('noteTakeLive')}
        </button>
      </div>
    </div>
  );
}

/** The Liturgical Content Hub's sections, as the Add slides menu lists them. */
const HUB_SECTIONS: { id: NoteSection; icon: string; label: GoLiveKey }[] = [
  { id: 'prayers', icon: '🙏', label: 'addMenuSectionPrayers' },
  { id: 'massFlow', icon: '✝️', label: 'addMenuSectionMassFlow' },
  { id: 'announcements', icon: '📢', label: 'addMenuSectionAnnouncements' },
];

/** The Hub's entries by section, each sorted by title. A section follows from the entry's category, as it does in the Hub. */
export function hubMenuSections(notes: Iterable<Note>): Record<NoteSection, Note[]> {
  const out: Record<NoteSection, Note[]> = { prayers: [], massFlow: [], announcements: [] };
  // Hub entries only: a plan's own Go Live copies are not offered to other plans.
  for (const note of notes) if (!isGoLiveCopy(note)) out[sectionOfCategory(note.category)].push(note);
  for (const list of Object.values(out)) list.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * "+ Add slides" as a menu: Create New Note / Prayer at the top, then the Liturgical Content Hub's entries in its three sections (each a
 * submenu that opens in place, so the menu never runs off the narrow sidebar), and Text or PowerPoint slides at the bottom. The entries are
 * the live notes table (read again on every notes:changed), so an entry written in the Hub shows here while the menu is open. Picking one
 * opens the slide picker. Escape or a click outside closes the menu.
 */
function AddMenu({
  busy,
  notes,
  onSlides,
  onNote,
  onHubItem,
}: {
  busy: boolean;
  notes: Map<number, Note>;
  onSlides: () => void;
  onNote: () => void;
  onHubItem: (note: Note) => void;
}) {
  const t = useGoLiveT();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<NoteSection | null>(null);
  const sections = useMemo(() => hubMenuSections(notes.values()), [notes]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  const pick = (run: () => void) => {
    setOpen(false);
    setSection(null);
    run();
  };
  const ITEM = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-fg/90 transition hover:bg-fg/10 focus-visible:bg-fg/10 focus-visible:outline-none';
  const ENTRY = 'flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-left text-[13px] text-fg/85 transition hover:bg-fg/10 focus-visible:bg-fg/10 focus-visible:outline-none';
  return (
    <div ref={box} className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-accent/50 px-3 text-xs font-semibold whitespace-nowrap text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={13} aria-hidden /> {t('inflowOpen')} <ChevronDown size={12} aria-hidden className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 left-0 z-20 mt-1 flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto rounded-lg border border-fg/20 bg-surface p-1 shadow-2xl backdrop-blur"
        >
          <button type="button" role="menuitem" autoFocus className={`${ITEM} text-accent`} onClick={() => pick(onNote)}>
            <Plus size={14} aria-hidden /> {t('addMenuCreate')}
          </button>
          <div role="separator" className="my-0.5 border-t border-line" />
          {HUB_SECTIONS.map((s) => {
            const list = sections[s.id];
            const expanded = section === s.id;
            return (
              <div key={s.id} role="group" aria-label={t(s.label)} className="flex flex-col">
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={expanded}
                  className={ITEM}
                  onClick={() => setSection(expanded ? null : s.id)}
                >
                  <span aria-hidden>📁</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span aria-hidden>{s.icon} </span>
                    {t(s.label)}
                  </span>
                  <span className="shrink-0 rounded-full bg-fg/10 px-1.5 font-mono text-[10px] text-muted">{list.length}</span>
                  <ChevronRight size={13} aria-hidden className={`shrink-0 text-faint transition ${expanded ? 'rotate-90' : ''}`} />
                </button>
                {expanded && (
                  <div role="menu" aria-label={t(s.label)} className="flex flex-col gap-px pb-1">
                    {list.length === 0 ? (
                      <span className="py-1.5 pr-2 pl-8 text-xs text-faint">{t('addMenuSectionEmpty')}</span>
                    ) : (
                      list.map((n) => {
                        const count = n.display === 'full' && n.body.trim() ? screenPagesOf(n).length : 0;
                        return (
                          <button key={n.id} type="button" role="menuitem" className={ENTRY} title={n.title} onClick={() => pick(() => onHubItem(n))}>
                            <span aria-hidden className="shrink-0">{n.display === 'operator' ? '📝' : n.display === 'lower' ? '▭' : '▣'}</span>
                            <span className="min-w-0 flex-1 truncate">{n.title}</span>
                            {count > 1 && <span className="shrink-0 font-mono text-[10px] text-faint">{t('addMenuSlideCount', { n: count })}</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div role="separator" className="my-0.5 border-t border-line" />
          <button type="button" role="menuitem" className={ITEM} onClick={() => pick(onSlides)}>
            <span aria-hidden>📄</span> {t('addMenuSlides')}
          </button>
        </div>
      )}
    </div>
  );
}

/** The + on a slot's row (on hover or keyboard focus): writes a note or prayer for that slot. */
function SlotAddButton({ slot, busy, onAdd, className }: { slot: MassSlot; busy: boolean; onAdd: (slot: string) => void; className: string }) {
  const t = useGoLiveT();
  const label = t('noteAddToSlot', { slot: `${slot.position}. ${slot.name}` });
  return (
    <button
      type="button"
      onClick={() => onAdd(slot.id)}
      disabled={busy}
      aria-label={label}
      title={label}
      className={`absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-faint opacity-0 transition group-hover:opacity-100 hover:bg-accent/15 hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:hidden ${className}`}
    >
      <Plus size={14} aria-hidden />
    </button>
  );
}

/**
 * The Mass's order of service: the queue, grouped by its liturgical block, with what is done, what is on, and what is missing. Every one of the
 * Holy Mass slots is shown, an empty one in its place, so slides put in never hide the order of Mass. Each row has a ✕ (on hover or
 * keyboard focus) that takes it out: a slot's item leaves the slot empty, any other row is gone. Each slot has a + that writes a note or prayer
 * for it. A row that plays a note carries its badge, and opens under itself (instead of playing at once) so a private note can be read and a
 * prayer staged or taken live.
 */
function MassLineup({
  items,
  cursor,
  selected,
  onPick,
  onPlay,
  onRemove,
  onAdd,
  onAddNote,
  onStageNote,
  onHubItem,
  onReset,
  notes,
  busy,
}: {
  items: QueueItem[];
  cursor: number;
  /** The row selected to look at and edit, not on air, or null. */
  selected: number | null;
  /** Selects a row: its slides show in the console to check and edit, and the projector keeps what it shows. */
  onPick: (i: number) => void;
  /** Plays a row (a note drawer's Take live). */
  onPlay: (i: number) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  onAddNote: (slot: string | null) => void;
  onStageNote: (note: Note, slides: number[] | null) => void;
  onHubItem: (note: Note) => void;
  /** Every Liturgical Content Hub entry by id, read again on every notes:changed. */
  notes: Map<number, Note>;
  onReset: () => void;
  busy: boolean;
}) {
  const t = useGoLiveT();
  const tPlan = usePlannerT();
  // The note row opened under itself, by the note it plays (a note is in the Mass once), so rows put in above it do not move it.
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Picking a note row opens its drawer; any other move of the selection (Next, Back, a hotkey) closes it, so a drawer never lingers once
  // the flow has moved on.
  useEffect(() => setOpenRow(null), [cursor]);
  const noteOf = (item: QueueItem) => (item.module === 'notes' ? notes.get(noteSource(item.sourceId)?.id ?? NaN) : undefined);
  const blockTitle = (block: string) => {
    const def = BLOCKS.find((b) => b.id === block);
    return def ? tPlan(def.titleKey as Parameters<typeof tPlan>[0]) : '';
  };
  const done = Math.max(0, cursor);
  let lastBlock: string | null = null;
  const sectionHeader = (block: string) => {
    const header = block !== lastBlock ? blockTitle(block) : null;
    lastBlock = block;
    return header && <span className="mt-2 mb-1 px-1 text-[10px] font-bold tracking-wider text-faint uppercase first:mt-0">{header}</span>;
  };
  return (
    <section aria-labelledby="mass-lineup" className={`${CARD} flex min-w-0 flex-col p-4`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 px-1">
        <h2 id="mass-lineup" className="text-lg font-bold tracking-tight whitespace-nowrap">{t('massOrder')}</h2>
        <span className="font-mono text-xs whitespace-nowrap text-muted">{t('massDoneOf', { done, total: items.length })}</span>
      </div>
      <div className="mb-3 flex gap-2">
        <AddMenu busy={busy} notes={notes} onSlides={onAdd} onNote={() => onAddNote(null)} onHubItem={onHubItem} />
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          title={t('massConfirmReset')}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-fg/20 px-3 text-xs font-semibold whitespace-nowrap text-fg/80 transition hover:border-danger/60 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
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
                <div className="group relative">
                  <div className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-dashed border-fg/15 py-2 pr-9 pl-3 text-left opacity-60 group-hover:opacity-80">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-fg/25 font-mono text-[11px] text-muted">{slot.position}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] leading-tight text-fg/70">{slot.name}</span>
                      <span className="text-[10px] font-semibold tracking-wider text-faint uppercase">{t('massEmptySlot')}</span>
                    </span>
                  </div>
                  <SlotAddButton slot={slot} busy={busy} onAdd={onAddNote} className="right-1.5" />
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
          const picked = i === selected && !current;
          const isNote = item.module === 'notes';
          const note = noteOf(item);
          const opened = isNote && openRow === item.sourceId;
          // A note put in after a slot has no slot of its own on its row; the slot it was written for still names it.
          const labelSlot = slot ?? (note ? slotById(note.slot) : null);
          return (
            <li key={`${item.module}-${item.sourceId}-${i}`} className="flex flex-col">
              {header}
              <div className="group relative">
                <button
                  type="button"
                  // Picking a row selects it without playing it: its slides show in the console, to check and edit, and the projector keeps
                  // what it shows. Go live (or a slide of it) plays it. A note's row also opens under itself, where a private note is read and
                  // a prayer staged or taken live; picking it again closes it.
                  onClick={() => {
                    if (isNote) setOpenRow(opened ? null : item.sourceId);
                    onPick(i);
                  }}
                  disabled={busy || item.stale}
                  aria-current={current ? 'step' : undefined}
                  aria-pressed={picked}
                  aria-expanded={isNote ? opened : undefined}
                  title={item.stale ? t('massMissingHint') : isNote ? t('noteOpenRow', { item: item.label }) : undefined}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-lg border py-2 ${slot ? 'pr-16' : 'pr-9'} pl-3 text-left transition disabled:cursor-not-allowed ${
                    current
                      ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5'
                      : picked
                        ? 'border-dashed border-accent/70 bg-fg/[0.06]'
                        : 'border-transparent hover:bg-fg/[0.06]'
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      {note && <NoteBadge note={note} t={t} />}
                      <span className="truncate text-[10px] font-semibold tracking-wider text-faint uppercase">
                        {labelSlot ? `${slot ? '' : '↳ '}${labelSlot.position}. ${labelSlot.name}${note ? '' : ' · '}` : ''}
                        {note ? '' : MODULE_TAG[item.module]}
                      </span>
                    </span>
                  </span>
                  {item.stale && <span className="shrink-0 text-[10px] font-extrabold tracking-wide text-danger uppercase">{t('massMissing')}</span>}
                </button>
                {slot && <SlotAddButton slot={slot} busy={busy} onAdd={onAddNote} className="right-9" />}
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  disabled={busy}
                  aria-label={t(slot ? 'massRemoveSlot' : 'massRemove', { item: item.label })}
                  title={t(slot ? 'massRemoveSlot' : 'massRemove', { item: item.label })}
                  className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-faint opacity-0 transition group-hover:opacity-100 hover:bg-danger/15 hover:text-danger focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none disabled:hidden"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              {opened && !item.stale && (
                <NoteDrawer
                  note={note}
                  slides={noteSource(item.sourceId)?.slides ?? null}
                  busy={busy}
                  t={t}
                  onStage={onStageNote}
                  onTake={() => {
                    setOpenRow(null);
                    onPlay(i);
                  }}
                />
              )}
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
    <div role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-body" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-fg/20 bg-surface p-6 shadow-2xl">
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
  const tPlan = usePlannerT();
  const live = useLive((s) => s.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The Add slides picker, while it is open.
  const [adding, setAdding] = useState(false);
  // The Add Note / Prayer dialog, while it is open, with the slot it was opened from (null: the slot of the row on air).
  const [noteFor, setNoteFor] = useState<{ slot: string | null } | null>(null);
  // The Liturgical Content Hub entry whose slides are being picked, by id, so the picker shows the entry as it is now.
  const [pickingNote, setPickingNote] = useState<number | null>(null);
  // Every Hub entry, read again on every notes:changed, for the Add slides menu, the lineup's badges and the slide picker.
  const notes = useNotesById();
  // The Reset order confirmation, while it is open.
  const [confirmingReset, setConfirmingReset] = useState(false);
  const { liveSince } = useMassClock();
  const now = useNow().getTime();

  // A confirmation fades on its own, so it never sits over later work.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const queue = live.queue;
  const cursor = live.queueCursor;
  // The Mass has the screen, with the projector window open or not (the TV and phones, or the app alone). The console bar's Live button reads the
  // same answer (runOnAir in onAir.ts is massShowing for the Mass).
  const onAir = massShowing(live);
  // The header's item timer: from zero on each item, running while the Mass has the screen. Items have no planned length.
  const timer = useSegmentTimer('mass', cursor >= 0 && queue[cursor] ? `${live.queuePlanId}:${queue[cursor].id}:${cursor}` : null, onAir);
  // The row selected in the lineup to look at and edit without playing it (its queue index), or null for the item on air. It is let go when
  // another plan loads or rows are put in or taken out, so it never lands on a different row.
  const [browse, setBrowse] = useState<number | null>(null);
  useEffect(() => setBrowse(null), [live.queuePlanId, queue.length]);
  const browseItem = browse !== null && browse !== cursor ? queue[browse] ?? null : null;
  const browseIndex = browseItem ? browse : null;
  // The selected row's first slide, built without staging it (queueItemFrame), read again when the row or any Hub entry changes.
  const browseId = browseItem ? `${live.queuePlanId}|${browseIndex}|${browseItem.module}|${browseItem.sourceId}|${browseItem.slot ?? ''}|${browseItem.label}` : null;
  const [browsed, setBrowsed] = useState<{ id: string; frame: Frame | null } | null>(null);
  const [browseRevision, setBrowseRevision] = useState(0);
  useEffect(() => bridge.notes.onChanged(() => setBrowseRevision((n) => n + 1)), []);
  useEffect(() => {
    if (!browseItem || browseIndex === null || !browseId) return;
    let alive = true;
    queueItemFrame(browseItem, browseIndex)
      .then((frame) => alive && setBrowsed({ id: browseId, frame }))
      .catch(() => alive && setBrowsed({ id: browseId, frame: null }));
    return () => {
      alive = false;
    };
  }, [browseId, browseRevision]);
  const browseReady = browseId !== null && browsed?.id === browseId;
  const browseFrame = browseReady ? browsed!.frame : null;
  const browseHymn = useHymnOf(browseFrame ?? NO_FRAME);
  const browseNote = useNoteOf(browseFrame ?? NO_FRAME);
  // The Output Preview Editor, open on slide `slide` of queue row `row`, or null. It stays open while that row is on air or selected, so it
  // closes when the Mass moves on from the row on air, and goes on editing a selected row that is put on air from it.
  const [editing, setEditing] = useState<{ row: number; slide: number } | null>(null);
  useEffect(() => setEditing(null), [live.queuePlanId]);
  // The slide on air, for E. Set below, once the item's slides are known.
  const liveSlide = useRef<number | null>(null);
  const monitorsRef = useRef<HTMLDivElement>(null);
  const cueMeta = useCueMeta((s) => s.meta);
  // B, L and H run Blackout, the Lower Third and Hide Text, and E opens the editor on the slide on air (← → Space and 1–9 are the operator
  // window's and the cue navigator's).
  const editOnAir = () => liveSlide.current !== null && setEditing({ row: useLive.getState().state.queueCursor, slide: liveSlide.current });
  useConsoleKeys((action) => (action === 'edit' ? editOnAir() : consoleOutputActions[action]()), queue.length > 0);
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
  // A lower-third or private note row leaves the slide before it on screen: that slide is not this row's, so it has no chips or editor here.
  const offScreenNote = noteRowOffScreen(live, frame);
  const steps = item && !offScreenNote ? stepsOf(frame, hymn) : null;
  // Next and Back step inside the item only while it is on screen; from a staged item they move through the queue.
  const liveSteps = onAir ? steps : null;
  const nextInItem = steps && steps.index + 1 < steps.count ? frameAt(frame, steps.index + 1, hymn, slotNameAt(live), note) : null;
  const nextItemIndex = queue.findIndex((q, i) => i > cursor && !q.stale);
  const nextItem = nextItemIndex >= 0 ? queue[nextItemIndex] : null;
  // A song after this item opens on its title card, so that card is what comes next. Any other item is shown by its name.
  const nextItemFrame = nextItem?.module === 'lyrics' ? songTitleFrame({ id: Number(nextItem.sourceId), title: nextItem.label, stanzas: [] }, slotById(nextItem.slot)?.name) : null;
  const lookKeyAt = (row: number, i: number) => massLookKey(live.queuePlanId, row, i);

  /**
   * One item as the console works on it: the item on air (or staged), or the row selected in the lineup. Its slides as cues for Jump to Cue
   * (a song's title card, with no number key, and its sections under its title; any other item's numbered slides, with their words), and the
   * Output Preview Editor's view of each slide.
   */
  const itemView = (v: { row: number; item: QueueItem | null; frame: Frame | null; hymn: Hymn | null; note: Note | null; steps: ItemSteps | null; onScreen: boolean; slotName: string | null; slides: boolean }) => {
    const isSong = v.item?.module === 'lyrics' && v.hymn !== null;
    const pages = v.item && v.frame && !isSong && v.steps ? slidePagesOf(v.frame, v.note) : null;
    const cues: Cue[] = (v.steps?.labels ?? []).map((label, i) => {
      if (isSong && v.hymn) {
        if (i === 0) return { index: 0, number: 1, tag: tp('titleChip'), text: v.hymn.title, chip: 'T', hotkey: false };
        const stanza = v.hymn.stanzas[i - 1];
        return { index: i, number: i + 1, tag: stanza?.stanzaType ?? label, text: stanza?.lyricsText ?? '', group: v.hymn.title, chip: label };
      }
      return { index: i, number: i + 1, tag: tp('slideName', { n: i + 1 }), text: pages?.[i] ?? '', chip: label };
    });
    // The editor opens on any slide of the item. An item of one slide is slide 0; a note row off screen, or a row with no slide, has none.
    const slideCount = !v.item || !v.frame || !v.slides ? 0 : v.steps ? v.steps.count : 1;
    const slideAt = v.steps?.index ?? 0;
    const cueAt = (i: number): EditorCue | null => {
      const { item, frame, hymn, note } = v;
      if (!item || !frame || i < 0 || i >= slideCount) return null;
      const cueFrame = i === slideAt ? frame : frameAt(frame, i, hymn, v.slotName, note);
      if (!cueFrame) return null;
      const target: SlideEditTarget | null = isSong
        ? i >= 1
          ? songTarget({ hymn: hymn!, stanza: i - 1, number: i + 1, key: `mass:${item.id}:${i}`, remove: massSongRemove(hymn!, i - 1), layout: massSongLayout(i - 1) })
          : null
        : item.module === 'lyrics'
          ? null
          : massPagesTarget({ t: tp, item, index: v.row, frame, note, page: i });
      return {
        index: i,
        count: slideCount,
        lookKey: lookKeyAt(v.row, i),
        ownLook: frameOwnLook(cueFrame),
        ownNotes: isSong && i >= 1 ? hymn?.stanzas[i - 1]?.notes : undefined,
        target,
        tag: cues[i]?.tag ?? item.label,
        text: cues[i]?.text ?? pages?.[i] ?? '',
        onAir: v.onScreen && i === slideAt,
        preview: ({ text, look }) => <FramePreview frame={target ? withWords(cueFrame, text) : cueFrame} look={look} />,
        // The item on air steps within itself; a selected row goes on air at this slide.
        goLive: () => (v.row !== cursor ? playMassItemAt(v.row, i) : i === slideAt ? playMassAt(cursor) : goWithin(i, frame)),
      };
    };
    return { isSong, pages, cues, slideCount, slideAt, cueAt };
  };

  const liveView = itemView({ row: cursor, item, frame, hymn, note, steps, onScreen: onAir, slotName: slotNameAt(live), slides: !offScreenNote });
  const { isSong, cues, slideCount, slideAt } = liveView;
  const browseView =
    browseItem && browseIndex !== null
      ? itemView({
          row: browseIndex,
          item: browseItem,
          frame: browseFrame,
          hymn: browseHymn,
          note: browseNote,
          steps: browseFrame ? stepsOf(browseFrame, browseHymn) : null,
          onScreen: false,
          slotName: slotById(browseItem.slot)?.name ?? null,
          slides: true,
        })
      : null;
  const textCase = textCaseOf(live.settings.textCase);
  // The slide editor's target: the stanza on screen of a song (its title card has no words), or the slide of any other item, in this plan's copy.
  const editTarget: SlideEditTarget | null =
    !item || offScreenNote
      ? null
      : isSong
        ? liveSteps && liveSteps.index >= 1
          ? songTarget({ hymn: hymn!, stanza: liveSteps.index - 1, number: liveSteps.index + 1, key: `mass:${item.id}:${liveSteps.index}`, remove: massSongRemove(hymn!, liveSteps.index - 1), layout: massSongLayout(liveSteps.index - 1) })
          : null
        : item.module === 'lyrics'
          ? null
          : massPagesTarget({ t: tp, item, index: cursor, frame, note });
  const missing = queue.filter((q) => q.stale).length;
  const projectorOn = live.outputs.projector;
  // Something other than the Mass has the projector while the Mass has a place: offer to put the Mass back.
  const otherOnAir = cursor >= 0 && projectorOn && !onAir && live.projector.live.kind !== 'idle' && live.projector.live.kind !== 'blackout';
  // Under the welcome screen or Blackout, Next and Back always work: they put the covered slide back.
  const atStart = !covered && cursor <= 0 && (!liveSteps || liveSteps.index === 0);
  const atEnd = !covered && nextItemIndex < 0 && (!liveSteps || liveSteps.index >= liveSteps.count - 1);

  liveSlide.current = slideCount > 0 ? slideAt : null;
  const openEditor = (i: number) => i >= 0 && i < slideCount && setEditing({ row: cursor, slide: i });
  const liveNote = slideCount > 0 ? cueMeta[lookKeyAt(cursor, slideAt)]?.notes ?? null : null;
  // The editor works on the row it was opened on, while that row is on air or selected.
  const editingView = editing && editing.row === cursor ? liveView : editing && browseView && editing.row === browseIndex ? browseView : null;
  const editingTitle = editing ? queue[editing.row]?.label ?? '' : '';
  /** Plays the selected row (from slide `slide`), and lets the selection go: the console then follows it on air. */
  const goLiveBrowsed = (slide = 0) => {
    if (browseIndex === null) return;
    const row = browseIndex;
    setBrowse(null);
    void run(() => (slide > 0 ? playMassItemAt(row, slide) : cursor >= 0 ? playMassAt(row) : goLiveMassAt(row, planName)));
  };

  const upNext = nextInItem
    ? t('consoleUpNext', { text: cueText(cues[steps!.index + 1]?.text, textCase) || cues[steps!.index + 1]?.tag || '' })
    : nextItem
      ? `${t('consoleFinalSlide')} · ${t('consoleUpNext', { text: nextItem.label })}`
      : t('massEndOfQueue');

  return (
    <div className="flex flex-col gap-5">
      {/* The Mass at a glance: where it is, the item switcher, the item timer, the output status, and the ways to clear the screen or end it. */}
      <BroadcastHeader
        titleId="mass-live-title"
        live={onAir}
        at={Math.max(0, cursor)}
        total={queue.length}
        role={item ? blockTitle(item) : planName ?? ''}
        options={queue.map((q, i) => ({ value: String(i), label: q.label, disabled: q.stale }))}
        value={cursor >= 0 ? String(cursor) : ''}
        onPick={(v) => void run(() => (cursor >= 0 ? playMassAt(Number(v)) : goLiveMassAt(Number(v), planName)))}
        disabled={busy}
        timer={{ elapsedMs: timer.elapsedMs, plannedMs: null, running: timer.running, onToggle: timer.toggle, onReset: timer.reset }}
        status={outputStatus(live, onAir)}
        tools={
          <>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-muted">{tp('sessionTime')}</span>
              <span className="font-mono text-sm text-fg tabular-nums">{clock(liveSince ? now - liveSince : 0)}</span>
            </span>
            {planName && (
              <span className="flex max-w-72 min-w-0 items-baseline gap-1.5">
                <span className="text-[11px] text-muted">{t('massPlanLabel')}</span>
                <span className="truncate text-sm font-semibold text-fg" title={planName}>{planName}</span>
              </span>
            )}
            <IntroSlideToggle />
          </>
        }
        actions={
          <>
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
          </>
        }
      />

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
      {noteFor && (
        <AddSlotNotePrayerModal
          queue={queue}
          cursor={cursor}
          slot={noteFor.slot}
          t={t}
          onClose={() => setNoteFor(null)}
          onDone={(message) => {
            setNoteFor(null);
            setNotice(message);
          }}
        />
      )}
      {pickingNote != null && (
        <HubSlideSelectionModal
          note={notes.get(pickingNote)}
          queue={queue}
          cursor={cursor}
          t={t}
          onClose={() => setPickingNote(null)}
          onDone={(message) => {
            setPickingNote(null);
            setNotice(message);
          }}
        />
      )}
      {confirmingReset && <ConfirmResetModal onConfirm={resetOrder} onClose={() => setConfirmingReset(false)} />}

      <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <MassLineup
          items={queue}
          cursor={cursor}
          selected={browseIndex}
          busy={busy}
          onPick={(i) => setBrowse(i === cursor ? null : i)}
          onPlay={(i) => {
            setBrowse(null);
            void run(() => playMassAt(i));
          }}
          onRemove={removeRow}
          onAdd={() => setAdding(true)}
          onAddNote={(slot) => setNoteFor({ slot })}
          // Staged only: the projector's next frame, which Take live (or the console's take) puts up. A private note has no Stage.
          notes={notes}
          onHubItem={(n) => setPickingNote(n.id)}
          onStageNote={(n, slides) => {
            stagePrayer(n, 0, slides);
            setNotice(t('noteStaged', { title: n.title }));
          }}
          onReset={() => setConfirmingReset(true)}
        />

        <div className="@container/work min-w-0">
          <div className="grid grid-cols-1 items-start gap-5 @4xl/work:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-label={t('consoleProgram')} className={`${CARD} flex flex-col gap-4 p-4`}>
                {item ? (
                  // The slide on screen (or staged and ready), with what Next puts up beside it: the next slide of this item, or the next item.
                  <StageMonitors
                    boxRef={monitorsRef}
                    onEditLive={slideCount > 0 ? () => openEditor(slideAt) : null}
                    onEditNext={nextInItem ? () => openEditor(slideAt + 1) : null}
                    cueNote={liveNote}
                    program={<FramePreview frame={frame} />}
                    counter={steps ? t('consoleSlideOf', { n: cuePad2(steps.index + 1), total: cuePad2(steps.count) }) : null}
                    next={
                      nextInItem ? (
                        // The next slide is not the projector's yet, so its own look (if it has one) is handed over by its key.
                        <FramePreview frame={nextInItem} look={live.slideLooks?.[lookKeyAt(cursor, slideAt + 1)] ?? frameOwnLook(nextInItem)} />
                      ) : nextItemFrame ? (
                        <FramePreview frame={nextItemFrame} />
                      ) : nextItem ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-stone-950 p-3 text-center text-white">
                          <span className="text-[10px] font-semibold tracking-wider text-white/70 uppercase">{MODULE_TAG[nextItem.module]}</span>
                          <span className="line-clamp-3 text-sm font-bold">{nextItem.label}</span>
                        </div>
                      ) : null
                    }
                    upNext={upNext}
                    onPushNext={busy || atEnd ? null : () => void run(() => stepMass(1))}
                  />
                ) : (
                  <div className="flex flex-col items-start gap-3">
                    <h2 className="text-2xl leading-tight font-bold tracking-tight">{t('massReadyTitle', { name: planName ?? '' })}</h2>
                    <p className="text-sm text-muted">{t('massReadyHint')}</p>
                    {firstPlayable >= 0 && (
                      <button type="button" className={BTN_GO} disabled={busy} onClick={() => void run(() => goLiveMassAt(firstPlayable, planName))}>
                        <Play size={16} aria-hidden fill="currentColor" /> {t('massStart', { name: queue[firstPlayable].label })}
                      </button>
                    )}
                  </div>
                )}
                <TransportBar
                  onBack={() => void run(() => stepMass(-1))}
                  onNext={() => void run(() => stepMass(1))}
                  backDisabled={busy || atStart}
                  nextDisabled={busy || atEnd}
                  counter={steps ? `${cuePad2(steps.index + 1)} / ${cuePad2(steps.count)}` : null}
                />
              </section>
              {browseItem && browseView && browseIndex !== null ? (
                <>
                  {/* A row selected in the lineup: its slides, to check and edit, while the projector keeps the item on air. */}
                  <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-dashed border-accent/70 bg-panel-2 px-4 py-3">
                    <div className="flex min-w-0 flex-col">
                      <span className={EYEBROW}>{t('consoleBrowsing')}</span>
                      <span className="truncate text-base font-bold" title={browseItem.label}>{browseItem.label}</span>
                      <span className="text-xs text-muted">{t('consoleBrowseHint')}</span>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button type="button" className={BTN} onClick={() => setBrowse(null)}>
                        {t('consoleBackToLive')}
                      </button>
                      <button type="button" className={BTN_GO} disabled={busy || browseItem.stale} onClick={() => goLiveBrowsed()}>
                        <Play size={15} aria-hidden fill="currentColor" /> {t('consoleBrowseGoLive')}
                      </button>
                    </div>
                  </div>
                  <CueNavigator
                    cues={browseView.cues}
                    activeIndex={-1}
                    onSelect={(i) => goLiveBrowsed(i)}
                    onEdit={(i) => i >= 0 && i < browseView.slideCount && setEditing({ row: browseIndex, slide: i })}
                    disabled={busy}
                    empty={!browseReady ? t('consoleBrowseLoading') : browseFrame ? t('massOneSlide') : t('consoleBrowseNoSlides')}
                    itemKey={`browse:${browseItem.id}:${browseIndex}`}
                    keyTarget={{ cues: item ? cues : [], activeIndex: steps?.index ?? -1, onSelect: (i) => void run(() => goWithin(i, frame)) }}
                  />
                </>
              ) : (
                item && (
                  <CueNavigator
                    cues={cues}
                    activeIndex={steps?.index ?? -1}
                    onSelect={(i) => void run(() => goWithin(i, frame))}
                    onEdit={openEditor}
                    disabled={busy}
                    empty={t('massOneSlide')}
                    itemKey={`${item.id}:${cursor}`}
                  />
                )
              )}
              {/* What the congregation and livestream see, then what comes next: under the stage, so the columns stay balanced. */}
              <OutputsCard titleId="mass-outputs" />
              <div className="grid grid-cols-1 gap-5 @2xl/work:grid-cols-2">
                <section aria-labelledby="mass-next-up" className={`${CARD} flex flex-col gap-1 p-4`}>
                  <h2 id="mass-next-up" className={EYEBROW}>{tp('nextUp')}</h2>
                  {nextItem ? (
                    <>
                      <p className="text-xl font-bold tracking-tight">{nextItem.label}</p>
                      <p className="text-sm font-semibold text-muted">{MODULE_TAG[nextItem.module]}</p>
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

            <aside className="flex min-w-0 flex-col gap-5">
              <SlideEditorCard
                target={editTarget}
                onOpenEditor={slideCount > 0 ? () => openEditor(slideAt) : null}
                number={steps ? steps.index + 1 : item ? 1 : null}
                emptyHint={!item ? t('consoleNothingLive') : isSong && !liveSteps ? t('consoleNothingLive') : t('consoleEditNone')}
              />
              <TypographyCard />
              <SecondaryControls />

            </aside>
          </div>
        </div>
      </div>

      {/* Scrolled away from the monitors, the slide on air docks in the corner with Back, Next, Edit and Blackout. */}
      {item && (
        <FloatingProgram
          anchor={monitorsRef}
          live={onAir}
          program={<FramePreview frame={frame} />}
          counter={steps ? `${cuePad2(steps.index + 1)} / ${cuePad2(steps.count)}` : null}
          onBack={() => void run(() => stepMass(-1))}
          onNext={() => void run(() => stepMass(1))}
          backDisabled={busy || atStart}
          nextDisabled={busy || atEnd}
          onEdit={slideCount > 0 ? () => openEditor(slideAt) : null}
          suspended={editing !== null}
        />
      )}
      {editing !== null && editingView && (
        <SlideEditorModal
          index={editing.slide}
          cueAt={editingView.cueAt}
          title={editingTitle}
          onIndex={(i) => i >= 0 && i < editingView.slideCount && setEditing({ row: editing.row, slide: i })}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
