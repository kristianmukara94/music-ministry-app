import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { stanzaFrame } from '../lyrics/frames';
import type { Hymn } from '../lyrics/types';
import { livePosition } from '../../shared/pw.js';
import type { LowerThird } from '../../shared/live.js';
import { frameFor, liveDeck, lowerThirdFor } from './live';
import { usePw } from './store';
import { isTextEntry } from './textEntry';

/** How long a first click stays armed, when another slide is on air and the click needs a second to confirm. */
export const ARM_MS = 1500;
/** How long a notice stays up before it clears itself. */
const NOTICE_MS = 4000;

export interface QuickLiveNotice {
  hymnId: number;
  kind: 'empty' | 'failed' | 'screen';
  text: string;
}

/** A song shown straight from search, without being in the lineup. Kept for this session only. */
export interface OffPlanSong {
  hymnId: number;
  title: string;
  at: number;
}

/** The lower third for a song sent from search: its category as the tag, then its title and composer. */
export function quickLiveBand(hymn: Pick<Hymn, 'title' | 'composer' | 'songCategory'>): LowerThird {
  return { template: 'segment', tag: hymn.songCategory || 'Song', line1: hymn.title, ...(hymn.composer ? { line2: hymn.composer } : {}) };
}

/** The first stanza with words in it. A song whose first stanza is blank starts on the next one rather than on an empty screen. */
function firstSung(stanzas: { lyricsText: string }[]): number {
  return stanzas.findIndex((s) => s.lyricsText.trim() !== '');
}

/**
 * Puts a song from the Library search straight on the projector, for a request nobody planned.
 *
 * It shows stanza 1 with the same direct show the Song Lyrics page uses, so the lineup, its selected card and its place are left alone. A
 * song that has no words, or a screen that is not there, is reported beside the song instead of reaching the projector. When another slide is
 * already on air a mouse click is asked twice (the first arms the button for a moment); the keyboard shortcut, and Shift + click, go at once.
 *
 * The lineup keeps its place. A direct show takes the projector off the lineup's slide but leaves the lineup's card and slide position in the
 * live state, so `resumeLineup` puts that slide back on air. Every song shown this way is also written to the service history.
 */
