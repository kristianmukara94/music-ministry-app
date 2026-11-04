import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { stanzaFrame } from '../lyrics/frames';
import type { Hymn } from '../lyrics/types';
import { slideFramesOf, takePrayer } from '../notes/present';
import type { Note } from '../notes/types';
import { openQueueItem, playQueueAt, stepQueue } from '../planner/routing';
import { useUi } from '../state/ui';
import { sectionChip } from '../../shared/pw.js';
import { slotById } from '../../shared/mass-slots.js';
import { frameKey, songTitleFrame } from '../../shared/stage-plan-row.js';
import { isAnyOutputLive, type Frame, type LiveState, type LowerThird } from '../../shared/live.js';

// The Mass console plays queue items where the operator is: a song, an announcement or a picture never switches panels.
const IN_PLACE = { inPlace: true } as const;

/** Whether the Mass Queue has the projector: it is on, its last take came from the queue, and something is showing. */
export function queueOnAir(state: LiveState): boolean {
  return state.outputs.projector && state.projector.source === 'MASS_QUEUE' && state.projector.live.kind !== 'idle';
}

/**
 * Whether the Holy Mass has the screen: it has a place, its last take came from the queue, and something is showing. Unlike queueOnAir this does
 * not ask for the projector window, so the console steps through a song the same way when the Mass runs on the TV and phones, or in the app alone.
 */
export function massShowing(state: LiveState): boolean {
  return state.queueCursor >= 0 && state.projector.source === 'MASS_QUEUE' && state.projector.live.kind !== 'idle';
}

/**
 * The slides inside one item: a reading's pages, a psalm's verses, a deck of pictures, a prayer's slides, or a song's title card and stanzas.
 * Null for a one-slide item. `labels` are the Jump to section chips: a song's are T (its title card) and its sections (V1, C1, B); a deck's are its slide numbers.
 */
export interface ItemSteps {
  index: number;
  count: number;
  labels: string[];
}

const numbered = (count: number) => Array.from({ length: count }, (_, i) => String(i + 1));

/** The prayer (a Notes & Prayers note) a frame shows one slide of. Undefined for anything else. */
export const prayerIdOf = (frame: Frame): number | undefined => {
  const id = frame.kind === 'text' && frame.key?.startsWith('prayer:') ? Number(frame.key.slice('prayer:'.length)) : NaN;
  return Number.isInteger(id) ? id : undefined;
};

/** The song a frame shows: a stanza of it, or its title card. Undefined for anything else. */
export const songIdOf = (frame: Frame): number | undefined =>
  frame.kind === 'lyrics' ? frame.song?.hymnId : frame.kind === 'pw' ? frame.massSong?.hymnId : undefined;

export function stepsOf(frame: Frame, hymn: Hymn | null): ItemSteps | null {
  if (frame.kind === 'deck' && frame.slides.length > 1) return { index: frame.index, count: frame.slides.length, labels: numbered(frame.slides.length) };
  if (frame.kind === 'psalm' && frame.pages.length > 1) return { index: frame.index, count: frame.pages.length, labels: numbered(frame.pages.length) };
  if (frame.kind === 'image' && frame.deck) return { index: frame.deck.index, count: frame.deck.slides.length, labels: numbered(frame.deck.slides.length) };
  // A prayer split into slides carries its place on every slide, so its steps need nothing loaded.
  if (frame.kind === 'text' && prayerIdOf(frame) !== undefined && frame.page && frame.page.total > 1) {
    return { index: frame.page.index, count: frame.page.total, labels: numbered(frame.page.total) };
  }
  // A song's steps are its title card, then its stanzas: stanza n is step n + 1.
  if (hymn && hymn.stanzas.length > 0 && songIdOf(frame) === hymn.id) {
    const index = frame.kind === 'lyrics' && frame.song ? frame.song.position + 1 : 0;
    return { index, count: hymn.stanzas.length + 1, labels: ['T', ...hymn.stanzas.map((s) => sectionChip(s.stanzaType))] };
  }
  return null;
}

/**
 * The frame for slide `target` of the item `frame` belongs to. Null when there is no such slide. `slotName` heads a song's title card: the
 * Holy Mass slot the song is sung at. `note` is the prayer behind a prayer's slide, read fresh so an edit made a moment ago is used.
 */
