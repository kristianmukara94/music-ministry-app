import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '../../shared/live.js';

export type ViewKey =
  | 'dashboard'
  | 'announcements'
  | 'lectionary'
  | 'bible'
  | 'rosary'
  | 'media'
  | 'notes'
  | 'lyrics'
  | 'whiteboard'
  | 'planner'
  | 'settings';

export type HotkeyAction = 'announcements' | 'welcome' | 'blackout' | 'clear';

export interface LaunchItem {
  id: string;
  label: string;
  kind: 'open' | 'massPart';
  /** URL / file path for `open`, mass part id for `massPart`. */
  target: string;
}

/**
 * A request from the Service Queue to open a module on a specific item. The module
 * consumes it on mount and clears it, so it fires once.
 */
export type PendingFocus =
  | { kind: 'hymn'; id: number }
  | { kind: 'slide'; id: number }
  | { kind: 'media'; id: number }
  | { kind: 'reading'; date: string; readingType: string };

export const DEFAULT_KEYMAP: Record<HotkeyAction, string> = {
  announcements: 'F9',
  welcome: 'F10',
  blackout: 'F11',
  clear: 'F12',
};

interface UiState {
  lang: Lang;
  view: ViewKey;
  collapsed: boolean;
  paletteOpen: boolean;
  queueOpen: boolean;
  /** The floating live preview is on screen. Toggled by the Preview button in the top bar. */
  previewOpen: boolean;
  capturingHotkey: boolean;
  keymap: Record<HotkeyAction, string>;
  launchpad: LaunchItem[];
  pendingFocus: PendingFocus | null;
  /** Shown when a queue item is played while the projector is off. Not persisted. */
  projectorPrompt: ProjectorPrompt | null;
}

export interface ProjectorPrompt {
  /** The queue item that was played. */
  label: string;
  /** Turns the projector on, then puts the item on the screen. */
  turnOnAndGo: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (): UiState => ({
      lang: 'en',
      view: 'dashboard',
      collapsed: false,
      paletteOpen: false,
      queueOpen: false,
      previewOpen: false,
      capturingHotkey: false,
      keymap: DEFAULT_KEYMAP,
      launchpad: [],
      pendingFocus: null,
      projectorPrompt: null,
    }),
    {
      name: 'apccmma.ui',
      // Only operator preferences survive restarts; transient UI does not.
      partialize: ({ lang, collapsed, keymap, launchpad }) => ({ lang, collapsed, keymap, launchpad }),
    },
  ),
);

export const setUi = useUi.setState;

export function exportSettings() {
  const { lang, keymap, launchpad } = useUi.getState();
  const blob = new Blob([JSON.stringify({ app: 'apccmma', version: 1, lang, keymap, launchpad }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `apccmma-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importSettings(file: File) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'apccmma') throw new Error('Not an APCCMMA settings file');
  setUi({
    lang: ['en', 'tl', 'ceb'].includes(data.lang) ? data.lang : useUi.getState().lang,
    keymap: { ...DEFAULT_KEYMAP, ...data.keymap },
    launchpad: Array.isArray(data.launchpad) ? data.launchpad : [],
  });
}
