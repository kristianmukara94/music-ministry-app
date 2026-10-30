import { livePosition, slidesFor, step, type PwPosition, type PwSegment, type PwSlide } from '../../shared/pw.js';
import { pwT } from '../../shared/pw-i18n.js';
import { isAnyOutputLive } from '../../shared/live.js';
import type { Frame, LiveState, LowerThird } from '../../shared/live.js';
import { dispatch, useLive } from '../live/store';
import { turnOnProjectorAndGo } from '../live/startup';
import { setUi, useUi } from '../state/ui';
import { openSession, refreshLibraries, resolvedFor, usePw } from './store';
import type { PwSession } from './types';

/**
 * One step of the live lineup: a projector slide, or the black screen a segment ends on when its "fade to black"
 * cue is set. Counts and positions include that black step, so Next walks through it like any slide.
 */
export type LiveStep = { kind: 'slide'; slide: PwSlide; index: number; total: number } | { kind: 'black' };

/** Every segment's live steps, from the content loaded in the planner store. */
export function liveDeck(session: PwSession): LiveStep[][] {
  const state = usePw.getState();
  // The lower third on screen, if any: a lyric or prayer page leaves room for it, so the split follows the band.
  const band = useLive.getState().state.lowerThird.live;
  // The operator's text size: a larger size makes more pages, so the lineup is paged at the size the text is drawn at.
  const scale = useLive.getState().state.settings.slideFontScale;
  return session.segments.map((segment) => {
    const slides = slidesFor(segment, resolvedFor(segment, state), { band, scale });
    const steps: LiveStep[] = slides.map((slide, index) => ({ kind: 'slide', slide, index, total: slides.length }));
    if (segment.cues.fadeOut) steps.push({ kind: 'black' });
    return steps;
  });
}

/** The words a lyric or prayer slide shows, or an empty string for a slide with none. */
function textOf(slide: PwSlide): string {
  return slide.kind === 'lyrics' || slide.kind === 'prayer' ? slide.text ?? '' : '';
}

/**
 * When the text size changes, the item on air is paged again at the new size. The slide on screen moves to the page that holds its first
 * line, and the cursor follows, so the place in the lineup is kept. A title slide or a black step has no pages, so it stays as it is.
 */
export function watchSlideScale(): () => void {
  let scale = useLive.getState().state.settings.slideFontScale;
  return useLive.subscribe((next) => {
    const now = next.state.settings.slideFontScale;
    if (now === scale) return;
    scale = now;
    repaginateOnAir();
  });
}

function repaginateOnAir() {
  const state = useLive.getState().state;
  const session = usePw.getState().session;
  if (!state.pw?.onAir || !session) return;
  const onScreen = state.projector.live;
  if (onScreen.kind !== 'pw') return;
  const old = onScreen.slide;
  if (old.kind !== 'lyrics' && old.kind !== 'prayer') return;
  const at = livePosition(session.segments, state.pw);
  if (!at) return;
  const segment = session.segments[at.segment];
  const steps = liveDeck(session)[at.segment] ?? [];
  const firstLine = textOf(old).split('\n')[0].trim();
  if (!firstLine) return;
  // The pages of the same song section, or of the same prayer, in the new paging.
  const sameSource = (slide: PwSlide) =>
    slide.kind === old.kind && (old.kind !== 'lyrics' || (slide.kind === 'lyrics' && slide.hymnId === old.hymnId && slide.sectionId === old.sectionId));
  const candidates = steps.flatMap((step, index) => (step.kind === 'slide' && sameSource(step.slide) ? [{ step, index }] : []));
  if (candidates.length === 0) return;
  const holding = candidates.find(({ step }) => step.kind === 'slide' && textOf(step.slide).includes(firstLine));
  const nearest = [...candidates].sort((a, b) => Math.abs(a.index - at.slide) - Math.abs(b.index - at.slide))[0];
  const target = holding ?? nearest;
  if (target.step.kind !== 'slide') return;
  if (target.index === at.slide && textOf(target.step.slide) === textOf(old)) return;
  dispatch({ type: 'projector/show', frame: frameFor(segment, target.step), source: 'PW_SESSION' });
  dispatch({ type: 'pw/cursor', segmentKey: segment.key, slide: target.index, now: Date.now() });
}

