import { create } from 'zustand';
import type { Frame, LiveState } from '../../shared/live.js';
import { quickLiveExit, quickLiveSession, type QuickLiveSession } from '../../shared/quick-live.js';
import { dispatch, useLive } from '../live/store';

/**
 * The Quick-Live Mini Output Preview's session: the library item a LIVE press put on the projector, and the main run it parked. Null while the
 * popup is closed. Kept apart from the persisted UI store, so a restart never reopens it.
 */
export const useQuickLivePreview = create<{ session: QuickLiveSession | null }>(() => ({ session: null }));

/**
 * Opens the popup for an item that just went live. `before` is the live state read before the LIVE press dispatched anything, so the run
 * that was on air is the one Return to Main Live puts back. A LIVE press while the popup is open replaces the item and keeps that run.
 */
export function openQuickLivePreview(before: LiveState, item: { title: string; frames: Frame[] }): void {
  if (item.frames.length === 0) return;
  const previous = useQuickLivePreview.getState().session;
  useQuickLivePreview.setState({ session: quickLiveSession(before, item, previous) });
}

/** Closes the popup and leaves the projector as it is (the top bar's Back to Main Live has already put the run back). */
export function closeQuickLivePreview(): void {
  if (useQuickLivePreview.getState().session) useQuickLivePreview.setState({ session: null });
}

/**
 * Leaves the popup (Return to Main Live / End Live & Close, the × and Escape): the parked run goes back on air at its slide, or with nothing
 * parked the item comes off the screen. `restore` is the Back to Main Live restore (mainLive.ts), passed in so this module stays free of it.
 */
export async function exitQuickLivePreview(restore: () => Promise<void>): Promise<void> {
  const session = useQuickLivePreview.getState().session;
  closeQuickLivePreview();
  const exit = quickLiveExit(session, useLive.getState().state);
  if (exit === 'restore') await restore();
  else if (exit === 'clear') dispatch({ type: 'projector/clear' });
}
