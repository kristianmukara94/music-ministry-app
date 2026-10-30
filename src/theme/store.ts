import { create } from 'zustand';
import { bridge } from '../live/bridge';
import { applyTheme, isThemeId, resolvedTheme, type ThemeId } from './themes';

interface ThemeState {
  theme: ThemeId;
  /** Applies a theme at once, then saves it. If saving fails, the previous theme comes back. */
  setTheme: (id: ThemeId) => Promise<void>;
  /** Used once at launch, with the saved theme. Applies it without saving again. */
  hydrate: (id: ThemeId) => void;
}

/** The theme the document is painted with right now. Differs from the chosen theme only in Automatic mode. */
let painted: string | null = null;
let midnightTimer: number | undefined;

/** Paints a theme and remembers what it painted, so a season change can be told from a no-op. */
function paint(id: ThemeId) {
  painted = resolvedTheme(id);
  applyTheme(id);
}

/** Re-resolves Automatic against today's date. Repaints, and refreshes the title-bar buttons, only if the season changed. */
function refreshSeason(get: () => ThemeState) {
  const { theme } = get();
  if (theme !== 'season-auto' || resolvedTheme(theme) === painted) return;
  paint(theme);
  // The main process recolours the window's caption buttons for the new season. Saving the same id again is harmless.
  bridge.config.setTheme(theme).catch(() => undefined);
}

/** In Automatic mode, wakes at each local midnight, and whenever the window comes back to the front after sleep. */
function watchSeason(get: () => ThemeState) {
  window.clearTimeout(midnightTimer);
  if (get().theme !== 'season-auto') return;
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  midnightTimer = window.setTimeout(() => {
    refreshSeason(get);
    watchSeason(get);
  }, nextMidnight.getTime() - now.getTime());
}

export const useTheme = create<ThemeState>((set, get) => {
  // A sleeping computer's timers do not fire on time, so check again when the window is used.
  window.addEventListener('focus', () => {
    refreshSeason(get);
    watchSeason(get);
  });

  return {
    theme: 'obsidian',

    setTheme: async (id) => {
      if (!isThemeId(id) || id === get().theme) return;
      const previous = get().theme;
      set({ theme: id });
      paint(id);
      watchSeason(get);
      try {
        await bridge.config.setTheme(id);
      } catch (err) {
        set({ theme: previous });
        paint(previous);
        watchSeason(get);
        throw err;
      }
    },

    hydrate: (id) => {
      const theme = isThemeId(id) ? id : 'obsidian';
      set({ theme });
      paint(theme);
      watchSeason(get);
    },
  };
});
