import {
  initialLiveState,
  liveReducer,
  OUTPUTS,
  type LiveAction,
  type LiveState,
  type OutputKey,
} from '../../shared/live.js';
import type { AnnouncementApi } from '../announcements/types';
import type { BibleApi } from '../bible/types';
import type { RosaryApi } from '../rosary/types';
import type { LyricsApi } from '../lyrics/types';
import type { LectionaryApi } from '../lectionary/types';
import type { MediaApi, ThumbnailJob } from '../media/types';
import type { PlansApi } from '../planner/types';
import type { NotesApi } from '../notes/types';
import type { ProjectorSettings } from '../../shared/projector-settings';
import type { WelcomeSettings } from '../../shared/welcome-settings';
import type { LowerThirdStyle } from '../../shared/lower-third-style';
import type { WhiteboardApi } from '../whiteboard/types';
import type { ConfigApi, UpdatesApi } from '../settings/types';

export interface PdfJob {
  jobId: string;
  bytes: Uint8Array;
}

export interface PdfResult {
  jobId: string;
  pages?: { jpeg: Uint8Array; text: string }[];
  error?: string;
}

/** A connected display. `index` is the number the identify overlay shows on it. */
export interface DisplayInfo {
  id: number;
  index: number;
  width: number;
  height: number;
  primary: boolean;
  /** The monitor's name as the system reports it, or an empty string. */
  label: string;
  /** Top-left corner on the virtual desktop. */
  x: number;
  y: number;
}

export interface DisplaysApi {
  list(): Promise<DisplayInfo[]>;
  identify(): Promise<void>;
}

export interface ProjectorApi {
  save(patch: Partial<ProjectorSettings>): Promise<ProjectorSettings>;
}

/** The welcome screen's content and style. Saved in config.json. */
export interface WelcomeApi {
  save(patch: Partial<WelcomeSettings>): Promise<WelcomeSettings>;
}

/** The lower third's look and window target, and where the browser source is. */
export interface LowerThirdApi {
  save(patch: Partial<LowerThirdStyle>): Promise<LowerThirdStyle>;
  info(): Promise<{ port: number; local: string; lan: string | null }>;
}

interface ElectronApi {
  /** Native path of a file dropped on the window. The browser never exposes it, so drops only work in the desktop app. */
  files: { pathFor(file: File): string };
  getState(): Promise<LiveState>;
  dispatch(action: LiveAction): void;
  onState(callback: (state: LiveState) => void): () => void;
  open(target: string): Promise<unknown>;
  announcements: AnnouncementApi;
  lyrics: LyricsApi;
  lectionary: LectionaryApi;
  bible: BibleApi;
  rosary: RosaryApi;
  media: MediaApi;
  plans: PlansApi;
  notes: NotesApi;
  displays: DisplaysApi;
  projector: ProjectorApi;
  welcome: WelcomeApi;
  lowerThird: LowerThirdApi;
  whiteboard: WhiteboardApi;
  config: ConfigApi;
  updates: UpdatesApi;
  /** Used only by the hidden `thumbnailer` window. */
  thumb: {
    onJob(callback: (job: ThumbnailJob) => void): () => void;
    finish(result: { jobId: string; jpeg?: Uint8Array; error?: string }): void;
  };
  /** Used only by the hidden `pdf-converter` window. */
  pdf: {
    onConvert(callback: (job: PdfJob) => void): () => void;
    finish(result: PdfResult): void;
  };
}

declare global {
  interface Window {
    apcc?: ElectronApi;
  }
}

export interface LiveBridge extends ElectronApi {
  isElectron: boolean;
}

export const OUTPUT_ROUTES: Record<OutputKey, string> = {
  projector: 'projector',
  lowerThird: 'lower-third',
  preview: 'preview',
};

const offlineError = () => {
  throw new Error('Open the desktop app to use Announcements.');
};

