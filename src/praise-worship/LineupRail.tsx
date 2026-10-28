import { useRef, useState, type DragEvent } from 'react';
import { BookOpen, Cross, GripVertical, Music } from 'lucide-react';
import { groupMinutes, moveSegment, nudgeSegment, segmentStatus, type PwSegment, type PwStatus } from '../../shared/pw.js';
import { songDrop } from '../../shared/pw-drop.js';
import { exchangeSlots, itemOf } from '../../shared/pw-slots.js';
import { commitSegments, setPwState, updateSegment, usePw } from './store';
import { usePwT, type PwT } from './strings';

export const TYPE_ICON = { prayer: Cross, song: Music, scripture: BookOpen } as const;

/** Status colours, from the theme. Ready is the ok tone, gaps use the accent, deleted content the danger tone. */
export const STATUS_TONE: Record<PwStatus, string> = {
  ready: 'text-emerald-400',
  auto: 'text-muted',
  needs_song: 'text-accent',
  needs_prayer: 'text-accent',
  missing: 'text-danger',
};

/** The second line of a row: what is assigned, or a prompt to assign it. */
export function assignedLabel(segment: PwSegment, t: PwT, names: { hymn: (id: number) => string | undefined; prayer: (id: number) => string | undefined }) {
  const c = segment.content;
  if (c.kind === 'song') return c.hymnIds.length ? c.hymnIds.map((id) => names.hymn(id) ?? '…').join(' · ') : t('selectSong');
  if (c.kind === 'prayer') return c.noteId != null ? names.prayer(c.noteId) ?? '…' : t('selectPrayer');
  if (c.kind === 'lectionary') return `${c.readingType} · ${t('fromLectionary')}`;
  return t('titleSlide');
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function LineupRail() {
  const t = usePwT();
  const session = usePw((s) => s.session)!;
  const selected = usePw((s) => s.selected);
  const hymns = usePw((s) => s.hymns);
  const prayers = usePw((s) => s.prayers);
  const [drag, setDrag] = useState<{ from: number; group: string; slot: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const songDrag = usePw((s) => s.songDrag);
  const slotDrag = usePw((s) => s.slotDrag);
  const grips = useRef<(HTMLButtonElement | null)[]>([]);
  const { segments, groups } = session;
  const names = { hymn: (id: number) => hymns[id]?.title, prayer: (id: number) => prayers.find((p) => p.id === id)?.title };

  const groupName = (key: string) => groups.find((g) => g.key === key)?.name ?? key;

  /** A song dragged from the Song List lands in the slot at `index`. A refused drop changes nothing and says why. */
  const dropSong = (index: number) => {
    const hymnId = usePw.getState().songDrag;
    setPwState({ songDrag: null });
    if (hymnId == null) return;
    const result = songDrop(segments[index], hymnId);
    if ('refused' in result) {
      if (result.refused === 'type') setRefused(t('wrongType', { type: t('type_song').toLowerCase() }));
      else if (result.refused === 'full') setRefused(t('full'));
      return;
    }
    setRefused(null);
    updateSegment(index, result.patch);
    setPwState({ replacing: null, selected: index });
    setAnnounce(t('addsTo', { n: pad2(index + 1) }));
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

  let index = -1;
  return (
    <section aria-labelledby="pw-lineup-heading" className="flex min-w-0 flex-col rounded-2xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-md shadow-xl shadow-black/40 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2 id="pw-lineup-heading" className="text-lg font-bold">{t('lineup')}</h2>
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
              <h3 className="eyebrow !text-accent">{group.name}</h3>
              <span className="font-mono text-xs text-muted">{groupMinutes(segments, group.key)} {t('minutes')}</span>
            </div>
            <ol className="flex min-h-11 flex-col gap-1">
              {rows.map((segment, slot) => {
                index += 1;
                const i = index;
                const status = segmentStatus(segment);
                const Icon = TYPE_ICON[segment.type];
                const active = i === selected;
                const dropBefore = drag && drag.group === group.key && drag.slot === slot && drag.from !== i;
                const dropAfter = drag && drag.group === group.key && drag.slot === rows.length && slot === rows.length - 1;
                // While a song is dragged from the Song List: the slots it can go into are outlined, the rest fade.
                const songTakes = songDrag != null && 'patch' in songDrop(segment, songDrag);
                const songBlocked = songDrag != null && !songTakes;
                // While an item is dragged within the lineup: the slots it can swap or move into are outlined, the rest fade.
                const slotTakes = slotDrag != null && slotDrag !== i && 'segments' in exchangeSlots(segments, slotDrag, i);
                const slotBlocked = slotDrag != null && slotDrag !== i && !slotTakes;
                return (
                  <li
                    key={`${segment.key}-${i}`}
                    onDragOver={(e) => {
                      if (slotDrag != null) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        return;
                      }
                      if (songDrag != null) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        return;
                      }
                      overRow(e, group.key, slot);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (slotDrag != null) dropSlot(i);
                      else if (songDrag != null) dropSong(i);
                      else drop();
                    }}
                    className={`relative flex items-center rounded-xl border transition ${
                      active ? 'border-accent bg-panel-2' : 'border-transparent hover:bg-panel-2'
                    } ${drag?.from === i ? 'opacity-50' : ''} ${songTakes || slotTakes ? 'border-ok' : ''} ${songBlocked || slotBlocked ? 'opacity-50' : ''}`}
                  >
                    {dropBefore && <span aria-hidden className="absolute inset-x-2 -top-1 h-0.5 rounded bg-accent" />}
                    {dropAfter && <span aria-hidden className="absolute inset-x-2 -bottom-1 h-0.5 rounded bg-accent" />}
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
                      aria-current={active ? 'true' : undefined}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-r-xl py-2 pr-3 text-left"
                    >
                      <span className="w-6 shrink-0 font-mono text-sm text-muted">{pad2(i + 1)}</span>
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-accent">
                        <Icon size={16} aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[15px] leading-tight font-semibold text-zinc-200">{segment.name}</span>
                        <span className="truncate text-xs text-muted">{assignedLabel(segment, t, names)}</span>
                      </span>
                      {/* Capped and wrapping, so a long translated status never runs over the segment name. */}
                      <span className="flex max-w-[6.5rem] shrink-0 flex-col items-end gap-0.5 text-right">
                        <span className={`text-xs leading-tight font-semibold ${STATUS_TONE[status]}`}>{t(`status_${status}`)}</span>
                        <span className="font-mono text-xs text-muted">{segment.minutes} {t('minutes')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      <p className="mt-4 px-1 text-xs leading-relaxed text-muted">{t('lineupHint')}</p>
    </section>
  );
}
