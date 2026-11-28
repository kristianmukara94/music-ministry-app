import { createSharedPoll } from '../../shared/polling.js';
import { bridge, type RemoteViewStatus } from '../live/bridge';

/**
 * The Remote view status, read once for everything that shows it (the top bar pill and the dashboard's checks).
 *
 * It keeps running while the window is hidden, on purpose: each read also makes the main process start a viewer that is turned on once a
 * network appears (remoteView:get), so phones and the TV come back by themselves while the console is minimised.
 */
export const remoteStatusPoll = createSharedPoll<RemoteViewStatus>({ read: () => bridge.remoteView.get(), intervalMs: 3000 });
