import { dispatch, useLive } from '../live/store';
import { massPartFrame } from '../liturgy/massOrder';
import { useUi, type HotkeyAction, type LaunchItem } from '../state/ui';
import { bridge } from '../live/bridge';

const lang = () => useUi.getState().lang;

/** One place for every "go live" command, shared by the top bar, hotkeys, and palette. */
export const liveCommands: Record<HotkeyAction, () => void> = {
  announcements: () => dispatch({ type: 'projector/show', frame: { kind: 'announcements', lang: lang() }, source: 'DIRECT_DECK' }),
  // Welcome toggles: on, it shows the welcome screen; while it is live, it clears the projector (the same as F12).
  welcome: () => {
    if (useLive.getState().state.projector.live.kind === 'welcome') dispatch({ type: 'projector/clear' });
    else dispatch({ type: 'projector/show', frame: { kind: 'welcome', lang: lang() }, source: 'DIRECT_DECK' });
  },
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
