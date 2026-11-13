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
import { MassSlideHotEdit } from './MassSlideHotEdit';
import { usePwT } from '../praise-worship/strings';
import { usePlannerT } from '../planner/strings';
import { BLOCKS } from '../planner/types';
import { useT } from '../i18n/strings';
import { setUi } from '../state/ui';
import { blackoutOverMass, slotTitleShown, welcomeOverMass, type QueueItem } from '../../shared/live.js';
import { endMassSession, frameAt, goLiveMassAt, goWithin, massShowing, noteRowOffScreen, playMassAt, slotNameAt, stepMass, stepsOf, useHymnOf, useMassClock, useNoteOf } from './massLive';
import { LiveStageCanvas, type StageChipGroup } from '../components/LiveStageCanvas';
import { useGoLiveT } from './strings';
import { InFlowSlidePickerModal } from './InFlowSlidePickerModal';
import { DetachMonitorButton } from '../components/DetachMonitorButton';

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
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-accent/50 px-3 text-xs font-bold tracking-wide text-accent uppercase transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
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
  onPick,
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
  onPick: (i: number) => void;
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
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 id="mass-lineup" className="text-lg font-bold tracking-tight">{t('massOrder')}</h2>
        <span className="font-mono text-xs text-muted">{t('massDoneOf', { done, total: items.length })}</span>
      </div>
      <div className="mb-3 flex gap-2">
        <AddMenu busy={busy} notes={notes} onSlides={onAdd} onNote={() => onAddNote(null)} onHubItem={onHubItem} />
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
                  // Picking a row selects it and plays it, as a Praise & Worship lineup row does; a note's row then opens under itself, where a
                  // private note is read and a prayer can be staged again. Picking the row already selected only opens or closes its drawer.
                  onClick={() => {
                    if (isNote && current) return setOpenRow(opened ? null : item.sourceId);
                    onPick(i);
                  }}
                  disabled={busy || item.stale}
                  aria-current={current ? 'step' : undefined}
                  aria-expanded={isNote ? opened : undefined}
                  title={item.stale ? t('massMissingHint') : isNote ? t('noteOpenRow', { item: item.label }) : undefined}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-lg border py-2 ${slot ? 'pr-16' : 'pr-9'} pl-3 text-left transition disabled:cursor-not-allowed ${
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
                    onPick(i);
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
  const tMain = useT();
  const tPlan = usePlannerT();
  const live = useLive((s) => s.state);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
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
  // The Mass has the screen, with the projector window open or not (the TV and phones, or the app alone). The console bar's Live button reads the
  // same answer (runOnAir in onAir.ts is massShowing for the Mass).
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
  const isSong = item?.module === 'lyrics' && hymn !== null;
  // A song's title card takes no number key, so 1 is its first stanza.
  const chips = (steps?.labels ?? []).map((label, i) => ({ index: i, label, name: isSong && i === 0 ? tp('titleChip') : label, hotkey: !(isSong && i === 0) }));
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
            onAir ? 'border-danger/60 bg-danger/15 text-danger' : 'border-fg/20 bg-fg/[0.06] text-muted'
          }`}
        >
          <span aria-hidden className={`size-2 rounded-full ${onAir ? 'animate-pulse bg-danger' : 'bg-fg/50'}`} />
          {onAir ? tp('liveBadge') : tp('offAir')}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-muted">{tp('sessionTime')}</span>
          <span className="font-mono text-2xl tabular-nums text-fg">{clock(liveSince ? now - liveSince : 0)}</span>
        </span>
        {planName && (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-xs text-muted">{t('massPlanLabel')}</span>
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

      <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] @6xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(260px,320px)]">
        <MassLineup
          items={queue}
          cursor={cursor}
          busy={busy}
          onPick={(i) => void run(() => playMassAt(i))}
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
                        <FramePreview frame={frame} counter={steps ? `${steps.index + 1} / ${steps.count}` : undefined} />
                      </div>
                    </figure>
                    <figure className="flex min-w-0 flex-col gap-1.5">
                      <figcaption className={EYEBROW}>{nextInItem ? t('massNextSlide') : t('massNextItemCard')}</figcaption>
                      {nextInItem ? (
                        <div className={STAGE}>
                          <FramePreview frame={nextInItem} counter={`${steps!.index + 2} / ${steps!.count}`} />
                        </div>
                      ) : nextItemFrame ? (
                        <div className={STAGE}>
                          <FramePreview frame={nextItemFrame} />
                        </div>
                      ) : nextItem ? (
                        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-stone-950 p-3 text-center text-white">
                          <span className="text-[10px] font-semibold tracking-wider text-white/70 uppercase">{MODULE_TAG[nextItem.module]}</span>
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
              onChipDoubleClick={(i) => setEditRequest(i)}
              noChips={<p className="text-sm text-muted">{t('massOneSlide')}</p>}
            >
              {isSong || item.module === 'lyrics' ? (
                <MassHotEdit
                  t={tp}
                  hymn={isSong ? hymn : null}
                  onAir={isSong && liveSteps ? liveSteps.index : null}
                  editRequest={editRequest}
                  onEditHandled={() => setEditRequest(null)}
                  onShow={(step) => void run(() => goWithin(step))}
                />
              ) : offScreenNote ? null : (
                // Every other item (a Mass part, reading, psalm, prayer, typed response or passage) is edited in this plan's own copy of it.
                <MassSlideHotEdit
                  t={tp}
                  item={item}
                  index={cursor}
                  frame={frame}
                  note={note}
                  onAir={onAir && !covered}
                  editRequest={editRequest}
                  onEditHandled={() => setEditRequest(null)}
                />
              )}
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
            <div className="flex items-center justify-between gap-2">
              <h2 id="mass-outputs" className="text-lg font-bold">{tp('outputs')}</h2>
              <DetachMonitorButton />
            </div>
            <span className="text-sm text-muted">{tp('congregation')}</span>
            <div className="relative aspect-video overflow-hidden rounded-lg border border-line">
              <ProjectorView mirror embedded />
            </div>
            <span className="text-sm text-muted">{tp('livestream')}</span>
            <div data-theme="default" className="relative aspect-video overflow-hidden rounded-lg border border-line bg-canvas [container-type:size]">
              {live.lowerThird.live ? (
                <LowerThirdStage value={live.lowerThird.live} lyricBottomShare={lyricBottomOf(live.projector.live)} />
              ) : (
                <div className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-faint">
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
    </div>
  );
}
