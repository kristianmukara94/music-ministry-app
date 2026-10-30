import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '../../shared/live.js';
import { ACTION_IDS, DEFAULT_SHORTCUTS, sanitizeShortcuts, shortcutsFromKeymap, type Shortcut } from '../../shared/shortcuts.js';
import { DEFAULT_DISPLAY_NAMES } from './shortcut-labels';
import { DEFAULT_REGION_SETTINGS, type RegionSettings } from './region';

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
  | 'praiseWorship'
  | 'goLive'
  | 'settings';

/** The four actions the top bar and the original hotkeys drive. Shortcuts can run more: see src/operator/shortcuts.ts. */
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

interface UiState {
  lang: Lang;
  /** How times and dates are displayed. Saved with the other operator preferences. */
  region: RegionSettings;
  view: ViewKey;
  collapsed: boolean;
  paletteOpen: boolean;
  queueOpen: boolean;
  /** The floating live preview is on screen. Toggled by the Preview button in the top bar. */
  previewOpen: boolean;
  capturingHotkey: boolean;
  /** The keyboard shortcuts. One per action, each with the key combo that runs it. */
  shortcuts: Shortcut[];
  launchpad: LaunchItem[];
  pendingFocus: PendingFocus | null;
  /** Shown when a queue item is played while the projector is off. Not persisted. */
  projectorPrompt: ProjectorPrompt | null;
  /** The choice made for the projector prompt in this session. Reset to 'ask' when the projector turns on, or a new queue or session loads. */
  projectorPromptChoice: ProjectorPromptChoice;
  /** The Go Live hub's date and the entry chosen for it. Transient: a restart returns the hub to today. */
  goLiveDate: string;
  goLiveChoice: GoLiveChoice | null;
  /** A Mass plan the Go Live hub asked to open. The Mass planner takes it on mount, through its own plan loader. */
  pendingMassPlanId: number | null;
  /** The Text Slide editor's style panel is open. Kept for the session only: it is not persisted, so a restart closes it. */
  slideStyleOpen: boolean;
  /** The Song Lyrics verse list shows every verse, not just the live and next one. Kept for the session only, not persisted. */
  showAllVerses: boolean;
}

/** The entry the Go Live hub has chosen: a Mass plan, or a Praise & Worship session, by its id in its own module. */
export interface GoLiveChoice {
  kind: 'mass' | 'pw';
  id: number;
}

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * What the operator chose when a live launch found the projector off. 'ask' shows the prompt, 'skip' goes live in the app
 * only, and 'projector' asks again. Held in memory for the session: it is not persisted.
 */
export type ProjectorPromptChoice = 'ask' | 'skip' | 'projector';

export interface ProjectorPrompt {
  /** The queue item that was played. */
  label: string;
  /** Turns the projector on, then puts the item on the screen. */
  turnOnAndGo: () => void;
  /**
   * Puts the item live without opening the projector: the in-app preview shows it, and no projector window opens.
   * Only offered where the item can go live that way (a Mass Queue item).
   */
  skip?: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (): UiState => ({
      lang: 'en',
      region: DEFAULT_REGION_SETTINGS,
      view: 'dashboard',
      collapsed: false,
      paletteOpen: false,
      queueOpen: false,
      previewOpen: false,
      capturingHotkey: false,
      shortcuts: DEFAULT_SHORTCUTS,
      launchpad: [],
      pendingFocus: null,
      projectorPrompt: null,
      projectorPromptChoice: 'ask',
      slideStyleOpen: false,
      goLiveDate: todayIso(),
      goLiveChoice: null,
      pendingMassPlanId: null,
      showAllVerses: false,
    }),
    {
      name: 'apccmma.ui',
      // Only operator preferences survive restarts; transient UI does not.
      partialize: ({ lang, region, collapsed, shortcuts, launchpad }) => ({ lang, region, collapsed, shortcuts, launchpad }),
      // Version 0 kept one key per action under `keymap`. Version 1 keeps a list of shortcuts that can be added to and removed.
      version: 1,
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Record<string, unknown>;
        if (version >= 1) return old as unknown as UiState;
        const { keymap, ...rest } = old;
        return { ...rest, shortcuts: shortcutsFromKeymap(keymap, DEFAULT_DISPLAY_NAMES) } as unknown as UiState;
      },
      // A damaged saved list must not leave the operator without shortcuts, or with two on one key.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState>;
        const shortcuts = Array.isArray(saved.shortcuts) ? sanitizeShortcuts(saved.shortcuts, [...ACTION_IDS]) : current.shortcuts;
        return { ...current, ...saved, shortcuts };
      },
    },
  ),
);

export const setUi = useUi.setState;

export function exportSettings() {
  const { lang, shortcuts, launchpad } = useUi.getState();
  const blob = new Blob([JSON.stringify({ app: 'apccmma', version: 2, lang, shortcuts, launchpad }, null, 2)], {
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
    // A file from before shortcuts could be added carries a one-key-per-action `keymap`.
    shortcuts: Array.isArray(data.shortcuts)
      ? sanitizeShortcuts(data.shortcuts, [...ACTION_IDS])
      : data.keymap
        ? shortcutsFromKeymap(data.keymap, DEFAULT_DISPLAY_NAMES)
        : useUi.getState().shortcuts,
    launchpad: Array.isArray(data.launchpad) ? data.launchpad : [],
  });
}
