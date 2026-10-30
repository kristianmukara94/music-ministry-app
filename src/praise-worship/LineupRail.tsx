import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Cross, FileText, GripVertical, Music, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  chainOf,
  groupMinutes,
  MAX_CHAIN,
  MAX_SEGMENTS,
  moveSegment,
  nudgeSegment,
  PW_TYPES,
  runtimeOf,
  segmentStatus,
  primaryOf,
  reorderChainItem,
  reorderSong,
  removeChainItem,
  removeSong,
  songsOf,
  withChain,
  type PwChainItem,
  type PwSegment,
  type PwStatus,
  type PwType,
} from '../../shared/pw.js';
import { attachItems, describeAttach, parseDrag, type LibraryDragBatch } from '../../shared/pw-attach.js';
import { exchangeSlots, itemOf } from '../../shared/pw-slots.js';
import { addCard, commitSegments, removeCard, setPwState, updateSegment, usePw } from './store';
import { usePwT, type PwT } from './strings';

export const TYPE_ICON = { prayer: Cross, song: Music, scripture: BookOpen } as const;

/** Status colours, from the theme. Ready is the ok tone, gaps use the accent, deleted content the danger tone. */
export const STATUS_TONE: Record<PwStatus, string> = {
  ready: 'text-ok',
  auto: 'text-muted',
  needs_song: 'text-accent',
  needs_prayer: 'text-accent',
  missing: 'text-danger',
};

/** The most minutes one chained item takes. Matches the server's limit for a segment. */
const MAX_ITEM_MINUTES = 240;

/** How long a remove waits for its confirming second click before it disarms. */
const REMOVE_ARM_MS = 4000;

