import { dispatch, useLive } from '../live/store';
import { massPartFrame } from '../liturgy/massOrder';
import { useUi, type HotkeyAction, type LaunchItem } from '../state/ui';
import { bridge } from '../live/bridge';
import type { LiveState } from '../../shared/live.js';
import { carouselPosition } from '../../shared/welcome-settings.js';
import { enterGoLiveFullscreen, exitGoLiveFullscreen } from '../golive/fullscreen';

const lang = () => useUi.getState().lang;

/** One place for every "go live" command, shared by the top bar, hotkeys, and palette. */
export const liveCommands: Record<HotkeyAction, () => void> = {
  // Announcements toggles like the welcome screen: on, it shows the announcements deck; while it is live, it clears the projector.
  announcements: () => {
    if (useLive.getState().state.projector.live.kind === 'announcements') dispatch({ type: 'projector/clear' });
    else dispatch({ type: 'projector/show', frame: { kind: 'announcements', lang: lang() }, source: 'DIRECT_DECK' });
  },
  // Welcome toggles: on, it shows the welcome screen; while it is live, it clears the projector (the same as F12). Over the Holy Mass or
  // Praise & Worship it is only an overlay: turning it off puts back the slide it covers. The press is sent as an explicit on or off (the
  // reducer's projector/welcome), so a double press read from a state that has not come back yet cannot flip it on and straight off again.
  welcome: () => {
    if (useLive.getState().state.projector.live.kind === 'welcome') {
      dispatch({ type: 'projector/welcome', on: false });
      return;
    }
    const now = Date.now();
    dispatch({ type: 'projector/welcome', on: true, frame: { kind: 'welcome', lang: lang(), shownAt: now, slide: 0, slideAt: now } });
  },
  // Blackout toggles. Over the Holy Mass it is only a cover, like the welcome screen: the queue keeps its place, and turning it off puts back
  // the slide it covers.
  blackout: () => dispatch({ type: 'projector/blackout' }),
  clear: () => dispatch({ type: 'projector/clear' }),
};

/**
 * Where the live welcome carousel is now: the slide on screen, how many there are, and how long until a timed slide moves on by
 * itself (null when it waits for the operator). Null while the welcome screen is not live. The top bar uses it for its slide counter.
 */
export function welcomeSlidePosition(
  live: LiveState['projector']['live'],
  slides: LiveState['welcome']['slides'],
  now: number,
): { index: number; count: number; remainingMs: number | null } | null {
  if (live.kind !== 'welcome' || slides.length === 0) return null;
  const { index, remainingMs } = carouselPosition(slides, live.slide ?? 0, now - (live.slideAt ?? live.shownAt ?? now));
  return { index, count: slides.length, remainingMs };
}

/**
 * Moves the live welcome carousel to the next slide, from wherever its timer has it now. The countdown keeps its start, so stepping never
 * restarts it. Over the Holy Mass or Praise & Worship the welcome screen stays an overlay (no source, so the queue or session keeps its place).
 */
export function stepWelcomeSlide() {
  const state = useLive.getState().state;
  const live = state.projector.live;
  const slides = state.welcome.slides;
  if (live.kind !== 'welcome' || slides.length < 2) return;
  const now = Date.now();
  const shownAt = live.shownAt ?? now;
  const { index } = carouselPosition(slides, live.slide ?? 0, now - (live.slideAt ?? shownAt));
  dispatch({ type: 'projector/show', frame: { ...live, shownAt, slide: (index + 1) % slides.length, slideAt: now } });
}

export function projectMassPart(id: string) {
  const frame = massPartFrame(id, lang());
  if (frame) dispatch({ type: 'projector/show', frame, source: 'DIRECT_DECK' });
}

export function runLaunchItem(item: LaunchItem) {
  if (item.kind === 'massPart') projectMassPart(item.target);
  else void bridge.open(item.target);
}

/**
 * The sidebar's Fullscreen and Ctrl+Shift+F. On the Go Live view they toggle Go Live Fullscreen Mode (window fullscreen plus the console
 * filling it), so the booth has one fullscreen, not two. Elsewhere they only make the window fullscreen.
 */
export function toggleFullscreen() {
  const { view, goLiveFullscreen } = useUi.getState();
  // The key always leaves fullscreen altogether: the mode, and the window too, even one already fullscreen before the mode began (the
  // mode's own Exit keeps that window fullscreen, but this is the fullscreen key). Otherwise a window made fullscreen on another view
  // could never be taken out of fullscreen with this key on Go Live: each press would only toggle the mode.
  if (goLiveFullscreen) {
    exitGoLiveFullscreen();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (view === 'goLive' && !document.fullscreenElement) return enterGoLiveFullscreen();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}
