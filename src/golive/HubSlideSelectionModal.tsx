import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, PanelBottom, X } from 'lucide-react';
import { SlidePreview } from '../announcements/TextSlideModal';
import { noteCategoryLabel, noteSourceId } from '../../shared/notes.js';
import { screenPagesOf } from '../../shared/prayer-screen.js';
import { sanitizeTextStyle } from '../../shared/text-style.js';
import { slotById } from '../../shared/mass-slots.js';
import type { FlowRow, MassFlowTarget } from '../../shared/flow-insert.js';
import type { QueueItem } from '../../shared/live.js';
import { insertDeckIntoFlow } from '../planner/plan-api';
import { MassSlotPicker } from '../whiteboard/TargetSlotSelectorModal';
import { errorText } from '../whiteboard/errors';
import type { Note } from '../notes/types';
import { slotOfRow } from './AddSlotNotePrayerModal';
import type { GoLiveT } from './strings';

type Where = 'slot' | 'next' | 'end';

const FIELD = 'w-full rounded-md border border-fg/20 bg-canvas px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none';
const BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 disabled:opacity-40';
const PRIMARY =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#ecc98a] bg-[#ecc98a] px-4 text-sm font-bold text-[#1a1408] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Slide numbers as the operator reads them (1-based), with runs joined: [1, 2, 3, 5] → "2–4, 6".
 */
