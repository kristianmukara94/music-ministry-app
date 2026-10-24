import { dispatch } from '../live/store';
import { massPartFrame } from '../liturgy/massOrder';
import { useUi, type HotkeyAction, type LaunchItem } from '../state/ui';
import { bridge } from '../live/bridge';

const lang = () => useUi.getState().lang;

/** One place for every "go live" command, shared by the top bar, hotkeys, and palette. */
export const liveCommands: Record<HotkeyAction, () => void> = {
  announcements: () => dispatch({ type: 'projector/show', frame: { kind: 'announcements', lang: lang() }, source: 'DIRECT_DECK' }),
  welcome: () => dispatch({ type: 'projector/show', frame: { kind: 'welcome', lang: lang() }, source: 'DIRECT_DECK' }),
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