const lang = () => useUi.getState().lang;

/** The projector frame for a step. */
export function frameFor(segment: PwSegment, s: LiveStep): Frame {
  if (s.kind === 'black') return { kind: 'blackout' };
  const footer = s.slide.kind === 'lyrics' ? s.slide.hymnTitle : s.slide.kind === 'prayer' ? pwT(lang(), 'prayTogether') : undefined;
  return { kind: 'pw', slide: s.slide, segmentName: segment.name, type: segment.type, index: s.index, total: s.total, footer };
}

/** The song titles of a segment on one line. A long list would fill the screen, so it keeps the first title and counts the rest. */
function titlesLine(titles: string[]): string {
  const all = titles.join(' · ');
  return titles.length < 2 || all.length <= 60 ? all : `${titles[0]} · +${titles.length - 1} more`;
}

/** The song a live step belongs to, or null for a title, a prayer, a reading or the black step. */
function hymnOf(step: LiveStep | undefined): number | null {
  return step?.kind === 'slide' && step.slide.kind === 'lyrics' ? step.slide.hymnId : null;
}

/**
 * The livestream lower third for a segment: the segment's name on the gold tag, and on the maroon bar the song title with
 * its composer beneath (or the group, when there is no song or no composer). When `hymnId` names one of the segment's songs, the bar
 * shows that song alone, so a segment of several songs names the one that is playing and not all of them at once.
 */
export function lowerThirdFor(session: PwSession, segment: PwSegment, hymnId: number | null = null): LowerThird {
  const hymns = usePw.getState().hymns;
  const songs = segment.content.hymnIds.map((id) => hymns[id]).filter(Boolean);
  const group = session.groups.find((g) => g.key === segment.group)?.name ?? '';
  if (songs.length === 0) return { template: 'segment', tag: segment.name, line1: group };
  const playing = hymnId != null && segment.content.hymnIds.includes(hymnId) ? hymns[hymnId] : undefined;
  if (playing) return { template: 'segment', tag: segment.name, line1: playing.title, line2: playing.composer || group };
  return { template: 'segment', tag: segment.name, line1: titlesLine(songs.map((h) => h.title)), line2: songs[0].composer || group };
}

/** What has the projector, in words the operator knows. Null when it is free or already showing this session. */
export function otherSourceOnAir(live: LiveState = useLive.getState().state): string | null {
  if (live.pw?.onAir) return null;
  const { projector, outputs } = live;
  if (!outputs.projector || projector.live.kind === 'idle') return null;
  const t = (key: string) => pwT(lang(), key);
  if (projector.source === 'MASS_QUEUE') return t('source_mass');
  return t('source_other');
}

/** Asks before Praise & Worship takes the projector from something else. True when it may go ahead. */
export function confirmTakeover(): boolean {
  const other = otherSourceOnAir();
  return !other || window.confirm(pwT(lang(), 'takeOverConfirm', { source: other }));
}

/**
 * Puts a position on the projector. A new segment restarts its timer and sets its lower third: shown when the
 * segment's cue asks for it, otherwise only staged, so the Lower third toggle can bring it up.
 * With the projector off, the operator is asked to turn it on first, as the Mass Queue does.
 */