/** A plain browser has no file system, so the Announcements module renders empty. */
const offlineAnnouncements: AnnouncementApi = {
  folders: async () => ({ folders: [], total: 0 }),
  slides: async () => [],
  createFolder: async () => offlineError(),
  renameFolder: async () => offlineError(),
  deleteFolder: async () => offlineError(),
  importSlides: async () => offlineError(),
  importPaths: async () => offlineError(),
  reorder: async () => offlineError(),
  deleteSlide: async () => offlineError(),
  pickBackground: async () => offlineError(),
  discardBackground: async () => true,
  createTextSlides: async () => offlineError(),
};

const offlinePdf = { onConvert: () => () => undefined, finish: () => undefined };

/** Browser preview: no database, so the badge reports it as not connected. */
const offlineConfig: ConfigApi = {
  get: async () => ({
    config: { database_path: null, default_language: 'en', theme: 'default' },
    databasePath: 'Browser preview (no database)',
    defaultDatabasePath: 'Browser preview (no database)',
    assetsPath: 'Browser preview (no media folder)',
    status: { connected: false, path: null, fallback: false, error: 'Browser preview: open the desktop app.' },
    version: __APP_VERSION__,
  }),
  onMigrationProgress: () => () => undefined,
  setLanguage: async () => offlineError(),
  // Browser preview has nowhere to save; the theme still applies for the session.
  setTheme: async (theme) => theme,
  changeLocation: async () => offlineError(),
  backup: async () => offlineError(),
};

/** Browser preview: updates come from the desktop app, so checks report that instead of failing silently. */
const offlineUpdates: UpdatesApi = {
  getState: async () => ({ last: null, lastCheckedAt: null }),
  check: async () => offlineError(),
  download: async () => offlineError(),
  restart: async () => offlineError(),
  onEvent: () => () => undefined,
};

const offlinePlans: PlansApi = {
  list: async () => [],
  create: async () => offlineError(),
  deletePlan: async () => offlineError(),
  get: async () => offlineError(),
  save: async () => offlineError(),
};

const offlineNotes: NotesApi = {
  list: async () => [],
  get: async () => null,
  save: async () => offlineError(),
  remove: async () => offlineError(),
};

const offlineDisplays: DisplaysApi = {
  list: async () => [],
  identify: async () => offlineError(),
};

const offlineWhiteboard: WhiteboardApi = {
  list: async () => [],
  save: async () => offlineError(),
  remove: async () => offlineError(),
  reorder: async () => offlineError(),
  importPowerPoint: async () => offlineError(),
};

const offlineLowerThird: LowerThirdApi = {
  save: async () => offlineError(),
  info: async () => ({ port: 3002, local: 'http://127.0.0.1:3002/lower-third', lan: null }),
};

const offlineProjector: ProjectorApi = {
  save: async () => offlineError(),
};

const offlineWelcome: WelcomeApi = {
  save: async () => offlineError(),
};

const offlineMedia: MediaApi = {
  list: async () => [],
  importMedia: async () => offlineError(),
  deleteMedia: async () => offlineError(),
  rename: async () => offlineError(),
  reveal: async () => offlineError(),
  onEvent: () => () => undefined,
};

const offlineLyrics: LyricsApi = {
  listHymns: async () => [],
  getHymn: async () => null,
  createHymn: async () => offlineError(),
  deleteHymn: async () => offlineError(),
  listSetlists: async () => [],
  createSetlist: async () => offlineError(),
  deleteSetlist: async () => offlineError(),
  getSetlist: async () => [],
  saveSetlist: async () => offlineError(),
  setStyle: async () => offlineError(),
  editHymn: async () => offlineError(),
};

const offlineLectionary: LectionaryApi = {
  getDay: async (date) => ({ date, seasonInfo: '', readings: [] }),
  saveReading: async () => offlineError(),
  clearReading: async () => offlineError(),
  setSeasonInfo: async () => offlineError(),
};

/** Browser preview has no rosary data, so the module shows its "not installed" message. */
const offlineRosary: RosaryApi = {
  getMysteries: async () => [],
  getPrayers: async () => [],
  saveMystery: async () => offlineError(),
  savePrayer: async () => offlineError(),
  exportJSON: async () => offlineError(),
  importJSON: async () => offlineError(),
};

