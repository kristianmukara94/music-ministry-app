import { useEffect, useState } from 'react';
import { Church, ListPlus, Music, Presentation, Replace, X } from 'lucide-react';
import { MASS_SECTIONS, slotById, slotsOfBlock } from '../../shared/mass-slots.js';
import type { PictureDeck } from '../../shared/flow-insert.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { queueOnAir } from '../golive/massLive';
import { insertDeckIntoFlow, replaceSlotInFlow } from '../planner/plan-api';
import type { PlanItem } from '../planner/types';
import { chainPicturesInto } from '../praise-worship/store';
import type { PwSession, PwSessionSummary } from '../praise-worship/types';
import { errorText } from './errors';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const CHOICE = (on: boolean) =>
  `flex w-full min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
    on ? 'border-accent bg-accent/15 text-fg' : 'border-transparent text-fg/85 hover:border-fg/15 hover:bg-fg/[0.06]'
  }`;
const TAB = (on: boolean) =>
  `inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-bold tracking-wide uppercase transition ${
    on ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 text-fg/70 hover:border-fg/30 hover:text-fg'
  }`;
const BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10';
const PRIMARY =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-4 text-sm font-bold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

/** The rows of the plan loaded in the Service Queue, read again whenever another plan is loaded. Empty when none is. */
function useQueuedPlanItems(): PlanItem[] {
  const planId = useLive((s) => s.state.queuePlanId);
  const [items, setItems] = useState<PlanItem[]>([]);
  useEffect(() => {
    if (planId == null) {
      setItems([]);
      return;
    }
    let alive = true;
    bridge.plans
      .get(planId)
      .then((plan) => alive && setItems(plan.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [planId]);
  return items;
}

/**
 * The 17 Holy Mass slots, by section, with what fills each in the plan loaded in the Service Queue. Picking one chooses where new slides go.
 * Shared by the Whiteboard and Go Live.
 */
export function MassSlotPicker({ value, onChange }: { value: string | null; onChange: (slot: string) => void }) {
  const items = useQueuedPlanItems();
  return (
    <div className="flex flex-col gap-3">
      {MASS_SECTIONS.map((section) => (
        <section key={section.block} aria-label={section.name}>
          <h3 className="mb-1 px-1 text-[10px] font-bold tracking-wider text-fg/50 uppercase">
            {section.number}. {section.name}
          </h3>
          <ul className="flex flex-col gap-0.5">
            {slotsOfBlock(section.block).map((slot) => {
              const filler = items.find((it) => it.slot === slot.id);
              return (
                <li key={slot.id}>
                  <button type="button" aria-pressed={value === slot.id} onClick={() => onChange(slot.id)} className={CHOICE(value === slot.id)}>
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel-2 font-mono text-[11px] text-muted">{slot.number}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{slot.name}</span>
                      <span className="truncate text-[11px] text-fg/50">{filler ? filler.label : 'Empty'}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Where a PowerPoint from the Whiteboard goes: a Holy Mass slot (1 to 17) in the plan loaded in the Service Queue, or a card of a Praise &
 * Worship session. Each deck goes in whole, as one item that steps through its slides. A slot that is already filled offers a choice: Insert
 * after slot keeps what fills it and plays the deck after it; Replace existing puts the deck in its place. Nothing on the projector changes,
 * except when the item replaced is on air: then the new deck goes on air in its place.
 */
export function TargetSlotSelectorModal({ decks, onClose, onDone }: { decks: PictureDeck[]; onClose: () => void; onDone: (message: string) => void }) {
  const planLoaded = useLive((s) => s.state.queuePlanId != null);
  const [flow, setFlow] = useState<'mass' | 'pw'>('mass');
  const [slot, setSlot] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PwSessionSummary[] | null>(null);
  const [session, setSession] = useState<PwSession | null>(null);
  const [segmentKey, setSegmentKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planItems = useQueuedPlanItems();
  const filler = flow === 'mass' && slot ? (planItems.find((it) => it.slot === slot) ?? null) : null;
  // The slot's item is the row on air: Replace puts the new deck on screen in its place.
  const fillerOnAir = useLive((s) => filler != null && queueOnAir(s.state) && s.state.queue[s.state.queueCursor]?.slot === slot);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (flow !== 'pw' || sessions) return;
    bridge.pw
      .listSessions()
      .then(setSessions)
      .catch((err) => setError(errorText(err)));
  }, [flow, sessions]);

  const pickSession = async (id: number) => {
    setSegmentKey(null);
    setError(null);
    try {
      setSession(await bridge.pw.getSession(id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const slideCount = decks.reduce((n, d) => n + d.slideIds.length, 0);
  const ready = flow === 'mass' ? slot != null : session != null && segmentKey != null;

  const add = async (mode: 'insert' | 'replace' = 'insert') => {
    setBusy(true);
    setError(null);
    try {
      if (flow === 'mass' && slot && mode === 'replace') {
        const { added, skipped, replaced } = await replaceSlotInFlow(decks, slot);
        const target = slotById(slot);
        const where = target ? `${target.number}. ${target.name}` : 'the slot';
        const what = decks.length === 1 ? `"${decks[0].title}"` : plural(added, 'PowerPoint', 'PowerPoints');
        const left = skipped > 0 ? ` ${plural(skipped, 'was', 'were')} already in it.` : '';
        onDone(`${replaced ? `Replaced "${replaced}" with` : 'Added'} ${what} at ${where}.${left}`);
      } else if (flow === 'mass' && slot) {
        const { added, skipped } = await insertDeckIntoFlow(decks, { kind: 'slot', slot });
        const target = slotById(slot);
        const left = skipped > 0 ? ` ${plural(skipped, 'was', 'were')} already in it.` : '';
        onDone(`Added ${plural(added, 'PowerPoint', 'PowerPoints')} to the Holy Mass, at ${target ? `${target.number}. ${target.name}` : 'the slot'}.${left}`);
      } else if (session && segmentKey) {
        const added = await chainPicturesInto(session.id, segmentKey, decks.map((d) => d.slideIds));
        const card = session.segments.find((s) => s.key === segmentKey)?.name ?? 'the card';
        onDone(added > 0 ? `Added ${plural(added, 'PowerPoint', 'PowerPoints')} to "${card}" in ${session.name}.` : `"${card}" already has ${decks.length === 1 ? 'this PowerPoint' : 'these PowerPoints'}.`);
      }
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="target-slot-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-xl flex-col gap-4 rounded-xl border border-fg/20 bg-panel p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="target-slot-title" className="text-lg font-bold tracking-tight text-fg">Add PowerPoint to Go Live</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-fg/60">
              <Presentation size={13} aria-hidden />
              {decks.length === 1 ? decks[0].title : plural(decks.length, 'deck', 'decks')} · {plural(slideCount, 'slide', 'slides')}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid size-8 place-items-center rounded-md border border-fg/20 text-fg/60 hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div role="tablist" aria-label="Flow" className="flex gap-2">
          <button type="button" role="tab" aria-selected={flow === 'mass'} onClick={() => setFlow('mass')} className={TAB(flow === 'mass')}>
            <Church size={14} aria-hidden /> Holy Mass
          </button>
          <button type="button" role="tab" aria-selected={flow === 'pw'} onClick={() => setFlow('pw')} className={TAB(flow === 'pw')}>
            <Music size={14} aria-hidden /> Praise &amp; Worship
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {flow === 'mass' ? (
            <>
              <p className="mb-3 text-xs text-fg/60">
                {planLoaded
                  ? 'Choose a slot. An empty slot takes the PowerPoint; for a filled one, replace what is there or play it after.'
                  : 'No Holy Mass plan is loaded in the queue. A "Quick passages" plan for today will be made for it.'}
              </p>
              <MassSlotPicker value={slot} onChange={setSlot} />
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-fg/60">Choose a session and the card it plays in. It plays after what the card already holds.</p>
              {sessions === null ? (
                <p className="text-sm text-fg/60">Loading sessions…</p>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-fg/60">There are no Praise &amp; Worship sessions yet. Make one in Praise &amp; Worship first.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <button type="button" aria-pressed={session?.id === s.id} onClick={() => void pickSession(s.id)} className={CHOICE(session?.id === s.id)}>
                        <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-fg/50">{s.liturgicalDate}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {session && (
                <section aria-label={`Cards in ${session.name}`} className="border-t border-line pt-3">
                  <h3 className="mb-1 px-1 text-[10px] font-bold tracking-wider text-fg/50 uppercase">Cards</h3>
                  <ul className="flex flex-col gap-0.5">
                    {session.segments.map((segment, i) => (
                      <li key={segment.key}>
                        <button type="button" aria-pressed={segmentKey === segment.key} onClick={() => setSegmentKey(segment.key)} className={CHOICE(segmentKey === segment.key)}>
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel-2 font-mono text-[11px] text-muted">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-semibold">{segment.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        {filler && (
          <p role="note" className={`rounded-md border px-3 py-2 text-xs ${fillerOnAir ? 'border-warn/50 bg-warn/10 text-warn' : 'border-fg/15 bg-panel-2 text-fg/70'}`}>
            This slot holds <span className="font-semibold text-fg">"{filler.label}"</span>. Replace existing takes it out; Insert after slot keeps it and plays the PowerPoint next.
            {fillerOnAir && ' It is on screen now: Replace puts the new PowerPoint on screen in its place.'}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <footer className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN}>
            Cancel
          </button>
          {filler ? (
            <>
              <button type="button" onClick={() => void add('insert')} disabled={!ready || busy} className={BTN} title="Keep what fills the slot and play the PowerPoint after it">
                <ListPlus size={15} aria-hidden /> Insert after slot
              </button>
              <button type="button" onClick={() => void add('replace')} disabled={!ready || busy} className={PRIMARY} title={`Take "${filler.label}" out and put the PowerPoint in its place`}>
                <Replace size={15} aria-hidden /> {busy ? 'Working…' : 'Replace existing'}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void add()} disabled={!ready || busy} className={PRIMARY}>
              {busy ? 'Adding…' : 'Add to Go Live'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
