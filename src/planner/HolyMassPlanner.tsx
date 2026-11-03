import { useState, type MutableRefObject, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileText, Music, Pencil, Play, Plus, X } from 'lucide-react';
import { MASS_SECTIONS, MASS_SLOTS, additionalIn, filledIn, indexOfSlot, slotsOfBlock, type MassSlot } from '../../shared/mass-slots.js';
import { canStageRow } from '../../shared/stage-plan-row.js';
import { MassItemSelect, type PickedItem } from './MassItemSelect';
import { responseChoices } from './slotChoices';
import { useSlotSuggestions } from './useSlotSuggestions';
import type { DragSource } from './logic';
import type { PlannerT } from './strings';
import type { LiturgicalBlock, PlanItem } from './types';

const COLLAPSED_KEY = 'apcc.holyMassCollapsed';
/** The sections the operator has closed, remembered between visits. A blocked or damaged store simply starts with every section open. */
function readCollapsed(): LiturgicalBlock[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((b): b is LiturgicalBlock => MASS_SECTIONS.some((s) => s.block === b)) : [];
  } catch {
    return [];
  }
}

function writeCollapsed(blocks: LiturgicalBlock[]) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(blocks));
  } catch {
    // A full or blocked store only means the choice is not kept.
  }
}

interface Props {
  t: PlannerT;
  lang: 'en' | 'tl' | 'ceb';
  /** The plan's items as shown: a position here is a position in the saved plan. */
  items: PlanItem[];
  onFill: (slotId: string, item: PickedItem) => void;
  onClear: (slotId: string) => void;
  /** A library item or a plan row was dropped on a slot. */
  onDropOnSlot: (slotId: string) => void;
  /** A drop on a section's additional items: the block and the place among its rows. */
  onDropInSection: (block: LiturgicalBlock, slot: number) => void;
  onStage: (index: number) => void;
  /** The row loaded into the Stage / Preview by its ▷ button, marked so the operator can see it. */
  activeIndex: number | null;
  dragRef: MutableRefObject<DragSource | null>;
  /** The drop mark of the additional items, kept by the planner. */
  drop: { block: LiturgicalBlock; slot: number } | null;
  setDrop: (drop: { block: LiturgicalBlock; slot: number } | null) => void;
  /** One additional item's row: the planner draws these as it always has (placeholders, choose, move, play, remove). */
  renderAdditional: (row: PlanItem, rows: PlanItem[], slot: number, block: LiturgicalBlock) => ReactNode;
}

/**
 * The Holy Mass order of 17 slots in five collapsible sections (see shared/mass-slots.js). Every slot is a named, numbered place: a filled one
 * shows its hymn or item and can be changed, played, cleared or dragged to another slot; an empty one takes a drop from the library or opens
 * the search picker (MassItemSelect) under it. Items that fill no slot (notes, announcements, plans from before slots) stay in their section
 * as additional items.
 */