export function frameAt(frame: Frame, target: number, hymn: Hymn | null, slotName?: string | null, note?: Note | null): Frame | null {
  if (target < 0) return null;
  if (note && prayerIdOf(frame) === note.id) return slideFramesOf(note)[target] ?? null;
  if (frame.kind === 'deck') return target < frame.slides.length ? { ...frame, index: target } : null;
  if (frame.kind === 'psalm') return target < frame.pages.length ? { ...frame, index: target } : null;
  if (frame.kind === 'image' && frame.deck) {
    const picture = frame.deck.slides[target];
    if (!picture) return null;
    return { kind: 'image', title: picture.title, src: picture.src, ...(picture.notes ? { notes: picture.notes } : {}), deck: { slides: frame.deck.slides, index: target } };
  }
  if (hymn && songIdOf(frame) === hymn.id) {
    if (target === 0) return songTitleFrame(hymn, slotName ?? (frame.kind === 'pw' ? frame.segmentName : null));
    return stanzaFrame(hymn, target - 1);
  }
  return null;
}

/** The Holy Mass slot of the item the queue is on, by name, for a song's title card. */
export function slotNameAt(state: LiveState): string | null {
  return slotById(state.queue[state.queueCursor]?.slot)?.name ?? null;
}

/** The song behind a lyrics frame or a title card, read fresh from the library, so an edit made a moment ago is used. */
async function hymnOf(frame: Frame): Promise<Hymn | null> {
  const id = songIdOf(frame);
  return id == null ? null : bridge.lyrics.getHymn(id);
}

/** The prayer behind a prayer's slide, read fresh from Notes & Prayers. Null for anything else, or a prayer that was deleted. */
async function noteOf(frame: Frame): Promise<Note | null> {
  const id = prayerIdOf(frame);
  return id == null ? null : bridge.notes.get(id).catch(() => null);
}

/**
 * Loads the prayer behind the slide on screen, so the console can show its next slide. Null for anything else. Notes & Prayers sends no
 * change event, so it is read again whenever the slide changes: a prayer re-split there is re-staged with new text or a new count.
 */
export function useNoteOf(frame: Frame): Note | null {
  const id = prayerIdOf(frame);
  const shown = frame.kind === 'text' ? `${frame.page?.total ?? 1}|${frame.text}` : '';
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    if (id == null) {
      setNote(null);
      return;
    }
    let alive = true;
    bridge.notes
      .get(id)
      .then((n) => alive && setNote(n))
      .catch(() => alive && setNote(null));
    return () => {
      alive = false;
    };
  }, [id, shown]);
  return note && note.id === id ? note : null;
}

/**
 * Loads the song behind the frame on screen, for the console's chips, its next-slide preview and its live editor. Null for anything else.
 * It is read again when the song changes, so a stanza added or edited on air shows in the chips at once.
 */
export function useHymnOf(frame: Frame): Hymn | null {
  const id = songIdOf(frame);
  const [hymn, setHymn] = useState<Hymn | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => (id == null ? undefined : bridge.lyrics.onChanged((changed) => changed === id && setRevision((n) => n + 1))), [id]);
  useEffect(() => {
    if (id == null) {
      setHymn(null);
      return;
    }
    let alive = true;
    bridge.lyrics
      .getHymn(id)
      .then((h) => {
        if (alive) setHymn(h);
      })
      .catch(() => {
        if (alive) setHymn(null);
      });
    return () => {
      alive = false;
    };
  }, [id, revision]);
  return hymn && hymn.id === id ? hymn : null;
}

/**
 * The Holy Mass's clocks, as the Praise & Worship console has: the session time since the Mass first went on air, and the time since the item
 * on screen went up. Kept here in the operator window, not in the live state: they are for the operator only.
 */
export const useMassClock = create<{ liveSince: number | null; itemSince: number | null }>(() => ({ liveSince: null, itemSince: null }));

{
  let wasOnAir = false;
  let lastCursor = -1;
  let lastPlan: number | null = null;
  useLive.subscribe(({ state }) => {
    const onAir = massShowing(state);
    // A different plan is a different Mass: its session time starts again.
    if (state.queuePlanId !== lastPlan) useMassClock.setState({ liveSince: null, itemSince: null });
    if (onAir && (!wasOnAir || state.queueCursor !== lastCursor || state.queuePlanId !== lastPlan)) {
      const now = Date.now();
      useMassClock.setState((c) => ({ liveSince: c.liveSince ?? now, itemSince: now }));
    }
    wasOnAir = onAir;
    lastCursor = state.queueCursor;
    lastPlan = state.queuePlanId;
  });
}

/** Shows a slide of the item on screen. The take is the queue's own, so the queue keeps its place. */
function showWithin(frame: Frame) {
  dispatch({ type: 'projector/stage', frame });
  dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
}

/** Jumps to slide `target` of the item on screen. */
export async function goWithin(target: number, from?: Frame): Promise<void> {
  const state = useLive.getState().state;
  // `from` is the slide the console shows: the one on screen, or the one staged and ready, which a jump then puts on screen.
  const frame = from ?? state.projector.live;
  const next = frameAt(frame, target, await hymnOf(frame), slotNameAt(state), await noteOf(frame));
  if (next) showWithin(next);
}

