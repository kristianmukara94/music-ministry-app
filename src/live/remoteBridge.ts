import { dispatch, useLive } from './store';
import { useUi } from '../state/ui';
import type { RemoteCommand } from '../../shared/live.js';

/**
 * Carries out the commands phones send from the Remote view, in the operator window. A panel with its own stepping (the Rosary) registers a
 * handler while it is open, so a phone moves it exactly as the panel's own buttons do. A panel that steps with the keyboard gets the same
 * key its own hotkeys use, so Next and Previous work in every panel without each one needing a handler.
 */
type Handler = (command: RemoteCommand) => void;
let handler: Handler | null = null;

/** Registers the open panel's handler. Returns the function that removes it, which the panel calls when it closes. */
export function registerRemoteHandler(next: Handler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

// The keys each panel steps with, and the frame its slides are shown as. A phone only moves a panel whose slides are on the projector.
const PANEL_KEYS: Record<string, { frame: string[]; next: string; prev: string }> = {
  lyrics: { frame: ['lyrics'], next: ' ', prev: 'ArrowUp' },
  announcements: { frame: ['text', 'image'], next: 'ArrowRight', prev: 'ArrowLeft' },
  notes: { frame: ['text'], next: 'ArrowRight', prev: 'ArrowLeft' },
};

/** Sends a key press to the page, as if the operator typed it. It goes to the body, so a panel that ignores typing in a field ignores it too. */
function press(key: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function run(command: RemoteCommand) {
  if (handler) {
    handler(command);
    return;
  }
  if (command.action !== 'step') return;
  const view = useUi.getState().view;
  const keys = PANEL_KEYS[view];
  if (!keys || !keys.frame.includes(useLive.getState().state.projector.live.kind)) return;
  press(command.delta === 1 ? keys.next : keys.prev);
}

/** Listens for phone commands for as long as the operator window is open. */
export function watchRemoteCommands(): () => void {
  let seen = useLive.getState().state.remoteCmd?.seq ?? 0;
  return useLive.subscribe((next) => {
    const cmd = next.state.remoteCmd;
    if (!cmd || cmd.seq === seen) return;
    seen = cmd.seq;
    const { seq: _seq, ...command } = cmd;
    run(command);
  });
}

/** Publishes what the open panel offers a phone, or clears it. */
export function publishRemotePanel(panel: Extract<Parameters<typeof dispatch>[0], { type: 'remote/panel' }>['panel']) {
  dispatch({ type: 'remote/panel', panel });
}
