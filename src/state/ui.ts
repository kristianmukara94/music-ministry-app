import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '../../shared/live.js';
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
  /** How times and dates are displayed. Saved with the other operator preferences. */
  region: RegionSettings;
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
      keymap: DEFAULT_KEYMAP,
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
      partialize: ({ lang, region, collapsed, keymap, launchpad }) => ({ lang, region, collapsed, keymap, launchpad }),
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
