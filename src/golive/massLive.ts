import { useEffect, useState } from 'react';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { stanzaFrame } from '../lyrics/frames';
import type { Hymn } from '../lyrics/types';
import { playQueueAt, stepQueue } from '../planner/routing';
import { sectionChip } from '../../shared/pw.js';
import type { Frame, LiveState, LowerThird } from '../../shared/live.js';

// The Mass console plays queue items where the operator is: a song, an announcement or a picture never switches panels.
const IN_PLACE = { inPlace: true } as const;

/** Whether the Mass Queue has the projector: it is on, its last take came from the queue, and something is showing. */
export function queueOnAir(state: LiveState): boolean {
  return state.outputs.projector && state.projector.source === 'MASS_QUEUE' && state.projector.live.kind !== 'idle';
}

/** The slides inside one item: a reading's pages, a psalm's verses, a deck of pictures, or a song's stanzas. Null for a one-slide item. */
export interface ItemSteps {
  index: number;
  count: number;
  labels: string[];
}

const numbered = (count: number) => Array.from({ length: count }, (_, i) => String(i + 1));

export function stepsOf(frame: Frame, hymn: Hymn | null): ItemSteps | null {
  if (frame.kind === 'deck' && frame.slides.length > 1) return { index: frame.index, count: frame.slides.length, labels: numbered(frame.slides.length) };
  if (frame.kind === 'psalm' && frame.pages.length > 1) return { index: frame.index, count: frame.pages.length, labels: numbered(frame.pages.length) };
  if (frame.kind === 'image' && frame.deck) return { index: frame.deck.index, count: frame.deck.slides.length, labels: numbered(frame.deck.slides.length) };
  if (frame.kind === 'lyrics' && frame.song && hymn && hymn.id === frame.song.hymnId && hymn.stanzas.length > 1) {
    return { index: frame.song.position, count: hymn.stanzas.length, labels: hymn.stanzas.map((s) => sectionChip(s.stanzaType)) };
  }
  return null;
}

/** The frame for slide `target` of the item `frame` belongs to. Null when there is no such slide. */
export function frameAt(frame: Frame, target: number, hymn: Hymn | null): Frame | null {
  if (target < 0) return null;
  if (frame.kind === 'deck') return target < frame.slides.length ? { ...frame, index: target } : null;
  if (frame.kind === 'psalm') return target < frame.pages.length ? { ...frame, index: target } : null;
  if (frame.kind === 'image' && frame.deck) {
    const picture = frame.deck.slides[target];
    if (!picture) return null;
    return { kind: 'image', title: picture.title, src: picture.src, ...(picture.notes ? { notes: picture.notes } : {}), deck: { slides: frame.deck.slides, index: target } };
  }
  if (frame.kind === 'lyrics' && hymn && frame.song?.hymnId === hymn.id) return stanzaFrame(hymn, target);
  return null;
}

/** The song behind a lyrics frame, read fresh from the library, so an edit made a moment ago is used. */
async function hymnOf(frame: Frame): Promise<Hymn | null> {
  if (frame.kind !== 'lyrics' || !frame.song) return null;
  return bridge.lyrics.getHymn(frame.song.hymnId);
}

/** Loads the song behind the frame on screen, for the console's chips and its next-slide preview. Null for anything else. */
export function useHymnOf(frame: Frame): Hymn | null {
  const id = frame.kind === 'lyrics' ? frame.song?.hymnId : undefined;
  const [hymn, setHymn] = useState<Hymn | null>(null);
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
  }, [id]);
  return hymn && hymn.id === id ? hymn : null;
}

/** Shows a slide of the item on screen. The take is the queue's own, so the queue keeps its place. */
function showWithin(frame: Frame) {
  dispatch({ type: 'projector/stage', frame });
  dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
}

/** Jumps to slide `target` of the item on screen. */
export async function goWithin(target: number): Promise<void> {
  const frame = useLive.getState().state.projector.live;
  const next = frameAt(frame, target, await hymnOf(frame));
  if (next) showWithin(next);
}

/**
 * Next (+1) or Back (-1): through the slides of the item on screen, then on to the next item of the queue, the same way the Praise & Worship
 * console walks its lineup. Before the queue has started, Next starts it at its first item.
 */
export async function stepMass(delta: 1 | -1): Promise<void> {
  const state = useLive.getState().state;
  if (queueOnAir(state)) {
    const frame = state.projector.live;
    const hymn = await hymnOf(frame);
    const steps = stepsOf(frame, hymn);
    const target = steps ? steps.index + delta : -1;
    const next = steps && target >= 0 && target < steps.count ? frameAt(frame, target, hymn) : null;
    if (next) {
      showWithin(next);
      return;
    }
  }
  await stepQueue(delta, IN_PLACE);
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
 * Go Live for the Holy Mass: plays the item, and once the queue is on the projector turns the lower third on with the plan's name. If the
 * operator declined to turn the projector on, nothing is on air and the lower third is left alone.
 */
export async function goLiveMassAt(index: number, planName: string | null | undefined): Promise<void> {
  await playQueueAt(index, IN_PLACE);
  if (await whenLive((s) => queueOnAir(s))) dispatch({ type: 'lowerThird/on', value: holyMassBand(planName) });
}

/** Plays a queue item from its first slide, where the operator is. Asks to turn the projector on first when it is off. */
export function playMassAt(index: number): Promise<void> {
  return playQueueAt(index, IN_PLACE);
}