export function showPosition(session: PwSession, deck: LiveStep[][], pos: PwPosition, frameOverride?: Frame) {
  const segment = session.segments[pos.segment];
  const s = deck[pos.segment]?.[pos.slide];
  if (!segment || !s) return;
  const live = useLive.getState().state;
  const go = () => {
    const now = useLive.getState().state;
    const before = now.pw;
    const beforePos = before && livePosition(session.segments, before);
    // Leaving this session's own end-of-segment black step lifts it. A blackout the operator pressed is left alone:
    // new slides wait behind it, as they do for every module.
    const leavingBlackStep =
      before?.onAir && now.projector.live.kind === 'blackout' && beforePos && deck[beforePos.segment]?.[beforePos.slide]?.kind === 'black' && s.kind !== 'black';
    dispatch({ type: 'projector/show', frame: frameOverride ?? frameFor(segment, s), source: 'PW_SESSION' });
    dispatch({ type: 'pw/cursor', segmentKey: segment.key, slide: pos.slide, now: Date.now() });
    if (leavingBlackStep) dispatch({ type: 'projector/blackout' });
    const newSegment = !before?.onAir || before.segmentKey !== segment.key;
    // Moving on to another song of the same segment names that song on the lower third.
    const hymnNow = hymnOf(s);
    const hymnBefore = beforePos ? hymnOf(deck[beforePos.segment]?.[beforePos.slide]) : null;
    const newSong = !newSegment && hymnNow !== null && hymnNow !== hymnBefore;
    if (newSegment || newSong) {
      const value = lowerThirdFor(session, segment, hymnNow);
      // A segment with no Lower 3rd cue does not change the Lower 3rd on or off: its value is only staged, for the operator to take live.
      // A band already on screen for this segment is updated in place, so it never names the wrong song.
      if (segment.cues.lowerThird || (newSong && now.lowerThird.live?.template === 'segment')) dispatch({ type: 'lowerThird/show', value });
      else dispatch({ type: 'lowerThird/stage', value });
    }
  };
  if (!isAnyOutputLive(live)) {
    // The operator chose to skip for this session: go live in the app only, with no prompt and no projector window.
    if (useUi.getState().projectorPromptChoice === 'skip') {
      go();
      return;
    }
    setUi({
      projectorPrompt: {
        label: segment.name,
        turnOnAndGo: () => {
          setUi({ projectorPrompt: null });
          turnOnProjectorAndGo(go);
        },
        // Live without the projector: the same step as going live with it on, and no window opens.
        skip: () => {
          setUi({ projectorPrompt: null, projectorPromptChoice: 'skip' });
          go();
        },
      },
    });
    return;
  }
  go();
}

/** The live session, if it is the one open in the planner. */
export function liveSession(): PwSession | null {
  const session = usePw.getState().session;
  const pw = useLive.getState().state.pw;
  return session && pw?.sessionId === session.id ? session : null;
}

/** Loads the open session for live use and puts its current place (its start, the first time) on the projector. */
export function goLive() {
  const session = usePw.getState().session;
  if (!session || !confirmTakeover()) return;
  // Read before dispatching: the main process applies pw/load, so the mirror has not seen it yet.
  // Loading the session that is already loaded keeps its place, so resume from there.
  const pw = useLive.getState().state.pw;
  dispatch({ type: 'pw/load', sessionId: session.id });
  const deck = liveDeck(session);
  const at = pw && pw.sessionId === session.id ? livePosition(session.segments, pw) : null;
  const pos = at && deck[at.segment]?.[at.slide] ? at : { segment: 0, slide: 0 };
  showPosition(session, deck, pos);
}

/**
 * Makes sure the live session is the one loaded in the planner store, with its songs, so the console's keys work from
 * any module. Opening the Praise & Worship view is not required.
 */
async function ensureLiveSession(): Promise<PwSession | null> {
  const pw = useLive.getState().state.pw;
  if (!pw) return null;
  if (usePw.getState().session?.id !== pw.sessionId) {
    await refreshLibraries();
    await openSession(pw.sessionId);
  }
  return liveSession();
}

/** Next (+1) or Back (-1): through the segment's slides, then on to the next segment. Nothing happens at either end. */
export async function stepLive(delta: 1 | -1) {
  const session = await ensureLiveSession();
  const pw = useLive.getState().state.pw;
  if (!session || !pw) return;
  const deck = liveDeck(session);
  const at = livePosition(session.segments, pw);
  if (!at) return;
  const next = step(deck.map((d) => d.length), at, delta);
  if (next) showPosition(session, deck, next);
}

/** Jumps to a segment's first slide, or one of its slides. */
export function jumpTo(segment: number, slide = 0) {
  const session = liveSession();
  if (!session) return;
  showPosition(session, liveDeck(session), { segment, slide });
}

/** Ends the live session: takes its slide and lower third off the outputs if they are still its own, and unloads it. */
export function endSession() {
  const live = useLive.getState().state;
  if (live.pw?.onAir) {
    dispatch({ type: 'projector/clear' });
    if (live.lowerThird.live?.template === 'segment') dispatch({ type: 'lowerThird/clear' });
  }
  dispatch({ type: 'pw/end' });
}
