import { useRef, useState, type DragEvent } from 'react';
import { BookOpen, Cross, GripVertical, Music } from 'lucide-react';
import { groupMinutes, moveSegment, nudgeSegment, segmentStatus, type PwSegment, type PwStatus } from '../../shared/pw.js';
import { commitSegments, setPwState, usePw } from './store';
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
  const grips = useRef<(HTMLButtonElement | null)[]>([]);
  const { segments, groups } = session;
  const names = { hymn: (id: number) => hymns[id]?.title, prayer: (id: number) => prayers.find((p) => p.id === id)?.title };

  const groupName = (key: string) => groups.find((g) => g.key === key)?.name ?? key;

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
    <section aria-labelledby="pw-lineup-heading" className="flex min-w-0 flex-col rounded-2xl border border-line bg-panel p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2 id="pw-lineup-heading" className="text-lg font-bold">{t('lineup')}</h2>
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>

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
              <h3 className="text-xs font-extrabold tracking-[0.18em] text-accent uppercase">{group.name}</h3>
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
                return (
                  <li
                    key={`${segment.key}-${i}`}
                    onDragOver={(e) => overRow(e, group.key, slot)}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      drop();
                    }}
                    className={`relative flex items-center rounded-xl border transition ${
                      active ? 'border-accent bg-panel-2' : 'border-transparent hover:bg-panel-2'
                    } ${drag?.from === i ? 'opacity-50' : ''}`}
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
                      onClick={() => setPwState({ selected: i, replacing: null })}
                      aria-current={active ? 'true' : undefined}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-r-xl py-2 pr-3 text-left"
                    >
                      <span className="w-6 shrink-0 font-mono text-sm text-muted">{pad2(i + 1)}</span>
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-accent">
                        <Icon size={16} aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[15px] leading-tight font-semibold">{segment.name}</span>
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