/**
 * Next (+1) or Back (-1): through the slides of the item on screen, then on to the next item of the queue, the same way the Praise & Worship
 * console walks its lineup. Next from an item's last slide starts the next item at its first slide; Back from an item's first slide goes to the
 * item before at its last slide. Before the queue has started, Next starts it at its first item.
 */
export async function stepMass(delta: 1 | -1): Promise<void> {
  const state = useLive.getState().state;
  if (massShowing(state)) {
    const frame = state.projector.live;
    const hymn = await hymnOf(frame);
    const steps = stepsOf(frame, hymn);
    const target = steps ? steps.index + delta : -1;
    const next = steps && target >= 0 && target < steps.count ? frameAt(frame, target, hymn, slotNameAt(state), await noteOf(frame)) : null;
    if (next) {
      showWithin(next);
      return;
    }
    if (delta === -1) {
      let before = state.queueCursor - 1;
      while (before >= 0 && state.queue[before].stale) before -= 1;
      if (before >= 0) await playMassFromEnd(before);
      return;
    }
  }
  await stepQueue(delta, IN_PLACE);
}

/**
 * Plays queue item `index` at its last slide, for Back from the first slide of the item after it. The last slide is staged before the take, so
 * the first slide never flashes on screen. A full-screen prayer goes up at its last slide straight away. A lower-third prayer (which has no
 * slides) and a play that has to ask to turn the projector on start the item at its first slide, as any other play does.
 */
async function playMassFromEnd(index: number): Promise<void> {
  const state = useLive.getState().state;
  const item = state.queue[index];
  if (!item) return;
  if (!isAnyOutputLive(state) && useUi.getState().projectorPromptChoice !== 'skip') {
    await playMassAt(index);
    return;
  }
  if (item.module === 'notes') {
    const note = item.stale ? null : await bridge.notes.get(Number(item.sourceId)).catch(() => null);
    if (note?.display !== 'full') {
      await playMassAt(index);
      return;
    }
    dispatch({ type: 'queue/cursor', index });
    takePrayer(note, 'MASS_QUEUE', Math.max(0, slideFramesOf(note).length - 1));
    return;
  }
  const before = frameKey(state.projector.staged);
  if (!(await openQueueItem(item, index, IN_PLACE))) return;
  // The stage goes to the main process and comes back: the item's first slide is read once it is here.
  await whenLive((s) => s.queueCursor === index && frameKey(s.projector.staged) !== before);
  const first = useLive.getState().state.projector.staged;
  const hymn = await hymnOf(first);
  const steps = stepsOf(first, hymn);
  const last = steps ? frameAt(first, steps.count - 1, hymn, slotById(item.slot)?.name) : null;
  if (last) dispatch({ type: 'projector/stage', frame: last });
  dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
}

/**
 * Resolves true once the live state meets `ready`, or false after `ms`. Changes go to the main process and come back, so a step that depends
 * on one (playing the first item of a plan just loaded) waits for it here instead of reading the old state.
 */
export function whenLive(ready: (state: LiveState) => boolean, ms = 4000): Promise<boolean> {
  if (ready(useLive.getState().state)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const stop = useLive.subscribe((next) => {
      if (!ready(next.state)) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(false);
    }, ms);
  });
}

/** The lower third band for the Holy Mass: its tag and the plan's name. */
export const holyMassBand = (planName: string | null | undefined): LowerThird => ({ template: 'segment', tag: 'Holy Mass', line1: planName?.trim() || 'Holy Mass' });

/**
 * Go Live for the Holy Mass: plays the item. The lower third is not turned on: the band with the plan's name is only staged, so the Lower third
 * toggle shows it when the operator presses it. A band the operator already has on stays on.
 */
export async function goLiveMassAt(index: number, planName: string | null | undefined): Promise<void> {
  dispatch({ type: 'lowerThird/stage', value: holyMassBand(planName) });
  await playQueueAt(index, IN_PLACE);
}

/**
 * End session for the Holy Mass, as the Praise & Worship console has: clears the projector and the Mass's lower third band, and puts the order
 * of Mass back before its first item, ready to start again. The plan stays loaded.
 */
export function endMassSession(): void {
  const live = useLive.getState().state;
  if (massShowing(live)) dispatch({ type: 'projector/clear' });
  if (live.lowerThird.live?.template === 'segment' && live.lowerThird.live.tag === 'Holy Mass') dispatch({ type: 'lowerThird/clear' });
  dispatch({ type: 'queue/cursor', index: -1 });
  useMassClock.setState({ liveSince: null, itemSince: null });
}

/** Plays a queue item from its first slide, where the operator is. Asks to turn the projector on first when it is off. */
export function playMassAt(index: number): Promise<void> {
  return playQueueAt(index, IN_PLACE);
}