export function HolyMassPlan({ t, lang, items, onFill, onClear, onDropOnSlot, onDropInSection, onStage, activeIndex, dragRef, drop, setDrop, renderAdditional }: Props) {
  const [collapsed, setCollapsed] = useState<LiturgicalBlock[]>(readCollapsed);
  const [picking, setPicking] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<string | null>(null);
  // The songs each card offers as chips, filtered to that slot's own song category.
  const suggestions = useSlotSuggestions(MASS_SLOTS);

  const setClosed = (next: LiturgicalBlock[]) => {
    setCollapsed(next);
    writeCollapsed(next);
  };
  const toggle = (block: LiturgicalBlock) => setClosed(collapsed.includes(block) ? collapsed.filter((b) => b !== block) : [...collapsed, block]);
  const allClosed = MASS_SECTIONS.every((s) => collapsed.includes(s.block));
  const filledTotal = MASS_SLOTS.filter((slot) => indexOfSlot(items, slot.id) >= 0).length;

  const slotRow = (slot: MassSlot) => {
    const index = indexOfSlot(items, slot.id);
    const row = index >= 0 ? items[index] : null;
    const open = picking === slot.id;
    const over = overSlot === slot.id;
    const staged = row !== null && index === activeIndex;
    return (
      <li
        key={slot.id}
        className="relative"
        onDragOver={(e) => {
          if (!dragRef.current) return;
          e.preventDefault();
          setOverSlot(slot.id);
        }}
        onDragLeave={() => setOverSlot((current) => (current === slot.id ? null : current))}
        onDrop={(e) => {
          e.preventDefault();
          setOverSlot(null);
          setPicking(null);
          onDropOnSlot(slot.id);
        }}
      >
        <div
          draggable={row !== null}
          onDragStart={() => {
            if (row) dragRef.current = { kind: 'plan', index };
          }}
          onDragEnd={() => {
            dragRef.current = null;
            setOverSlot(null);
          }}
          data-slot={slot.id}
          data-filled={row !== null || undefined}
          data-staged={staged || undefined}
          aria-current={staged ? 'true' : undefined}
          className={`group flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
            over ? 'border-accent bg-accent/10' : staged ? 'border-accent bg-accent/10 ring-1 ring-accent' : row ? (row.stale ? 'border-danger/40 bg-danger/5' : 'border-line bg-panel-2 hover:border-fg/25') : 'border-dashed border-fg/20 hover:border-fg/40'
          }`}
        >
          <span
            aria-hidden
            className={`grid size-8 shrink-0 place-items-center rounded-full font-mono text-xs font-bold ${row ? 'bg-accent text-on-accent' : 'bg-panel-2 text-muted'}`}
          >
            {slot.number}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold tracking-wider text-accent uppercase">
                <span className="sr-only">{t('sectionProgress', { done: slot.number, total: MASS_SLOTS.length })} </span>
                {slot.name}
              </span>
              {row?.stale && <AlertTriangle size={13} className="text-danger" aria-label={t('stale')} />}
            </div>
            {row ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className={`min-w-0 truncate text-sm font-semibold ${row.stale ? 'text-fg/50 line-through' : 'text-fg'}`}>{row.label}</span>
                {row.stale && <span className="shrink-0 text-[11px] text-danger">{row.deleted ? t('deletedHymnStatus') : t('stale')}</span>}
              </div>
            ) : (
              over ? (
                <span className="block truncate text-xs text-accent">{t('slotDropWillReplace')}</span>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t('quickSelect', { slot: slot.name })}>
                  {[...responseChoices(slot, lang).map((c) => ({ ...c, icon: 'text' as const })), ...(suggestions[slot.id] ?? []).map((c) => ({ ...c, icon: 'song' as const }))].map((choice) => (
                    <button
                      key={`${choice.module}-${choice.sourceId}`}
                      type="button"
                      onClick={() => onFill(slot.id, choice)}
                      title={choice.label}
                      aria-label={t('quickAdd', { item: choice.label, slot: slot.name })}
                      className="inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-full border border-fg/20 bg-panel px-2.5 text-xs font-semibold text-fg/85 transition hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    >
                      {choice.icon === 'song' ? <Music size={12} className="shrink-0 text-ok" aria-hidden /> : <FileText size={12} className="shrink-0 text-muted" aria-hidden />}
                      <span className="truncate">{choice.label}</span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          {row ? (
            <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setPicking(open ? null : slot.id)}
                aria-label={t('slotChangeLabel', { slot: slot.name })}
                aria-expanded={open}
                title={t('slotChange')}
                className="grid size-7 place-items-center rounded text-muted hover:text-accent"
              >
                <Pencil size={13} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onStage(index)}
                disabled={!canStageRow(row)}
                aria-label={t('stage')}
                aria-pressed={staged}
                title={t('stage')}
                className={`grid size-7 place-items-center rounded hover:text-accent disabled:opacity-30 ${staged ? 'bg-accent text-on-accent hover:text-on-accent' : 'text-muted'}`}
              >
                <Play size={13} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onClear(slot.id)}
                aria-label={t('slotClear', { slot: slot.name })}
                title={t('slotClear', { slot: slot.name })}
                className="grid size-7 place-items-center rounded text-muted hover:text-danger"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(open ? null : slot.id)}
              aria-expanded={open}
              aria-label={`${t(slot.kind === 'song' ? 'slotAddHymn' : 'slotAddItem')}: ${slot.name}`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-fg/20 bg-panel px-3 text-[11px] font-bold tracking-wide text-fg/85 uppercase transition hover:border-accent hover:text-accent"
            >
              <Plus size={13} aria-hidden />
              {t(slot.kind === 'song' ? 'slotAddHymn' : 'slotAddItem').replace(/^\+\s*/, '')}
            </button>
          )}
        </div>
        {open && (
          <MassItemSelect
            slot={slot}
            lang={lang}
            t={t}
            onClose={() => setPicking(null)}
            onPick={(item) => {
              setPicking(null);
              onFill(slot.id, item);
            }}
          />
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p role="status" className="text-xs text-fg/60">
          <span className="font-mono font-bold text-accent tabular-nums">{filledTotal}</span> / {MASS_SLOTS.length}
        </p>
        <button
          type="button"
          onClick={() => setClosed(allClosed ? [] : MASS_SECTIONS.map((s) => s.block))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-fg/15 px-2.5 text-[11px] font-bold tracking-wide text-fg/80 uppercase transition hover:border-accent hover:text-accent"
        >
          {allClosed ? <ChevronsUpDown size={13} aria-hidden /> : <ChevronsDownUp size={13} aria-hidden />}
          {allClosed ? t('sectionsExpandAll') : t('sectionsCollapseAll')}
        </button>
      </div>

      {MASS_SECTIONS.map((section) => {
        const closed = collapsed.includes(section.block);
        const { filled, total } = filledIn(items, section.block);
        const extras = additionalIn(items, section.block);
        const rows = extras.map((i) => items[i]);
        // A drop at the end of a section goes after all of its rows, the slots' items included.
        const blockCount = items.filter((it) => it.block === section.block).length;
        const name = t(`block_${section.block}`);
        const panelId = `holy-mass-${section.block}`;
        return (
          <section key={section.block} aria-labelledby={`${panelId}-title`} className="rounded-[10px] border border-line bg-panel p-4">
            <h2 id={`${panelId}-title`} className="flex">
              <button
                type="button"
                aria-expanded={!closed}
                aria-controls={panelId}
                aria-label={t(closed ? 'sectionExpand' : 'sectionCollapse', { name })}
                onClick={() => toggle(section.block)}
                className="flex w-full items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                {closed ? <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden /> : <ChevronDown size={18} className="shrink-0 text-muted" aria-hidden />}
                <span className="text-lg font-bold tracking-tight text-fg uppercase">
                  {section.number}. {name}
                </span>
                <span
                  className={`ml-auto rounded-full border px-2 py-px font-mono text-[11px] font-bold tabular-nums ${
                    filled === total ? 'border-ok/50 bg-ok/10 text-ok' : 'border-fg/15 bg-fg/10 text-fg/70'
                  }`}
                >
                  {t('sectionProgress', { done: filled, total })}
                </span>
              </button>
            </h2>

            {!closed && (
              <div id={panelId} className="mt-3 flex flex-col gap-2">
                <ol className="flex flex-col gap-2">{slotsOfBlock(section.block).map(slotRow)}</ol>

                {(rows.length > 0 || drop?.block === section.block) && (
                  <div className="mt-1 border-t border-line pt-2">
                    <p className="px-1 text-[11px] font-semibold tracking-wider text-fg/60 uppercase">{t('additionalItems')}</p>
                    <ol className="flex flex-col">
                      {rows.map((row, slot) => renderAdditional(row, rows, slot, section.block))}
                    </ol>
                  </div>
                )}

                <div
                  onDragOver={(e) => {
                    if (!dragRef.current) return;
                    e.preventDefault();
                    setDrop({ block: section.block, slot: blockCount });
                  }}
                  onDragLeave={() => drop?.block === section.block && setDrop(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    onDropInSection(section.block, blockCount);
                  }}
                  className={`grid place-items-center rounded-md border border-dashed text-[11px] transition ${
                    drop?.block === section.block ? 'min-h-10 border-accent bg-accent/5 text-accent' : 'min-h-2 border-transparent text-transparent'
                  }`}
                >
                  {drop?.block === section.block ? t('additionalDrop') : null}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
