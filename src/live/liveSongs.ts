// Keeps the live projector slide in step with the song on it. When a song is edited, the slide that shows it is re-rendered with the
// new lyrics, keeping the operator's stanza where it still exists. When the song is deleted, the slide stays and the operator is told.
// Runs in the operator window only: the projector window only draws what the live state says.

import type { Hymn } from '../lyrics/types';
import { withHymn } from '../../shared/hymn-cache.js';
import { findLyricsStep, lyricsFrameAfterEdit, stanzaTarget } from '../../shared/live-song.js';
import { livePosition, type PwSlide } from '../../shared/pw.js';
import { findSlideIndex } from '../../shared/lyric-area.js';
import type { Frame } from '../../shared/live.js';
import { frameFor, liveDeck } from '../praise-worship/live';
import { usePw } from '../praise-worship/store';
import { bridge } from './bridge';
import { useLiveNotice } from './liveNotice';
import { dispatch, useLive } from './store';

/** The Praise & Worship slide on screen, when it is a lyrics slide of this song. */
function pwSlideFor(hymnId: number) {
  const state = useLive.getState().state;
  const session = usePw.getState().session;
  if (!state.pw?.onAir || !session) return null;
  const at = livePosition(session.segments, state.pw);
  if (!at) return null;
  const step = liveDeck(session)[at.segment]?.[at.slide];
  if (!step || step.kind !== 'slide' || step.slide.kind !== 'lyrics' || step.slide.hymnId !== hymnId) return null;
  return { segmentIndex: at.segment, slideIndex: at.slide, slide: step.slide, session };
}

/** Re-renders the Praise & Worship slide on screen with the edited song, keeping the stanza where it still exists. */
function refreshPwSlide(hymnId: number, hymn: Hymn, found: NonNullable<ReturnType<typeof pwSlideFor>>) {
  const { session, segmentIndex, slideIndex, slide } = found;
  const segment = session.segments[segmentIndex];
  // The lineup reads the song from the planner's cache, so the cache takes the new song before the slide is built.
  usePw.setState((s) => ({ hymns: withHymn(s.hymns, hymnId, hymn) }));
  const target = stanzaTarget(slide.position ?? 0, slide.stanzaCount ?? hymn.stanzas.length, hymn.stanzas.length);
  if (!target) return;
  const steps = liveDeck(session)[segmentIndex];
  const asFind = steps.map((s) => (s.kind === 'slide' && s.slide.kind === 'lyrics' ? { kind: 'lyrics', hymnId: s.slide.hymnId, position: s.slide.position } : { kind: 'other' }));
  const index = findLyricsStep(asFind, hymnId, target.position, slideIndex);
  if (index === null) return;
  const next = steps[index];
  if (next.kind !== 'slide') return;
  const textOf = (x: PwSlide) => (x.kind === 'lyrics' || x.kind === 'prayer' ? x.text : '');
  if (index === slideIndex && textOf(next.slide) === textOf(slide)) return;
  dispatch({ type: 'projector/show', frame: frameFor(segment, next), source: 'PW_SESSION' });
  dispatch({ type: 'pw/cursor', segmentKey: segment.key, slide: index, now: Date.now() });
  if (target.moved) notifyMoved(hymn.stanzas.length);
}

function notifyMoved(stanzaCount: number) {
  useLiveNotice.getState().show({
    kind: 'moved',
    text: `The song now has ${stanzaCount} stanza${stanzaCount === 1 ? '' : 's'}, so the projector moved to the last one.`,
  });
}

/** A song was edited, deleted, or restored in Song Lyrics. Called for every such change, in this window. */
async function songChanged(id: number) {
  const projector = useLive.getState().state.projector;
  const lyricsFrame = [projector.live, projector.staged].find((f): f is Extract<Frame, { kind: 'lyrics' }> => f.kind === 'lyrics' && f.song?.hymnId === id);
  const pwSlide = pwSlideFor(id);
  if (!lyricsFrame && !pwSlide) return;

  let hymn: Hymn | null;
  try {
    hymn = await bridge.lyrics.getHymn(id);
  } catch {
    return;
  }
  if (!hymn || hymn.deletedAt) {
    const title = lyricsFrame?.title ?? pwSlide?.slide.hymnTitle ?? 'This song';
    // The slide stays on screen. The operator decides whether to clear the projector.
    useLiveNotice.getState().show({ kind: 'deleted', text: `"${title}" was deleted from Song Lyrics. It is still on the projector.` });
    return;
  }

  if (lyricsFrame) {
    const result = lyricsFrameAfterEdit(lyricsFrame, hymn);
    if (result) {
      if (result.changed) dispatch({ type: 'projector/refresh', key: lyricsFrame.key ?? `song:${id}`, frame: result.frame });
      if (result.moved) notifyMoved(hymn.stanzas.length);
    }
  }
  if (pwSlide) refreshPwSlide(id, hymn, pwSlide);
}

/** Starts listening for song edits. Returns the function that stops listening. */
export function startLiveSongWatch(): () => void {
  return bridge.lyrics.onChanged((id) => void songChanged(id));
}

/**
 * Turning the lower third on or off changes how a lyric or prayer is split, because the band takes room beside the text. The operator stays
 * on the same stanza or prayer, and the same part of it, and the projector shows that part in its new split.
 */
function keepPlaceAcrossBand() {
  const state = useLive.getState().state;
  const session = usePw.getState().session;
  const shown = state.projector.live;
  if (!state.pw?.onAir || !session || shown.kind !== 'pw') return;
  const at = livePosition(session.segments, state.pw);
  if (!at) return;
  const steps = liveDeck(session)[at.segment];
  const index = findSlideIndex(steps.map((step) => (step.kind === 'slide' ? step.slide : null)), shown.slide);
  if (index === null) return;
  const next = steps[index];
  if (next.kind !== 'slide') return;
  const segment = session.segments[at.segment];
  dispatch({ type: 'projector/show', frame: frameFor(segment, next), source: 'PW_SESSION' });
  dispatch({ type: 'pw/cursor', segmentKey: segment.key, slide: index, now: Date.now() });
}

let bandWasOn = useLive.getState().state.lowerThird.live != null;
useLive.subscribe((store) => {
  const on = store.state.lowerThird.live != null;
  if (on === bandWasOn) return;
  bandWasOn = on;
  keepPlaceAcrossBand();
});
