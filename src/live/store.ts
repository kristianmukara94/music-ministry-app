import { create } from 'zustand';
import { initialLiveState, type LiveAction, type LiveState } from '../../shared/live.js';
import { bridge } from './bridge';

/** Read-only mirror of the authoritative live state held by the main process. */
export const useLive = create<{ state: LiveState; ready: boolean }>(() => ({
  state: initialLiveState(),
  ready: false,
}));

bridge.getState().then((state) => useLive.setState({ state, ready: true }));
bridge.onState((state) => useLive.setState({ state }));

export const dispatch = (action: LiveAction) => bridge.dispatch(action);
