import { Play, Presentation, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { QueueItem } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { usePlannerT } from './strings';
import { syncQueueIfLoaded } from './plan-api';
import { BLOCKS } from './types';
import { playQueueAt, stepQueue } from './routing';

/** The badge on each card: a short label and a colour, so the kind of item reads at a glance. */
const MODULE_BADGE: Record<QueueItem['module'], { label: string; tone: string }> = {
  bible: { label: 'BIBLE', tone: 'border-info/40 bg-info/15 text-info' },
  notes: { label: 'PRAYER', tone: 'border-violet-500/40 bg-violet-500/15 text-violet-300' },
  lyrics: { label: 'SONG', tone: 'border-ok/40 bg-ok/15 text-ok' },
  lectionary: { label: 'LECTIONARY', tone: 'border-danger/40 bg-danger/15 text-danger' },
  announcements: { label: 'ANNOUNCEMENT', tone: 'border-warn/40 bg-warn/15 text-warn' },
  media: { label: 'MEDIA', tone: 'border-ok/40 bg-ok/15 text-ok' },
  mass_order: { label: 'MASS', tone: 'border-fg/30 bg-fg/10 text-fg/80' },
  custom: { label: 'NOTE', tone: 'border-fg/25 bg-fg/[0.08] text-fg/80' },
};

/** Notes are operator reminders: they have nothing to stage, so they can only be removed. */
const CANNOT_STAGE = new Set<QueueItem['module']>(['custom']);
/** Modules that can go live from the queue. Songs take their first stanza themselves; announcements and media open their own view. */
const CAN_TAKE_LIVE = new Set<QueueItem['module']>(['bible', 'lectionary', 'mass_order', 'notes', 'lyrics']);

const NAV = 'flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-fg/20 bg-panel-2 px-3 text-sm font-semibold text-fg/90 transition hover:border-fg/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const ICON = 'grid size-8 shrink-0 place-items-center rounded-md border border-fg/20 bg-panel text-fg/80 transition hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30';

/** The Mass Queue body: the loaded plan in Mass order, with Previous and Next and per-item actions. */
export function ServiceQueue({ items }: { items: QueueItem[] }) {
  const t = usePlannerT();
  const cursor = useLive((s) => s.state.queueCursor);
  // Null when no queue item is selected. Only the selected item shows the CURRENT badge.
  const currentIndex = cursor < 0 ? null : cursor;
  const planId = useLive((s) => s.state.queuePlanId);
  // The queue's item is on the screen when the output is running and its last take came from the queue.
  // Read from the store, so it follows the projector without comparing frames.
  const onAir = useLive(
    (s) => s.state.outputs.projector && s.state.projector.source === 'MASS_QUEUE' && s.state.projector.live.kind !== 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  // The current row scrolls into view when the cursor moves, whether from Next, Previous or a row.
  const currentRow = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    currentRow.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [cursor]);
  if (items.length === 0) return <p className="p-5 text-sm text-fg/60">{t('queueEmpty')}</p>;

  /** Puts an item live: it moves the CURRENT badge there, and the projector and preview show it. */
  const takeLive = async (index: number) => {
    setError(null);
    try {
      await playQueueAt(index);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Takes the item out of the loaded plan. The library item is kept. */
  const remove = async (index: number) => {
    if (planId == null) return;
    setError(null);
    try {
      const plan = await bridge.plans.get(planId);
      await bridge.plans.save(planId, plan.items.filter((_, i) => i !== index));
      const saved = await bridge.plans.get(planId);
      syncQueueIfLoaded(planId, saved.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3">
        <button type="button" onClick={() => void stepQueue(-1)} disabled={currentIndex === 0} className={NAV}>
          {t('queuePrev')}
        </button>
        <button
          type="button"
          onClick={() => void stepQueue(1)}
          disabled={items.length === 0 || (currentIndex !== null && currentIndex >= items.length - 1)}
          className={NAV}
        >
          {t('queueNext')}
        </button>
      </div>
      <p className="shrink-0 px-4 pt-2 text-[11px] font-medium text-fg/50">Ctrl ↑ / Ctrl ↓ to step</p>

      {error && (
        <p role="alert" className="mx-3 mt-3 rounded-md border border-danger/40 bg-panel px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        {BLOCKS.map((block) => {
          const rows = items.filter((item) => item.block === block.id);
          if (rows.length === 0) return null;
          return (
            <section key={block.id} aria-label={t(block.titleKey)}>
              <h3 className="my-2 px-1 text-xs font-bold tracking-widest text-accent/80 uppercase">{t(block.titleKey)}</h3>
              <ol className="flex flex-col gap-2">
                {rows.map((item) => {
                  const index = items.indexOf(item);
                  const current = currentIndex !== null && index === currentIndex;
                  const badge = MODULE_BADGE[item.module];
                  const stageable = !item.stale && !CANNOT_STAGE.has(item.module);
                  const takeable = stageable && CAN_TAKE_LIVE.has(item.module);
                  const live = onAir && current;
                  return (
                    <li
                      key={item.id}
                      ref={current ? currentRow : undefined}
                      aria-current={current ? 'true' : undefined}
                      // Clicking the row puts it live. The buttons stop their clicks from reaching the row.
                      onClick={takeable ? () => void takeLive(index) : undefined}
                      className={`flex items-center gap-2.5 rounded-lg border p-2.5 shadow-sm transition-colors ${
                        current
                          ? 'border-accent bg-accent/10 shadow-md shadow-black/30'
                          : 'border-line bg-panel-2/90 hover:border-fg/20'
                      } ${takeable ? 'cursor-pointer' : ''}`}
                    >
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider ${badge.tone}`}>{badge.label}</span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span
                          title={item.label}
                          className={`max-w-[180px] truncate text-sm font-semibold ${item.stale ? 'text-fg/50 line-through' : 'text-fg'}`}
                        >
                          {item.label}
                        </span>
                        {item.stale && <span className="text-[11px] text-danger">{t('queueMissing')}</span>}
                      </div>
                      {current && (
                        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-black tracking-wider text-on-accent uppercase">CURRENT</span>
                      )}
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            // Going live never closes the Mass Queue drawer, and does not run the row's own click.
                            e.stopPropagation();
                            void takeLive(index);
                          }}
                          disabled={!takeable}
                          aria-label="Go Live"
                          aria-pressed={live}
                          title={takeable ? 'Go Live' : 'Open in its module to take live'}
                          className={live ? `${ICON} border-accent bg-accent text-on-accent shadow-md shadow-black/50 hover:text-on-accent` : ICON}
                        >
                          <Play size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void takeLive(index);
                          }}
                          disabled={!takeable}
                          aria-label="Project item live"
                          title={takeable ? 'Project item live' : 'Open in its module to take live'}
                          className={live ? `${ICON} border-accent bg-accent text-on-accent shadow-md shadow-black/50 hover:text-on-accent` : ICON}
                        >
                          <Presentation size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(index);
                          }}
                          disabled={planId == null}
                          aria-label="Remove from queue"
                          title="Remove from queue"
                          className={`${ICON} hover:border-danger/60 hover:text-danger`}
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
