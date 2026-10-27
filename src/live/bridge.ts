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
import type { PwApi } from '../praise-worship/types';
import type { ProjectorSettings } from '../../shared/projector-settings';
import type { WelcomeSettings } from '../../shared/welcome-settings';
import type { LowerThirdStyle } from '../../shared/lower-third-style';
import type { WhiteboardApi } from '../whiteboard/types';
import type { ConfigApi, UpdatesApi } from '../settings/types';

export interface PdfJob {
  jobId: string;
  bytes: Uint8Array;
  /** 'lyrics' reads the text only, for a lyrics import. Normal imports send no mode. */
  mode?: 'lyrics';
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

/** Remote view: the two phone viewers on the local network. A PIN is never sent back, only whether one is set. */
export type RemoteRole = 'primary' | 'secondary';

export interface RemoteRoleStatus {
  enabled: boolean;
  port: number;
  pinSet: boolean;
  running: boolean;
  /** The address phones open, for example http://192.168.1.20:8787. Null when the viewer is not running. */
  url: string | null;
  /** Phones with this viewer open, counted once per address. */
  devices: number;
  /** Why the viewer is not running when it is turned on, for example "Port in use, pick another". Null otherwise. */
  error: string | null;
}

export interface RemoteActivity {
  at: number;
  device: string;
  action: string;
  ok: boolean;
  error: string | null;
}

export interface RemoteViewStatus {
  primary: RemoteRoleStatus;
  secondary: RemoteRoleStatus;
  /** Phones across both viewers. */
  devices: number;
  deviceLimit: number;
  /** True on a Windows laptop hotspot, where more than `hotspotWarnAbove` phones is a warning. */
  hotspot: boolean;
  hotspotWarnAbove: number;
  /** Control actions from phones, newest first. */
  activity: RemoteActivity[];
}

export interface RemoteViewPatch {
  role: RemoteRole;
  enabled?: boolean;
  port?: number;
  /** Null or an empty string removes the PIN. */
  pin?: string | null;
}

export interface RemoteViewApi {
  get(): Promise<RemoteViewStatus>;
  save(patch: RemoteViewPatch): Promise<RemoteViewStatus>;
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
  pw: PwApi;
  notes: NotesApi;
  displays: DisplaysApi;
  projector: ProjectorApi;
  welcome: WelcomeApi;
  lowerThird: LowerThirdApi;
  cloud: CloudApi;
  remoteView: RemoteViewApi;
  library: LibraryApi;
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
    // The browser preview cannot save anything, so it reports an accepted agreement and a placeholder registration.
    // Without them the licence gate would return on every reload.
    config: {
      database_path: null,
      default_language: 'en',
      theme: 'default',
      eula_accepted: true,
      registered_church: 'Browser preview',
      registered_location: 'Browser preview',
      registered_at: null,
    },
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
  acceptEula: async () => undefined,
  updateRegistration: async () => undefined,
  changeLocation: async () => offlineError(),
  backup: async () => offlineError(),
};

/** Browser preview: updates come from the desktop app, so checks report that instead of failing silently. */
const offlineUpdates: UpdatesApi = {
  getState: async () => ({ last: null, lastCheckedAt: null, settings: { channel: 'stable', skippedVersion: null, pauseOnMetered: false } }),
  check: async () => offlineError(),
  download: async () => offlineError(),
  restart: async () => offlineError(),
  setChannel: async () => offlineError(),
  skipVersion: async () => offlineError(),
  remindLater: async () => offlineError(),
  setPauseOnMetered: async () => offlineError(),
  getReleaseHistory: async () => offlineError(),
  onEvent: () => () => undefined,
};

const offlinePlans: PlansApi = {
  list: async () => [],
  create: async () => offlineError(),
  deletePlan: async () => offlineError(),
  get: async () => offlineError(),
  save: async () => offlineError(),
};

/** Browser preview has no database, so Praise & Worship lists nothing and cannot save. */
const offlinePw: PwApi = {
  listSessions: async () => [],
  createSession: async () => offlineError(),
  getSession: async () => offlineError(),
  saveSession: async () => offlineError(),
  deleteSession: async () => offlineError(),
  listTemplates: async () => [],
  saveAsTemplate: async () => offlineError(),
  deleteTemplate: async () => offlineError(),
  listTags: async () => [],
  setTag: async () => offlineError(),
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

const offlineRole: RemoteRoleStatus = { enabled: false, port: 0, pinSet: false, running: false, url: null, devices: 0, error: 'Open the desktop app to share the live view.' };
/** Library export and import: the library lives in the desktop app's database, so the browser preview has none. */
export type LibraryType = 'songs' | 'setlists' | 'plans' | 'praiseWorship';

export interface LibraryExportOptions {
  plans: boolean;
  setlists: boolean;
  praiseWorship: boolean;
  songs: boolean;
  lyrics: boolean;
}

export interface LibraryCounts {
  new: number;
  same: number;
  changed: number;
}

export interface LibraryPreview {
  laptop: string;
  exportedAt: string;
  includesLyrics: boolean;
  counts: Record<LibraryType, LibraryCounts>;
  totals: LibraryCounts;
  /** Records that exist here with a different updated_at. The operator chooses for each. */
  changed: { key: string; type: LibraryType; name: string; localUpdatedAt: string; importedUpdatedAt: string }[];
  notes: string[];
}

export interface LibrarySummary {
  added: Record<LibraryType, number>;
  skipped: Record<LibraryType, number>;
  changed: { kept: number; used: number };
}

export interface LibraryApi {
  /** Null when the operator cancels the save dialog. */
  export(options: LibraryExportOptions): Promise<{ path: string; counts: Record<LibraryType, number>; includesLyrics: boolean } | null>;
  /** Null when the operator cancels the open dialog. Throws with the reason when the file is refused. */
  open(): Promise<LibraryPreview | null>;
  /** Writes the file that was last opened. Nothing is written before this. */
  import(choices: Record<string, 'keep' | 'use'>): Promise<LibrarySummary>;
  cancel(): Promise<void>;
}

const offlineLibrary: LibraryApi = {
  export: async () => offlineError(),
  open: async () => offlineError(),
  import: async () => offlineError(),
  cancel: async () => undefined,
};

/** Cloud sync: what the Settings screen may show. The device token never reaches the renderer. */
export interface CloudLink {
  linked: boolean;
  /** The cloud address this laptop uses. Shown on the Cloud sync screen; never part of a message. */
  address?: string;
  /** The address the laptop was linked against. A change of address is shown on the screen; the link itself is not changed. */
  linkedAddress?: string | null;
  church?: string;
  admin?: string | null;
  label?: string;
  lastSeenAt?: string | null;
  offline?: boolean;
  error?: string | null;
  serverConfirmed?: boolean;
}

/** A new web user, typed on this laptop. The temporary password comes back once, for the screen to show, and is never kept. */
export interface NewWebUser {
  username: string;
  displayName: string;
  role: 'admin' | 'planner' | 'viewer';
}

export interface CreatedWebUser {
  username: string;
  temporaryPassword: string;
}

/** A new church, with its first admin, made from a setup key. The key is sent once and never kept. */
export interface NewChurchAdmin {
  setupKey: string;
  churchName: string;
  username: string;
  displayName: string;
  deviceLabel: string;
}

export interface CreatedChurchAdmin {
  username: string;
  temporaryPassword: string;
  churchCode: string;
  link: CloudLink;
}

/** The song list sync as the Cloud sync screen may see it: a status, when it last synced, and a plain message. */
export interface SongsSyncState {
  status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  lastSyncedAt?: string | null;
  message?: string | null;
}

export interface PlansSyncState {
  status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  lastSyncedAt?: string | null;
  message?: string | null;
  counts?: { sent: number; received: number; deleted: number; failed: number; held?: number } | null;
}

export interface CloudApi {
  songsStatus(): Promise<SongsSyncState>;
  plansStatus(): Promise<PlansSyncState>;
  saveAddress(address: string): Promise<{ ok: boolean; address?: string; message?: string }>;
  syncSongsNow(): Promise<SongsSyncState>;
  status(): Promise<CloudLink>;
  link(code: string, label: string): Promise<CloudLink>;
  unlink(): Promise<CloudLink>;
  createWebUser(input: NewWebUser): Promise<CreatedWebUser>;
  createChurchAdmin(input: NewChurchAdmin): Promise<CreatedChurchAdmin>;
  defaultLabel(): Promise<string>;
}

const offlineCloud: CloudApi = {
  status: async () => ({ linked: false, error: 'Open the desktop app to set up cloud sync.' }),
  link: async () => offlineError(),
  unlink: async () => ({ linked: false, error: null }),
  createWebUser: async () => offlineError(),
  createChurchAdmin: async () => offlineError(),
  songsStatus: async () => ({ status: 'idle', lastSyncedAt: null, message: null }),
  plansStatus: async () => ({ status: 'idle', lastSyncedAt: null, message: null, counts: null }),
  saveAddress: async () => ({ ok: false, message: 'Open the desktop app to change the cloud address.' }),
  syncSongsNow: async () => ({ status: 'idle', lastSyncedAt: null, message: null }),
  defaultLabel: async () => 'This computer',
};

const offlineRemoteView: RemoteViewApi = {
  get: async () => ({ primary: offlineRole, secondary: offlineRole, devices: 0, deviceLimit: 20, hotspot: false, hotspotWarnAbove: 8, activity: [] }),
  save: async () => offlineError(),
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
  listDeletedHymns: async () => [],
  undoDeleteHymn: async () => offlineError(),
  listSetlists: async () => [],
  createSetlist: async () => offlineError(),
  deleteSetlist: async () => offlineError(),
  getSetlist: async () => [],
  saveSetlist: async () => offlineError(),
  setStyle: async () => offlineError(),
  importFile: async () => offlineError(),
  listSongCategories: async () => [],
  createSongCategory: async () => offlineError(),
  renameSongCategory: async () => offlineError(),
  deleteSongCategory: async () => offlineError(),
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
    pw: offlinePw,
    notes: offlineNotes,
    displays: offlineDisplays,
    projector: offlineProjector,
    welcome: offlineWelcome,
    lowerThird: offlineLowerThird,
    cloud: offlineCloud,
    remoteView: offlineRemoteView,
    library: offlineLibrary,
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