/** Browser preview has no Bible data, so the module shows its "not installed" message. */
const offlineBible: BibleApi = {
  getTranslations: async () => [],
  getBooks: async () => [],
  getChapters: async () => [],
  getVerses: async () => [],
  search: async () => [],
};

/**
 * Browser fallback (`npm run dev:web`): tabs share state over BroadcastChannel
 * and output "windows" are popups. Lets you design without launching Electron.
 */
function createBrowserBridge(): LiveBridge {
  const KEY = 'apccmma.live';
  const channel = new BroadcastChannel('apccmma-live');
  const listeners = new Set<(s: LiveState) => void>();
  const popups: Partial<Record<OutputKey, Window | null>> = {};

  // A restored state keeps its plan and output, but starts with nothing selected in the Mass Queue and no projection source.
  const restore = (saved: LiveState | null): LiveState => {
    if (!saved) return initialLiveState();
    return { ...saved, queueCursor: -1, projector: { ...saved.projector, source: null } };
  };
  let state: LiveState;
  try {
    state = restore(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    state = initialLiveState();
  }

  const publish = (next: LiveState) => {
    state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: state still lives in memory */
    }
    listeners.forEach((l) => l(next));
  };

  channel.onmessage = (event: MessageEvent<LiveState>) => publish(event.data);

  const syncPopups = (prev: LiveState, next: LiveState) => {
    for (const key of OUTPUTS) {
      if (!prev.outputs[key] && next.outputs[key]) {
        popups[key] = window.open(`#/${OUTPUT_ROUTES[key]}`, `apcc-${key}`, 'popup,width=960,height=540');
      } else if (prev.outputs[key] && !next.outputs[key]) {
        popups[key]?.close();
        popups[key] = null;
      }
    }
  };

  return {
    isElectron: false,
    getState: async () => state,
    dispatch(action) {
      const next = liveReducer(state, action);
      if (next === state) return;
      syncPopups(state, next);
      publish(next);
      channel.postMessage(next);
    },
    onState(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    open: async (target) => window.open(target, '_blank', 'noopener'),
    announcements: offlineAnnouncements,
    files: { pathFor: offlineError },
    pdf: offlinePdf,
    lyrics: offlineLyrics,
    lectionary: offlineLectionary,
    bible: offlineBible,
    rosary: offlineRosary,
    media: offlineMedia,
    plans: offlinePlans,
    notes: offlineNotes,
    displays: offlineDisplays,
    projector: offlineProjector,
    welcome: offlineWelcome,
    lowerThird: offlineLowerThird,
    whiteboard: offlineWhiteboard,
    config: offlineConfig,
    updates: offlineUpdates,
    thumb: { onJob: () => () => undefined, finish: () => undefined },
  };
}

/**
 * The browser source page, served at /lower-third. It has no app behind it: it draws the lower third from the stream
 * the app sends, and it sends nothing back.
 */
function createStreamBridge(): LiveBridge {
  const base = createBrowserBridge();
  let state: LiveState = initialLiveState();
  const listeners = new Set<(s: LiveState) => void>();
  const source = new EventSource('/api/lower-third/stream');
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data) as { lowerThird: LiveState['lowerThird']['live']; lowerStyle: LiveState['lowerStyle'] | null };
    state = {
      ...state,
      lowerThird: { ...state.lowerThird, live: payload.lowerThird },
      lowerStyle: payload.lowerStyle ?? state.lowerStyle,
    };
    listeners.forEach((listener) => listener(state));
  };
  return {
    ...base,
    isElectron: false,
    dispatch: () => undefined,
    getState: async () => state,
    onState: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

const isStreamPage = !window.apcc && window.location.pathname === '/lower-third';

export const bridge: LiveBridge = window.apcc
  ? { ...window.apcc, isElectron: true }
  : isStreamPage
    ? createStreamBridge()
    : createBrowserBridge();
