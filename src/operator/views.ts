// The console's pages other than the Service Console. Each is read when first opened, and all of them quietly once the console is up, so
// the first click on any page during a service is immediate.
import { prefetchWhenIdle } from '../../shared/idle-prefetch.js';
import { lazyView } from '../system/lazyView';

export const GoLiveConsole = lazyView(() => import('../golive/GoLiveConsole').then((m) => m.GoLiveConsole));
export const PlannerView = lazyView(() => import('../planner/PlannerView').then((m) => m.PlannerView));
export const SongLyrics = lazyView(() => import('../lyrics/SongLyrics').then((m) => m.SongLyrics));
export const LectionaryDeck = lazyView(() => import('../lectionary/LectionaryDeck').then((m) => m.LectionaryDeck));
export const BibleDeck = lazyView(() => import('../bible/BibleDeck').then((m) => m.BibleDeck));
export const NotesPrayersView = lazyView(() => import('../notes/NotesPrayersView').then((m) => m.NotesPrayersView));
export const MediaView = lazyView(() => import('../media/MediaView').then((m) => m.MediaView));
export const UnifiedDeckView = lazyView(() => import('../whiteboard/UnifiedDeckView').then((m) => m.UnifiedDeckView));
export const RosaryDeck = lazyView(() => import('../rosary/RosaryDeck').then((m) => m.RosaryDeck));
export const Settings = lazyView(() => import('../settings/Settings').then((m) => m.Settings));

/** In the order a service is likely to want them. */
const ALL = [GoLiveConsole, PlannerView, SongLyrics, LectionaryDeck, BibleDeck, NotesPrayersView, MediaView, UnifiedDeckView, RosaryDeck, Settings];

/** Starts well after the console is up, so it never competes with the launch. */
const PREFETCH_DELAY_MS = 1500;

export function prefetchViews() {
  return prefetchWhenIdle(
    ALL.map((view) => view.preload),
    {
      delayMs: PREFETCH_DELAY_MS,
      // The timeout makes sure a busy console still gets every page read in the end.
      idle: (callback) => window.requestIdleCallback(callback, { timeout: 2000 }),
      cancelIdle: (handle) => window.cancelIdleCallback(handle),
    },
  );
}