/** The second line of a row: what is assigned, or a prompt to assign it. */
export function assignedLabel(segment: PwSegment, t: PwT, names: { hymn: (id: number) => string | undefined; prayer: (id: number) => string | undefined }) {
  const c = segment.content;
  if (c.kind === 'song') return c.hymnIds.length ? c.hymnIds.map((id) => names.hymn(id) ?? '…').join(' · ') : t('selectSong');
  if (c.kind === 'prayer') return c.noteId != null ? names.prayer(c.noteId) ?? '…' : t('selectPrayer');
  if (c.kind === 'lectionary') return `${c.readingType} · ${t('fromLectionary')}`;
  return t('titleSlide');
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** One row of a card's nested list: a song, or an item chained after the card's first. Minutes show only where `onMinutes` is given. */
interface SubItem {
  key: string;
  /** Songs and chained items are separate runs: an item moves only within its own run. */
  group: 'song' | 'chain';
  icon: ReactNode;
  label: string;
  minutes?: number;
}

/**
 * The row being dragged inside a nested list. Module-level, since only one drag runs at a time. A row takes a drop only from the
 * same card's list and of the same kind, so a song row never lands in a chain and one card's list never lands in another.
 */
let subDrag: { cardKey: string; kind: 'song' | 'chain'; from: number } | null = null;

/** The nested list inside a multi-item card: each item with its handle, its place, its up and down buttons and its own remove. */
function SubList({
  title,
  cardKey,
  items,
  t,
  onMove,
  onReorder,
  onRemove,
  onMinutes,
}: {
  title: string;
  cardKey: string;
  items: SubItem[];
  t: PwT;
  onMove: (index: number, delta: 1 | -1) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onMinutes?: (index: number, minutes: number) => void;
}) {
  const [over, setOver] = useState<number | null>(null);
  const accepts = (group: 'song' | 'chain') => subDrag !== null && subDrag.cardKey === cardKey && subDrag.kind === group;

  return (
    <div className="mb-2 ml-14 mr-2 border-l border-fg/15 pl-3">
      <p className="px-1 pb-1 text-xs text-muted">{title}</p>
      <ol className="flex flex-col gap-1">
        {items.map((item, n) => (
          <li
            key={item.key}
            draggable
            onDragStart={(e) => {
              subDrag = { cardKey, kind: item.group, from: n };
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('application/json', JSON.stringify({ sourceSegmentKey: cardKey, sourceIndex: n, itemType: item.group }));
              e.stopPropagation();
            }}
            onDragEnd={() => {
              subDrag = null;
              setOver(null);
            }}
            onDragEnter={(e) => {
              if (!accepts(item.group)) return;
              e.preventDefault();
              e.stopPropagation();
              setOver(n);
            }}
            onDragOver={(e) => {
              if (!accepts(item.group)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((now) => (now === n ? null : now));
            }}
            onDrop={(e) => {
              if (!accepts(item.group)) return;
              e.preventDefault();
              e.stopPropagation();
              const from = subDrag!.from;
              subDrag = null;
              setOver(null);
              if (from !== n) onReorder(from, n);
            }}
            className={`flex cursor-grab items-center gap-1.5 rounded-lg border-t-2 bg-panel-2/60 py-1 pl-1 pr-1 transition-all active:cursor-grabbing hover:bg-fg/10 ${
              over === n ? 'border-accent bg-accent/10' : 'border-transparent'
            }`}
          >
            <span className="grid h-9 w-5 shrink-0 place-items-center text-muted" aria-hidden>
              <GripVertical size={14} />
            </span>
            <span className="w-4 shrink-0 text-right font-mono text-xs text-muted">{n + 1}</span>
            <span className="shrink-0 text-accent">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
            {onMinutes && item.minutes !== undefined && (
              <input
                type="number"
                min={0}
                max={MAX_ITEM_MINUTES}
                value={item.minutes}
                aria-label={t('chainMinutes', { title: item.label })}
                onChange={(e) => onMinutes(n, Math.min(MAX_ITEM_MINUTES, Math.max(0, Math.trunc(Number(e.target.value)) || 0)))}
                className="h-9 w-16 rounded-lg border border-fg/15 bg-panel px-2 text-right font-mono text-sm"
              />
            )}
            <button
              type="button"
              disabled={n === 0 || items[n - 1].group !== item.group}
              onClick={() => onMove(n, -1)}
              aria-label={t('chainMoveUp', { title: item.label })}
              className="grid size-9 place-items-center rounded-lg text-muted hover:text-fg disabled:opacity-30"
            >
              <ArrowUp size={14} aria-hidden />
            </button>
            <button
              type="button"
              disabled={n === items.length - 1 || items[n + 1].group !== item.group}
              onClick={() => onMove(n, 1)}
              aria-label={t('chainMoveDown', { title: item.label })}
              className="grid size-9 place-items-center rounded-lg text-muted hover:text-fg disabled:opacity-30"
            >
              <ArrowDown size={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onRemove(n)}
              aria-label={t('chainRemove', { title: item.label })}
              className="grid size-9 place-items-center rounded-lg text-muted hover:text-danger"
            >
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LineupRail() {
  const t = usePwT();
  const session = usePw((s) => s.session)!;
  const selected = usePw((s) => s.selected);
  const hymns = usePw((s) => s.hymns);
  const prayers = usePw((s) => s.prayers);
  const [drag, setDrag] = useState<{ from: number; group: string; slot: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Set when a rename is cancelled, so the blur that follows does not save it.
  const skipRename = useRef(false);
  // The card whose remove is waiting for its second click, by key.
  const [armed, setArmed] = useState<string | null>(null);
  const [newType, setNewType] = useState<PwType>('prayer');
  const libDrag = usePw((s) => s.libDrag);
  // The one card a Library drag is over, by key, so only that card shows where the items will land.
  const [dragOverSegmentKey, setDragOverSegmentKey] = useState<string | null>(null);
  const slotDrag = usePw((s) => s.slotDrag);
  const grips = useRef<(HTMLButtonElement | null)[]>([]);
  const { segments, groups } = session;
  const names = { hymn: (id: number) => hymns[id]?.title, prayer: (id: number) => prayers.find((p) => p.id === id)?.title };

  const groupName = (key: string) => groups.find((g) => g.key === key)?.name ?? key;

  // A drag that ends (dropped anywhere, or cancelled) clears the highlight.
  useEffect(() => {
    if (libDrag == null) setDragOverSegmentKey(null);
  }, [libDrag]);

  // The armed remove disarms by itself, so a stray click later does not remove a card.
  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), REMOVE_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  /** Library items dragged onto the card at `index` are attached to it together, in the order they were dragged. */
  const dropLibrary = (index: number, data: DataTransfer) => {
    // The drag carries its items as JSON; the store's copy covers a drag whose data the browser withheld.
    const batch: LibraryDragBatch | null = parseDrag(data.getData('application/json')) ?? usePw.getState().libDrag;
    setPwState({ libDrag: null });
    setDragOverSegmentKey(null);
    if (!batch) return;
    const segment = segments[index];
    const result = attachItems(segment, batch);
    // Nothing attached: every item was a repeat (nothing to say), or the card was full.
    if (result.segment === segment) {
      if (result.left > 0) setRefused(batch.type === 'song' ? t('full') : t('chainFull', { n: MAX_CHAIN }));
      return;
    }
    setRefused(null);
    updateSegment(index, { content: result.segment.content });
    setPwState({ replacing: null, selected: index });
    setAnnounce(describeAttach(segment.name, batch.type, result));
  };

  const nudge = (index: number, delta: 1 | -1) => {
    const result = nudgeSegment(segments, groups, index, delta);
    if (result.index === index && result.segments[index]?.group === segments[index].group) return;
    const moved = result.segments[result.index];
    // The selection follows the row being moved, wherever it was.
    const sel = segments[selected] === segments[index] ? result.index : result.segments.indexOf(segments[selected]);
    commitSegments(result.segments, sel < 0 ? result.index : sel);
    setAnnounce(t('moved', { name: moved.name, n: result.index + 1, group: groupName(moved.group) }));
    // Focus stays on the moved row's grip, so the arrow keys keep moving it.
    requestAnimationFrame(() => grips.current[result.index]?.focus());
  };

  /** An item dragged from one slot onto another of its type: swapped, or moved into an empty slot. A refused drop changes nothing. */
  const dropSlot = (to: number) => {
    const from = usePw.getState().slotDrag;
    setPwState({ slotDrag: null });
    if (from == null) return;
    const result = exchangeSlots(segments, from, to);
    if ('refused' in result) {
      if (result.refused === 'limit') setRefused(t('full'));
      else if (result.refused !== 'empty') setRefused(t('wrongType', { type: t(`type_${result.refused === 'segment4' ? 'song' : segments[from].type}`).toLowerCase() }));
      return;
    }
    setRefused(null);
    commitSegments(result.segments, to);
  };

  const drop = () => {
    if (!drag) return;
    const next = moveSegment(segments, groups, drag.from, drag.group, drag.slot);
    const sel = next.findIndex((s) => s.key === segments[selected]?.key);
    commitSegments(next, sel < 0 ? 0 : sel);
    setDrag(null);
  };

  /** Over a row: drop before it or after it, depending on which half the pointer is in. */
  const overRow = (e: DragEvent, group: string, slot: number) => {
    if (!drag) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const target = after ? slot + 1 : slot;
    if (drag.group !== group || drag.slot !== target) setDrag({ ...drag, group, slot: target });
  };

  const startRename = (segment: PwSegment) => {
    setArmed(null);
    setDraft(segment.name);
    setRenaming(segment.key);
  };

  /** Saves a rename. An empty name keeps the old one. Runs once per rename, whether it ends by Enter or by leaving the field. */
  const finishRename = (index: number, segment: PwSegment, value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (name && name !== segment.name) updateSegment(index, { name });
  };

  const chainItemLabel = (item: PwChainItem) => (item.kind === 'prayer' ? names.prayer(item.noteId) ?? '…' : item.readingType);

  let index = -1;
  return (
    <section aria-labelledby="pw-lineup-heading" className="flex min-w-0 flex-col rounded-[10px] border border-line bg-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 id="pw-lineup-heading" className="text-lg font-bold tracking-tight text-fg">{t('lineup')}</h2>
        <span className="rounded-full bg-fg/10 px-2 py-px font-mono text-[11px] font-bold text-fg/70 tabular-nums">{segments.length}</span>
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
      {refused && <p role="alert" className="mb-2 px-1 text-sm text-danger">{refused}</p>}

      {groups.map((group) => {
        const rows = segments.filter((s) => s.group === group.key);
        return (
          <div
            key={group.key}
            className="mt-3 first:mt-0"
            onDragOver={(e) => {
              // An empty group, or the space under its last row, takes a drop at its end.
              if (drag && e.target === e.currentTarget) {
                e.preventDefault();
                if (drag.group !== group.key || drag.slot !== rows.length) setDrag({ ...drag, group: group.key, slot: rows.length });
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop();
            }}
          >
            <div className="flex items-baseline justify-between px-1 pb-1.5">
              <h3 className="text-[11px] font-semibold tracking-wider text-accent uppercase">{group.name}</h3>
              <span className="font-mono text-xs text-muted">{groupMinutes(segments, group.key)} {t('minutes')}</span>
            </div>
            <ol className="flex min-h-11 flex-col gap-1">
              {rows.map((segment, slot) => {
                index += 1;
                const i = index;
                const status = segmentStatus(segment);
                const Icon = TYPE_ICON[segment.type];
                const active = i === selected;
                const chain = chainOf(segment);
                // A card with more than one song lists them one by one; a single song keeps the plain card.
                const songs = songsOf(segment);
                const dropBefore = drag && drag.group === group.key && drag.slot === slot && drag.from !== i;
                const dropAfter = drag && drag.group === group.key && drag.slot === rows.length && slot === rows.length - 1;
                // While a Library item is dragged: the cards it can attach to are outlined, the rest fade.
                const libTakes = libDrag != null && attachItems(segment, libDrag).segment !== segment;
                const libBlocked = libDrag != null && !libTakes;
                const dropHere = dragOverSegmentKey === segment.key;
                // While an item is dragged within the lineup: the slots it can swap or move into are outlined, the rest fade.
                const slotTakes = slotDrag != null && slotDrag !== i && 'segments' in exchangeSlots(segments, slotDrag, i);
                const slotBlocked = slotDrag != null && slotDrag !== i && !slotTakes;
                // The chain's edits all write the card's content, so they go through one place.
                const setChain = (more: PwChainItem[]) => updateSegment(i, withChain(segment, more));
                // Each edit saves at once through updateSegment. A move or removal that does not apply changes nothing.
                const patch = (changes: Partial<PwSegment> | null) => changes && updateSegment(i, changes);
                // A card's first item (a prayer or a reading) counts with its songs and chain in the total.
                const primaryCount = primaryOf(segment) ? 1 : 0;
                const items: SubItem[] = [
                  ...songs.map((id) => ({ key: `song-${id}`, group: 'song' as const, icon: <Music size={14} aria-hidden />, label: names.hymn(id) ?? '…' })),
                  ...chain.map((item, n) => ({
                    key: `${item.kind}-${n}`,
                    group: 'chain' as const,
                    icon: item.kind === 'prayer' ? <FileText size={14} aria-hidden /> : <BookOpen size={14} aria-hidden />,
                    label: chainItemLabel(item),
                    minutes: item.minutes,
                  })),
                ];
                // Positions in `items` map onto the song list or the chain, and a move across the two does nothing.
                const reorder = (from: number, to: number) => {
                  const split = songs.length;
                  if (from < split && to < split) return reorderSong(segment, from, to);
                  if (from >= split && to >= split) return reorderChainItem(segment, from - split, to - split);
                  return null;
                };
                return (
                  <li
                    key={`${segment.key}-${i}`}
                    onDragOver={(e) => {
                      if (slotDrag != null) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        return;
                      }
                      if (libDrag != null) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        setDragOverSegmentKey(segment.key);
                        return;
                      }
                      overRow(e, group.key, slot);
                    }}
                    onDragEnter={() => {
                      if (libDrag != null) setDragOverSegmentKey(segment.key);
                    }}
                    onDragLeave={(e) => {
                      // Moving onto the card's own children also leaves it; only leaving the card clears the highlight.
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverSegmentKey((now) => (now === segment.key ? null : now));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (slotDrag != null) dropSlot(i);
                      else if (libDrag != null) dropLibrary(i, e.dataTransfer);
                      else drop();
                    }}
                    className={`relative rounded-lg border transition-all ${
                      dropHere
                        ? 'border-2 border-accent bg-accent/10 scale-[1.01]'
                        : active
                          ? 'border-accent bg-panel-2'
                          : 'border-transparent hover:bg-fg/10'
                    } ${drag?.from === i ? 'opacity-50' : ''} ${!dropHere && (libTakes || slotTakes) ? 'border-ok' : ''} ${libBlocked || slotBlocked ? 'opacity-50' : ''}`}
                  >
                    {dropBefore && <span aria-hidden className="absolute inset-x-2 -top-1 h-0.5 rounded bg-accent" />}
                    {dropAfter && <span aria-hidden className="absolute inset-x-2 -bottom-1 h-0.5 rounded bg-accent" />}
                    <div className="flex items-center">
                      <button
                        ref={(el) => {
                          grips.current[i] = el;
                        }}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', segment.name);
                          setDrag({ from: i, group: group.key, slot });
                        }}
                        onDragEnd={() => setDrag(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            nudge(i, e.key === 'ArrowUp' ? -1 : 1);
                          }
                        }}
                        aria-label={t('reorder', { name: segment.name })}
                        title={t('lineupHint')}
                        className="grid h-14 w-9 shrink-0 cursor-grab place-items-center rounded-l-xl text-muted hover:text-fg active:cursor-grabbing"
                      >
                        <GripVertical size={16} aria-hidden />
                      </button>
                      {renaming === segment.key ? (
                        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pr-2">
                          <span className="w-6 shrink-0 font-mono text-sm text-muted">{pad2(i + 1)}</span>
                          <input
                            autoFocus
                            aria-label={t('renameCard', { name: segment.name })}
                            value={draft}
                            maxLength={120}
                            onChange={(e) => setDraft(e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => {
                              if (skipRename.current) {
                                skipRename.current = false;
                                setRenaming(null);
                                return;
                              }
                              finishRename(i, segment, draft);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') {
                                skipRename.current = true;
                                e.currentTarget.blur();
                              }
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-fg/15 bg-panel px-2 py-1 text-[15px] font-semibold text-fg/90"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          draggable={itemOf(segment) !== null}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', segment.name);
                            setPwState({ slotDrag: i });
                          }}
                          onDragEnd={() => setPwState({ slotDrag: null })}
                          onClick={() => setPwState({ selected: i, replacing: null })}
                          onDoubleClick={() => startRename(segment)}
                          aria-current={active ? 'true' : undefined}
                          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-r-xl py-2 pr-3 text-left"
                        >
                          <span className="w-6 shrink-0 font-mono text-sm text-muted">{pad2(i + 1)}</span>
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-accent">
                            <Icon size={16} aria-hidden />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-[15px] leading-tight font-semibold text-fg/90">{segment.name}</span>
                            <span className="truncate text-xs text-muted">{items.length + primaryCount > 1 ? t('itemsCount', { n: items.length + primaryCount }) : assignedLabel(segment, t, names)}</span>
                          </span>
                          {/* Capped and wrapping, so a long translated status never runs over the segment name. */}
                          <span className="flex max-w-[6.5rem] shrink-0 flex-col items-end gap-0.5 text-right">
                            <span className={`text-xs leading-tight font-semibold ${STATUS_TONE[status]}`}>{t(`status_${status}`)}</span>
                            {/* The card's runtime: its own minutes plus each chained item's. */}
                            <span className="font-mono text-xs text-muted">{runtimeOf(segment)} {t('minutes')}</span>
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startRename(segment)}
                        aria-label={t('renameCard', { name: segment.name })}
                        title={t('renameCard', { name: segment.name })}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:text-fg"
                      >
                        <Pencil size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (armed !== segment.key) {
                            setArmed(segment.key);
                            return;
                          }
                          setArmed(null);
                          removeCard(i);
                        }}
                        aria-label={armed === segment.key ? t('confirmRemoveCard') : t('removeCard', { name: segment.name })}
                        title={armed === segment.key ? t('confirmRemoveCard') : t('removeCard', { name: segment.name })}
                        className={`mr-1 grid shrink-0 place-items-center rounded-lg text-xs font-semibold ${
                          armed === segment.key ? 'h-9 px-2 bg-danger text-on-accent' : 'size-9 text-muted hover:text-danger'
                        }`}
                      >
                        {armed === segment.key ? t('confirmRemoveCard') : <Trash2 size={14} aria-hidden />}
                      </button>
                    </div>

                    {items.length > 0 && items.length + primaryCount > 1 && (
                      <SubList
                        title={t('chainTitle')}
                        cardKey={segment.key}
                        items={items}
                        t={t}
                        onMove={(n, delta) => patch(reorder(n, n + delta))}
                        onReorder={(from, to) => patch(reorder(from, to))}
                        onRemove={(n) => patch(n < songs.length ? removeSong(segment, songs[n]) : removeChainItem(segment, n - songs.length))}
                        onMinutes={(n, minutes) => setChain(chain.map((x, k) => (k === n - songs.length ? { ...x, minutes } : x)))}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="pw-card-type" className="sr-only">{t('cardType')}</label>
        <select
          id="pw-card-type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as PwType)}
          className="h-11 rounded-lg border border-fg/15 bg-panel px-3 text-sm"
        >
          {PW_TYPES.map((type) => (
            <option key={type} value={type}>{t(`type_${type}`)}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={segments.length >= MAX_SEGMENTS}
          onClick={() => addCard(newType, t('newCardName'))}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-fg/15 px-3 text-sm font-semibold transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={16} aria-hidden />
          {t('addCard')}
        </button>
        {segments.length >= MAX_SEGMENTS && <p className="w-full text-xs text-muted">{t('cardMax', { n: MAX_SEGMENTS })}</p>}
      </div>

      <p className="mt-4 px-1 text-xs leading-relaxed text-muted">{t('lineupHint')}</p>
    </section>
  );
}
