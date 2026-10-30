import { dispatch, useLive } from '../live/store';
import { stepLive } from '../praise-worship/live';
import { setUi, type ViewKey } from '../state/ui';
import { liveCommands } from './actions';
import { ACTION_IDS, type Shortcut } from '../../shared/shortcuts.js';

export type ShortcutActionId = (typeof ACTION_IDS)[number];

type LiveState = ReturnType<typeof useLive.getState>['state'];

export interface ShortcutAction {
  id: ShortcutActionId;
  label: string;
  description: string;
  run: () => void;
  /** Whether the thing this action puts on air is showing now. Drives the gold keycap. */
  isActive?: (s: LiveState) => boolean;
}

/** The step keys move through the Praise & Worship lineup while it is on air, and through the projector's slides otherwise. */
function step(delta: 1 | -1) {
  if (useLive.getState().state.pw?.onAir) void stepLive(delta);
  else dispatch({ type: 'projector/step', delta });
}

const openView = (view: ViewKey) => () => setUi({ view });

/** Every action a shortcut can run. Keyed by id, so an id missing from (or extra to) shared/shortcuts.js fails to compile. */
const ACTIONS: Record<ShortcutActionId, Omit<ShortcutAction, 'id'>> = {
  announcements: { label: 'Announcements', description: 'Show the announcements deck', run: liveCommands.announcements, isActive: (s) => s.projector.live.kind === 'announcements' },
  welcome: { label: 'Welcome Screen', description: 'Show or clear the welcome screen', run: liveCommands.welcome, isActive: (s) => s.projector.live.kind === 'welcome' },
  blackout: { label: 'Black Screen', description: 'Black out the projector', run: liveCommands.blackout, isActive: (s) => s.projector.live.kind === 'blackout' },
  clear: { label: 'Clear Projector', description: 'Take everything off the projector', run: liveCommands.clear },
  lowerThird: { label: 'Toggle Lower 3rd', description: 'Show or hide the lower third', run: () => dispatch({ type: 'lowerThird/toggle' }), isActive: (s) => s.lowerThird.live !== null },
  stop: { label: 'Stop', description: 'Same as the Stop button in the top bar', run: () => dispatch({ type: 'stop' }) },
  pauseProjector: { label: 'Pause Projector', description: 'Freeze or resume the projector', run: () => dispatch({ type: 'projector/pause' }), isActive: (s) => s.projector.paused },
  pauseLowerThird: { label: 'Pause Lower 3rd', description: 'Freeze or resume the lower third', run: () => dispatch({ type: 'lowerThird/pause' }), isActive: (s) => s.lowerThird.paused },
  nextSlide: { label: 'Next Slide', description: 'Step forward through the live slides', run: () => step(1) },
  prevSlide: { label: 'Previous Slide', description: 'Step back through the live slides', run: () => step(-1) },
  goLive: { label: 'Go Live', description: 'Open the Go Live hub', run: openView('goLive') },
  openLectionary: { label: 'Open Lectionary', description: "Jump to today's readings", run: openView('lectionary') },
  openHymns: { label: 'Open Hymns Library', description: 'Jump to Song Lyrics', run: openView('lyrics') },
  openMedia: { label: 'Open Media Library', description: 'Jump to the Media Library', run: openView('media') },
};

/** The actions in picker order. */
export const SHORTCUT_ACTIONS: ShortcutAction[] = ACTION_IDS.map((id) => ({ id, ...ACTIONS[id] }));

const BY_ID = new Map<string, ShortcutAction>(SHORTCUT_ACTIONS.map((a) => [a.id, a]));

export const actionById = (id: string): ShortcutAction | undefined => BY_ID.get(id);

/** Runs the action behind a shortcut. An unknown action does nothing. */
export function runShortcut(shortcut: Pick<Shortcut, 'actionId'>) {
  BY_ID.get(shortcut.actionId)?.run();
}

/** The label of each action, for turning saved one-key-per-action settings into shortcuts. */
export const ACTION_LABELS: Record<string, string> = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.label]));