export function useQuickLiveController() {
  const live = useLive((s) => s.state.projector.live);
  const projectorOn = useLive((s) => s.state.outputs.projector);
  const pw = useLive((s) => s.state.pw);
  const beforeBlackout = useLive((s) => s.state.projector.beforeBlackout);
  const [armedId, setArmedId] = useState<number | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<QuickLiveNotice | null>(null);
  const [offPlan, setOffPlan] = useState<OffPlanSong[]>([]);
  const [screens, setScreens] = useState<number | null>(null);
  // A short line that outlives the cue panel: what happened when Quick Live was left.
  const [toast, setToast] = useState<string | null>(null);
  const timers = useRef<{ arm?: number; notice?: number; toast?: number }>({});
  // The song whose stanzas the cue panel lists: the last one sent from search. The panel keeps it until it is closed.
  const [cue, setCue] = useState<Hymn | null>(null);
  const cueRef = useRef<Hymn | null>(null);
  cueRef.current = cue;
  const cuePanelRef = useRef<HTMLElement | null>(null);
  // The lower third this panel put up for its song, to take down or replace when Quick Live ends. Null when it did not.
  const bandRef = useRef<LowerThird | null>(null);

  // The song on the projector now, when it came from a song's own lyrics.
  const liveHymnId = live.kind === 'lyrics' ? (live.song?.hymnId ?? null) : null;
  // The stanza of the cue song on the projector now, and whether the song is held behind a blackout. Keys steer the song only in these two cases.
  const onAirStanza = cue && live.kind === 'lyrics' && live.song?.hymnId === cue.id ? live.song.position : null;
  const blackedOut = Boolean(cue && live.kind === 'blackout' && beforeBlackout?.kind === 'lyrics' && beforeBlackout.song?.hymnId === cue.id);
  const controlsActive = onAirStanza !== null || blackedOut;
  // Something else is showing, so a stray click would cut it.
  const somethingLive = live.kind !== 'idle' && live.kind !== 'blackout';
  // The lineup is parked (off air, with its place kept) while a song from search is on the projector, and the operator can go back to it.
  const canResume = Boolean(pw && !pw.onAir && pw.segmentKey != null && liveHymnId !== null && offPlan.some((x) => x.hymnId === liveHymnId));

  // The number of screens, to tell the operator when there is no second one to show on.
  useEffect(() => {
    let cancelled = false;
    bridge.displays
      .list()
      .then((list) => !cancelled && setScreens(list.length))
      .catch(() => !cancelled && setScreens(null));
    return () => {
      cancelled = true;
      window.clearTimeout(timers.current.arm);
      window.clearTimeout(timers.current.notice);
      window.clearTimeout(timers.current.toast);
    };
  }, []);

  const tell = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(timers.current.toast);
    timers.current.toast = window.setTimeout(() => setToast(null), NOTICE_MS);
  }, []);

  const say = useCallback((next: QuickLiveNotice) => {
    setNotice(next);
    window.clearTimeout(timers.current.notice);
    timers.current.notice = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  /** Shows the song now. Resolves true when the signal was sent. */
  const run = useCallback(
    async (hymnId: number, title: string, alreadyLive: boolean): Promise<boolean> => {
      setPendingId(hymnId);
      try {
        const [hymn, windowOpen] = await Promise.all([bridge.lyrics.getHymn(hymnId), bridge.quickLive.projectorOpen().catch(() => null)]);
        if (!hymn || hymn.deletedAt) {
          say({ hymnId, kind: 'failed', text: `"${title}" is not in the library any more.` });
          return false;
        }
        const start = firstSung(hymn.stanzas);
        const frame = start < 0 ? null : stanzaFrame(hymn, start);
        if (!frame) {
          // No words to show: nothing is sent, so the projector keeps what it has.
          say({ hymnId, kind: 'empty', text: `"${hymn.title}" has no lyrics to show. Open it in Song Lyrics to add them.` });
          return false;
        }
        dispatch({ type: 'projector/show', frame, source: 'DIRECT_DECK' });
        setCue(hymn);
        // The band naming the song is staged, not turned on: the operator shows it with the Lower third toggle when ready.
        bandRef.current = quickLiveBand(hymn);
        dispatch({ type: 'lowerThird/stage', value: bandRef.current });
        // The warnings are told in order of how much they matter: no window at all, then output off, then no second screen.
        if (windowOpen === false) say({ hymnId, kind: 'screen', text: 'The projector window is not open. Open it from the projector switch, then show the song again.' });
        else if (!projectorOn) say({ hymnId, kind: 'screen', text: 'The projector output is off. The song is ready and shows when it is switched on.' });
        else if (screens !== null && screens < 2) say({ hymnId, kind: 'screen', text: 'No second screen found. The song is on the projector window only.' });
        setOffPlan((list) => [...list.filter((x) => x.hymnId !== hymnId), { hymnId, title: hymn.title, at: Date.now() }]);
        // The history is for the record: a failed write is reported to the console and never holds up the song.
        if (!alreadyLive) bridge.quickLive.logSpontaneous({ songId: hymnId, title: hymn.title }).catch((err) => console.warn('[quick-live] the song could not be logged:', err));
        return true;
      } catch (err) {
        say({ hymnId, kind: 'failed', text: err instanceof Error ? err.message : 'The song could not be shown.' });
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [projectorOn, screens, say],
  );

  /**
   * Go Live for one song. `immediate` skips the confirm click: the keyboard shortcut and Shift + click use it. Without it, a click while
   * another slide is on air only arms the button, and the same click again within ARM_MS goes.
   */
  const goLive = useCallback(
    (hymnId: number, title: string, immediate = false) => {
      if (pendingId !== null) return;
      const needsConfirm = !immediate && somethingLive && liveHymnId !== hymnId;
      if (needsConfirm && armedId !== hymnId) {
        setArmedId(hymnId);
        window.clearTimeout(timers.current.arm);
        timers.current.arm = window.setTimeout(() => setArmedId(null), ARM_MS);
        return;
      }
      window.clearTimeout(timers.current.arm);
      setArmedId(null);
      void run(hymnId, title, liveHymnId === hymnId);
    },
    [armedId, liveHymnId, pendingId, run, somethingLive],
  );

  // A song edited while its cues are listed: the list follows the edit, and the stanza on screen is refreshed by the live-song watch.
  useEffect(() => {
    return bridge.lyrics.onChanged((id) => {
      if (cueRef.current?.id !== id) return;
      bridge.lyrics
        .getHymn(id)
        .then((fresh) => fresh && !fresh.deletedAt && setCue(fresh))
        .catch(() => undefined);
    });
  }, []);

  /** Shows one stanza of the cue song. It is a direct show, so the lineup's card and place are not touched. */
  const showStanza = useCallback((index: number) => {
    const hymn = cueRef.current;
    const frame = hymn ? stanzaFrame(hymn, index) : null;
    if (frame) dispatch({ type: 'projector/show', frame, source: 'DIRECT_DECK' });
  }, []);

  /** Moves the cue song by one stanza with words in it. At the first or last stanza it stays where it is. */
  const stepStanza = useCallback(
    (delta: 1 | -1) => {
      const hymn = cueRef.current;
      const frame = useLive.getState().state.projector.live;
      if (!hymn || frame.kind !== 'lyrics' || frame.song?.hymnId !== hymn.id) return;
      let i = frame.song.position + delta;
      while (i >= 0 && i < hymn.stanzas.length && hymn.stanzas[i].lyricsText.trim() === '') i += delta;
      if (i >= 0 && i < hymn.stanzas.length) showStanza(i);
    },
    [showStanza],
  );
  const nextStanza = useCallback(() => stepStanza(1), [stepStanza]);
  const prevStanza = useCallback(() => stepStanza(-1), [stepStanza]);

  // While the cue song is on air: Down / Right / Space next, Up / Left back, B black screen (again to lift it), Escape clears the screen.
  // It listens before the app's own keys (which step the lineup on Left and Right), and only when the key is not typing, not for a control
  // that uses it, not inside the result list (which has its own keys), and not under a dialog.
  useEffect(() => {
    if (!controlsActive) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (isTextEntry(target) || target?.closest('#pw-lib-panel, [role="tablist"]')) return;
      if (document.querySelector('[role="dialog"], dialog[open]')) return;
      const onButton = Boolean(target?.closest('button, a, [role="button"]'));
      let act: (() => void) | null = null;
      if (e.key === 'b' || e.key === 'B') act = () => dispatch({ type: 'projector/blackout' });
      else if (e.key === 'Escape' && !e.shiftKey) act = () => dispatch({ type: 'projector/clear' });
      else if (onAirStanza !== null) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || (e.key === ' ' && !onButton)) act = nextStanza;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') act = prevStanza;
      }
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [controlsActive, onAirStanza, nextStanza, prevStanza]);

  /** Brings the cue panel back into view and focuses it, for when the operator has scrolled away from it. */
  const focusCue = useCallback(() => {
    cuePanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    cuePanelRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * Whether the lower third on screen is the one Quick Live put up. 'on' means it is, and it is now no longer this panel's to manage; 'off'
   * means the operator has taken it down or something else is on, which is left as it is.
   */
  const takeDownBand = (state: ReturnType<typeof useLive.getState>['state']): 'on' | 'off' => {
    const mine = bandRef.current;
    bandRef.current = null;
    return mine && state.lowerThird.live && JSON.stringify(state.lowerThird.live) === JSON.stringify(mine) ? 'on' : 'off';
  };

  /**
   * Puts the lineup's slide that was on air back on the projector and on air in the lineup, as it was before the song from search.
   * 'none' means no lineup slide was parked (nothing to restore); 'missing' means it was, but the slide is gone.
   */
  const restoreLineup = useCallback((): { name: string } | 'none' | 'missing' => {
    const state = useLive.getState().state;
    const session = usePw.getState().session;
    if (!state.pw || state.pw.onAir || state.pw.segmentKey == null || !session) return 'none';
    const at = livePosition(session.segments, state.pw);
    const segment = at && session.segments[at.segment];
    const step = at && liveDeck(session)[at.segment]?.[at.slide];
    if (!at || !segment || !step) return 'missing';
    dispatch({ type: 'projector/show', frame: frameFor(segment, step), source: 'PW_SESSION' });
    dispatch({ type: 'pw/cursor', segmentKey: segment.key, slide: at.slide, now: Date.now() });
    // The song's band on screen is replaced by the segment's own, so the lower third names what is on air.
    if (takeDownBand(state) === 'on') {
      const hymnId = step.kind === 'slide' && step.slide.kind === 'lyrics' ? step.slide.hymnId : null;
      dispatch({ type: 'lowerThird/show', value: lowerThirdFor(session, segment, hymnId) });
    }
    return { name: segment.name };
  }, []);

  const resumeLineup = useCallback(() => {
    const result = restoreLineup();
    if (result === 'missing') say({ hymnId: -1, kind: 'failed', text: 'The lineup slide that was on air is not there any more.' });
    return typeof result === 'object';
  }, [restoreLineup, say]);

  /**
   * Leaves Quick Live in one step: the cue panel closes, and the projector goes back to the lineup slide that was on air before the song.
   * With no lineup slide to go back to, a screen that still shows this song is cleared instead. A screen that has moved on to something
   * else is left alone. The lineup's own slide replaces the song, so the screen never flashes blank on the way.
   */
  const exitQuickLiveAndRestore = useCallback(() => {
    const hymn = cueRef.current;
    if (!hymn) return;
    const state = useLive.getState().state;
    const f = state.projector.live;
    const showsSong = (x: typeof f | null | undefined) => x?.kind === 'lyrics' && x.song?.hymnId === hymn.id;
    const songUp = showsSong(f) || (f.kind === 'blackout' && showsSong(state.projector.beforeBlackout));
    const result = restoreLineup();
    if (typeof result === 'object') tell(`Returned to Lineup: ${result.name}`);
    else {
      if (songUp) dispatch({ type: 'projector/clear' });
      // With no lineup to go back to, the song's band goes with the song.
      if (takeDownBand(state) === 'on') dispatch({ type: 'lowerThird/clear' });
      tell(result === 'missing' ? 'Quick Live ended. The lineup slide that was on air is not there any more.' : 'Quick Live ended. The screen is clear.');
    }
    setCue(null);
  }, [restoreLineup, tell]);

  return {
    liveHymnId,
    armedId,
    pendingId,
    notice,
    offPlan,
    canResume,
    goLive,
    resumeLineup,
    dismissNotice: () => setNotice(null),
    // The cue panel: the song's stanzas, which one is on air, and how to move between them.
    cue,
    onAirStanza,
    blackedOut,
    cuePanelRef,
    showStanza,
    nextStanza,
    prevStanza,
    focusCue,
    closeCue: () => setCue(null),
    /** Takes a newer copy of the cue song (after a live edit), at once, so a stanza just added can be shown straight away. */
    adoptCue: (fresh: Hymn) => {
      if (cueRef.current?.id !== fresh.id) return;
      cueRef.current = fresh;
      setCue(fresh);
    },
    exitQuickLiveAndRestore,
    toast,
  };
}

export type QuickLive = ReturnType<typeof useQuickLiveController>;
