import { dispatch, useLive } from '../live/store';
import { massPartFrame } from '../liturgy/massOrder';
import { useUi, type HotkeyAction, type LaunchItem } from '../state/ui';
import { bridge } from '../live/bridge';
import { welcomeOverMass, welcomeOverPw } from '../../shared/live.js';

const lang = () => useUi.getState().lang;

/** One place for every "go live" command, shared by the top bar, hotkeys, and palette. */
export const liveCommands: Record<HotkeyAction, () => void> = {
  announcements: () => dispatch({ type: 'projector/show', frame: { kind: 'announcements', lang: lang() }, source: 'DIRECT_DECK' }),
  // Welcome toggles: on, it shows the welcome screen; while it is live, it clears the projector (the same as F12). Over the Holy Mass or
  // Praise & Worship it is only an overlay: turning it off puts back the slide it covers.
  welcome: () => {
    const state = useLive.getState().state;
    if (welcomeOverMass(state)) dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
    else if (welcomeOverPw(state)) dispatch({ type: 'projector/take', source: 'PW_SESSION' });
    else if (state.projector.live.kind === 'welcome') dispatch({ type: 'projector/clear' });
    else dispatch({ type: 'projector/show', frame: { kind: 'welcome', lang: lang() }, source: 'DIRECT_DECK' });
  },
  // Blackout toggles. Over the Holy Mass it is only a cover, like the welcome screen: the queue keeps its place, and turning it off puts back
  // the slide it covers.
  blackout: () => dispatch({ type: 'projector/blackout' }),
  clear: () => dispatch({ type: 'projector/clear' }),
};

export function projectMassPart(id: string) {
  const frame = massPartFrame(id, lang());
  if (frame) dispatch({ type: 'projector/show', frame, source: 'DIRECT_DECK' });
}

export function runLaunchItem(item: LaunchItem) {
  if (item.kind === 'massPart') projectMassPart(item.target);
  else void bridge.open(item.target);
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}
