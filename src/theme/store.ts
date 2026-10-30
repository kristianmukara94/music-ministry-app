import { create } from 'zustand';
import { bridge } from '../live/bridge';
import { applyTheme, isThemeId, type ThemeId } from './themes';

interface ThemeState {
  theme: ThemeId;
  /** Applies a theme at once, then saves it. If saving fails, the previous theme comes back. */
  setTheme: (id: ThemeId) => Promise<void>;
  /** Used once at launch, with the saved theme. Applies it without saving again. */
  hydrate: (id: ThemeId) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: 'obsidian',

  setTheme: async (id) => {
    if (!isThemeId(id) || id === get().theme) return;
    const previous = get().theme;
    set({ theme: id });
    applyTheme(id);
    try {
      await bridge.config.setTheme(id);
    } catch (err) {
      set({ theme: previous });
      applyTheme(previous);
      throw err;
    }
  },

  hydrate: (id) => {
    const theme = isThemeId(id) ? id : 'obsidian';
    set({ theme });
    applyTheme(theme);
  },
}));