export function slideRangeLabel(slides: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const k of [...slides].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && k === last[1] + 1) last[1] = k;
    else runs.push([k, k]);
  }
  return runs.map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}–${b + 1}`)).join(', ');
}

/**
 * The plan row for `note` with only `picked` of its `total` slides: its source id names the note and the slides (see noteSourceId in
 * shared/notes.js), and its label says which slides, so the lineup tells it apart from the whole prayer. Every slide picked is the whole note.
 */
export function hubSlideRow(note: Pick<Note, 'id' | 'title'>, picked: readonly number[], total: number, t: GoLiveT): FlowRow {
  const all = picked.length === 0 || picked.length >= total;
  if (all) return { module: 'notes', sourceId: String(note.id), label: note.title };
  const slides = slideRangeLabel(picked);
  return {
    module: 'notes',
    sourceId: noteSourceId(note.id, picked),
    label: t(picked.length === 1 ? 'hubPickRowLabelOne' : 'hubPickRowLabel', { title: note.title, slides }),
  };
}

/**
 * Picks the slides of one Liturgical Content Hub entry to put into the Holy Mass. A full-screen entry is shown as its numbered slides (the
 * same breaks the projector uses: each `---` line typed in the Hub starts one), each with a checkbox, and Select all. Only the slides ticked
 * are added, as one lineup row that remembers the entry (`note_id`) and the slides (`slide_indices`) in its source id. A lower-third banner
 * or a private operator note has no slides, so it is added whole.
 *
 * Where it goes: in a Holy Mass slot (the slot of the row on air to start with), straight after the row on air, or at the end of the lineup.
 * Cancel, Esc or a click outside closes it and leaves the lineup as it was. `note` is the live entry, so an edit in the Hub shows here at once.
 */
export function HubSlideSelectionModal({
  note,
  queue,
  cursor,
  t,
  insert = insertDeckIntoFlow,
  onClose,
  onDone,
}: {
  /** The entry, read live from the notes table. Undefined once it is deleted. */
  note: Note | undefined;
  queue: QueueItem[];
  cursor: number;
  t: GoLiveT;
  insert?: (rows: FlowRow[], target: MassFlowTarget) => Promise<unknown>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const current = cursor >= 0 ? queue[cursor] ?? null : null;
  const activeSlot = current ? slotOfRow(queue, cursor) : null;
  const [where, setWhere] = useState<Where>(activeSlot || !current ? 'slot' : 'next');
  const [slot, setSlot] = useState<string | null>(activeSlot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = note?.display === 'full';
  const pages = useMemo(() => (note && full && note.body.trim() ? screenPagesOf(note) : []), [note, full]);
  // Every slide starts ticked; one taken out by an edit in the Hub drops out of the choice.
  const [picked, setPicked] = useState<Set<number>>(() => new Set(pages.map((_, i) => i)));
  const total = pages.length;
  const kept = useMemo(() => [...picked].filter((k) => k < total).sort((a, b) => a - b), [picked, total]);
  const allOn = total > 0 && kept.length === total;
  const toggle = (k: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(pages.map((_, i) => i)));

  const last = queue.length - 1;
  const target: MassFlowTarget | null =
    where === 'slot' && slot ? { kind: 'slot', slot } : where === 'next' && current ? { kind: 'after', index: cursor } : where === 'end' && last >= 0 ? { kind: 'after', index: last } : null;
  const hasContent = note != null && (note.display === 'operator' || note.body.trim().length > 0);
  const ready = note != null && hasContent && target != null && (!full || kept.length > 0);

  const add = async () => {
    if (!ready || busy || !note) return;
    setBusy(true);
    setError(null);
    const row = hubSlideRow(note, full ? kept : [], total, t);
    try {
      await insert([row], target!);
      onDone(t('hubPickAdded', { label: row.label }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  // Esc closes and Ctrl+Enter adds, from anywhere in the dialog. The latest values are read from a ref, so the listener is added once.
  const keys = useRef({ add, close: onClose });
  keys.current = { add, close: () => !busy && onClose() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        keys.current.close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void keys.current.add();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const slotInfo = slotById(slot);
  const style = note ? sanitizeTextStyle(note.style) : null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="hub-pick-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => keys.current.close()}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-4xl flex-col gap-4 rounded-xl border border-fg/20 bg-panel p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('hubPickTitle')}</span>
            <h2 id="hub-pick-title" className="truncate text-lg font-bold tracking-tight text-fg">{note?.title ?? '—'}</h2>
            {note && <p className="truncate text-xs text-fg/60">{noteCategoryLabel(note.category)}</p>}
          </div>
          <button type="button" onClick={() => keys.current.close()} disabled={busy} aria-label={t('inflowClose')} className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/20 text-fg/60 hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {!note ? (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{t('hubPickGone')}</p>
          ) : !hasContent ? (
            <p className="rounded-md border border-fg/15 bg-fg/[0.04] px-3 py-2 text-sm text-fg/70">{t('hubPickEmptyText')}</p>
          ) : !full ? (
            <div className={`flex flex-col gap-2 rounded-lg border p-3 ${note.display === 'operator' ? 'border-cyan-500/40 bg-cyan-500/[0.07]' : 'border-amber-500/40 bg-amber-500/[0.07]'}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-fg/75">
                {note.display === 'operator' ? <Lock size={12} aria-hidden /> : <PanelBottom size={12} aria-hidden />}
                {t(note.display === 'operator' ? 'hubPickPrivate' : 'hubPickBanner')}
              </span>
              <p className="max-h-48 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-fg/90">{note.body}</p>
            </div>
          ) : (
            <section aria-label={t('hubPickTitle')} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-fg/85">
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = kept.length > 0 && !allOn;
                    }}
                    onChange={toggleAll}
                    className="size-4 accent-[#ecc98a]"
                  />
                  {t('hubPickSelectAll')}
                </label>
                <span className={`font-mono text-xs ${kept.length === 0 ? 'text-danger' : 'text-fg/60'}`}>
                  {kept.length === 0 ? t('hubPickNone') : t('hubPickSelected', { n: kept.length, total })}
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((page, k) => {
                  const on = picked.has(k);
                  return (
                    <li key={k}>
                      <label
                        className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border p-2 transition ${
                          on ? 'border-[#ecc98a] bg-[#ecc98a]/10' : 'border-fg/15 opacity-60 hover:border-fg/30 hover:opacity-90'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-xs font-bold tracking-wide text-fg/80 uppercase">
                          <input type="checkbox" checked={on} onChange={() => toggle(k)} className="size-4 accent-[#ecc98a]" />
                          {t('hubPickSlide', { n: k + 1 })}
                          {on && <Check size={12} aria-hidden className="ml-auto text-[#ecc98a]" />}
                        </span>
                        <SlidePreview
                          text={page.text}
                          headline={note.title}
                          top={page.top ?? null}
                          bgSrc={null}
                          style={{ ...style, fontSize: page.fontPx }}
                          className="aspect-video w-full rounded-md border border-fg/15"
                        />
                        {/* The whole text of the slide, as the preview may draw it small. */}
                        <span className="line-clamp-4 text-[11px] leading-snug whitespace-pre-line text-fg/65">{page.text}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
            <legend className="mb-1 text-[11px] font-bold tracking-wider text-fg/60 uppercase">{t('inflowWhere')}</legend>
            <select value={where} onChange={(e) => setWhere(e.target.value as Where)} aria-label={t('inflowWhere')} className={FIELD}>
              <option value="slot">{slotInfo ? t('hubPickWhereSlotIn', { slot: `${slotInfo.position} · ${slotInfo.name}` }) : t('hubPickWhereSlot')}</option>
              {current && <option value="next">{t('inflowAfterLive', { item: current.label })}</option>}
              {last >= 0 && <option value="end">{t('hubPickWhereEnd')}</option>}
            </select>
            {where === 'slot' && (
              <div className="flex flex-col gap-1">
                {!slot && <span className="text-xs text-fg/60">{t('hubPickChooseSlot')}</span>}
                <div className="max-h-56 overflow-y-auto pl-2">
                  <MassSlotPicker value={slot} onChange={setSlot} />
                </div>
              </div>
            )}
          </fieldset>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => keys.current.close()} disabled={busy} className={BTN}>
            {t('inflowCancel')}
          </button>
          <button type="button" onClick={() => void add()} disabled={!ready || busy} className={PRIMARY}>
            {busy ? t('inflowAdding') : full ? t('hubPickAdd', { n: kept.length }) : t('hubPickAddWhole')}
          </button>
        </footer>
      </div>
    </div>
  );
}
