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
import type { CalendarApi, PlansApi } from '../planner/types';
import type { NotesApi } from '../notes/types';
import type { MassOrderEntry, MassOrderLang } from '../../shared/mass-order-text';
import type { PwApi } from '../praise-worship/types';
import type { ProjectorSettings } from '../../shared/projector-settings';
import type { WelcomeSettings } from '../../shared/welcome-settings';
import type { LowerThirdStyle } from '../../shared/lower-third-style';
import type { WhiteboardApi } from '../whiteboard/types';
import type { ConfigApi, UpdatesApi } from '../settings/types';
import type { ChurchApi, ChurchProfile } from '../church/types';

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

/** Quick Live: a song shown straight from search. */
/** The parish's own words for the Holy Mass Order parts, as the main process keeps them (see electron/mass-order.js). */
export interface MassOrderApi {
  list(): Promise<{ texts: { partId: string; lang: string; text: string | null; title: string | null; updatedAt: string }[]; custom: { id: string; createdAt: string }[] }>;
  saveAll(partId: string, entries: Partial<Record<MassOrderLang, MassOrderEntry>>): Promise<boolean>;
  create(entries: Partial<Record<MassOrderLang, MassOrderEntry>>): Promise<string>;
  reset(partId: string, lang: MassOrderLang): Promise<boolean>;
  remove(partId: string): Promise<boolean>;
  onChanged(callback: () => void): () => void;
}

export interface QuickLiveApi {
  /** True when the projector window exists. */
  projectorOpen(): Promise<boolean>;
  /** Records an off-plan song in the service history. */
  logSpontaneous(input: { songId: number | string; title: string }): Promise<number>;
}

export interface ProjectorApi {
  save(patch: Partial<ProjectorSettings>): Promise<ProjectorSettings>;
  /** Opens the confidence monitor (the operator mirror) in its own window, or brings it forward. True when the window is open. */
  openConfidenceWindow(): Promise<boolean>;
}

/** The welcome screen's content and style. Saved in config.json. */
export interface WelcomeApi {
  save(patch: Partial<WelcomeSettings>): Promise<WelcomeSettings>;
}

/** The lower third's look and window target, and where the browser source is. */
export interface LowerThirdApi {
  save(patch: Partial<LowerThirdStyle>): Promise<LowerThirdStyle>;
  /** `running` is false when the browser source server could not start (its port was in use). */
  info(): Promise<{ port: number; local: string; lan: string | null; running?: boolean }>;
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
  /** Those phones, one row per address, oldest first. */
  clients: RemoteClient[];
  /** Why the viewer is not running when it is turned on, for example "Port in use, pick another". Null otherwise. */
  error: string | null;
}

/** One phone with a viewer open. */
export interface RemoteClient {
  ip: string;
  /** A short device name from the user agent: iPhone, Android, Windows… */
  label: string;
  userAgent: string;
  /** When its first page connected, in milliseconds since 1970. */
  since: number;
  /** Pages it has open on this viewer. */
  tabs: number;
}

/** The network a viewer is served on. `ssid` is set only for `wifi`. */
export interface RemoteNetworkInfo {
  kind: 'wifi' | 'wired' | 'hotspot' | 'none';
  ssid: string | null;
  ip: string | null;
  /** The viewer's port while it runs, else null. */
  port: number | null;
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
  /** The WiFi name, address and port one viewer is served on. Reads the system, so call it on open, not on every poll. */
  getNetworkInfo(role: RemoteRole): Promise<RemoteNetworkInfo>;
  /** Drops the phone at `ip` from a viewer; it is refused until that viewer restarts. */
  disconnect(role: RemoteRole, ip: string): Promise<RemoteViewStatus>;
}

/** One System Health reading (see electron/system-health.js). */
export interface SystemHealth {
  at: number;
  /** The laptop's address on the local network, or null when it has none. */
  address: string | null;
  /** The laptop's CPU in use, 0–100. Null on the first reading, before there are two samples to compare. */
  cpuPercent: number | null;
  memory: { totalBytes: number; usedBytes: number };
  /** The app's own share, summed over its processes. */
  app: { cpuPercent: number; memoryBytes: number };
  /** The crash-recovery database (userData/live-session.db). */
  session: { enabled: boolean; journalMode: string | null; lastWriteMs: number | null; lastWriteAt: number | null; writes: number; error: string | null };
  /** The newest automatic snapshot in userData/backups. */
  latestBackup: { name: string; at: number; preMigration: boolean } | null;
}

export interface SystemApi {
  health(): Promise<SystemHealth>;
}

/** What the sanctuary failover surface draws (electron/watchdog.js). */
export type FailoverMode = 'emblem' | 'blackout';
export type WatchdogFault = 'crash' | 'freeze' | 'unresponsive' | 'gpu';

/** The sanctuary display watchdog's state, for the Go Live badge. */
export interface WatchdogStatus {
  /** A projector window is open, so there is something to watch. */
  projectorOpen: boolean;
  /** The projector page has answered the heartbeat since it last loaded. */
  armed: boolean;
  /** The failover surface covers the projector. */
  engaged: boolean;
  /** The operator forced the failover (pure black); it stays until they release it. */
  manual: boolean;
  /** The fault being recovered from, or null. */
  fault: WatchdogFault | null;
  faultSince: number | null;
  lastFault: { reason: WatchdogFault; at: number; coverMs: number; details: string | null } | null;
  /** The projector's display was unplugged and no other external display is connected: the projector is hidden. */
  parked: boolean;
  displayId: number | null;
  mode: FailoverMode;
  reviveAttempts: number;
  recoveries: number;
}

/**
 * The EDID lock's state for one output (electron/edid-watchdog.js).
 * unavailable: the hardware reader is not loaded. unpinned: no lock. matched: on its pinned monitor. port: another monitor is on the pinned GPU
 * output (re-pin). shifted: Windows re-indexed the displays, or the window was re-anchored, a moment ago. missing: the pinned monitor is not
 * connected. booth: the pinned monitor is now the operator's screen (duplicate mode, or made primary), so the projector is hidden.
 */
export type EdidLockState = 'unavailable' | 'unpinned' | 'matched' | 'port' | 'shifted' | 'missing' | 'booth';

export interface EdidRoleStatus {
  state: EdidLockState;
  lock: { name: string; manufacturer: string; serial: string; portLabel: string; pinnedAt: string | null } | null;
  connected: { name: string; serial: string; portLabel: string; gdiDeviceName: string } | null;
  match?: 'exact' | 'monitor' | 'port' | null;
}

export interface EdidStatus {
  available: boolean;
  error: string | null;
  queryMs: number | null;
  shiftAt: number | null;
  shiftReason: 'reindex' | 'reanchor' | null;
  roles: { projector?: EdidRoleStatus };
  monitors: { name: string; serial: string; portLabel: string; gdiDeviceName: string; primary: boolean }[];
}

export interface EdidApi {
  status(): Promise<EdidStatus>;
  onStatus(callback: (status: EdidStatus) => void): () => void;
  /** Pin Active Sanctuary Projector: binds the projector to the physical monitor it is on now. */
  pin(): Promise<EdidStatus>;
  unpin(): Promise<EdidStatus>;
}

export interface WatchdogApi {
  status(): Promise<WatchdogStatus>;
  onStatus(callback: (status: WatchdogStatus) => void): () => void;
  /** Force Failover (Blackout) on or off. */
  force(on: boolean): Promise<WatchdogStatus>;
  setMode(mode: FailoverMode): Promise<WatchdogStatus>;
  /** Used only by the failover surface's own page. */
  failoverMode(): Promise<FailoverMode>;
  onFailoverMode(callback: (mode: FailoverMode) => void): () => void;
  painted(mode: FailoverMode): void;
}

interface ElectronApi {
  /** Native path of a file dropped on the window. The browser never exposes it, so drops only work in the desktop app. */
  files: { pathFor(file: File): string };
  getState(): Promise<LiveState>;
  dispatch(action: LiveAction): void;
  onState(callback: (state: LiveState) => void): () => void;
  /**
   * Ctrl+Shift+A (Cmd+Shift+A on a Mac) was pressed in any app window. `toggle` is true when it was pressed in the operator console itself,
   * so a second press closes the Sanctuary Alert; from another window it only opens it. Returns the unsubscribe.
   */
  onSanctuaryAlertHotkey(callback: (payload: { toggle: boolean }) => void): () => void;
  /** The sanctuary display watchdog and failover surface. */
  watchdog: WatchdogApi;
  /** The EDID lock: the projector pinned to a physical monitor. */
  edid: EdidApi;
  open(target: string): Promise<unknown>;
  announcements: AnnouncementApi;
  lyrics: LyricsApi;
  lectionary: LectionaryApi;
  bible: BibleApi;
  rosary: RosaryApi;
  media: MediaApi;
  plans: PlansApi;
  calendar: CalendarApi;
  pw: PwApi;
  notes: NotesApi;
  massOrder: MassOrderApi;
  displays: DisplaysApi;
  projector: ProjectorApi;
  quickLive: QuickLiveApi;
  welcome: WelcomeApi;
  lowerThird: LowerThirdApi;
  cloud: CloudApi;
  license: LicenseApi;
  vault: VaultApi;
  remoteView: RemoteViewApi;
  library: LibraryApi;
  whiteboard: WhiteboardApi;
  config: ConfigApi;
  /** The parish name and logo. */
  church: ChurchApi;
  database: DatabaseApi;
  /** The dashboard's System Health card. */
  system: SystemApi;
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
  moveSlides: async () => offlineError(),
  setNotes: async () => offlineError(),
  pickBackground: async () => offlineError(),
  discardBackground: async () => true,
  createTextSlides: async () => offlineError(),
};

const offlinePdf = { onConvert: () => () => undefined, finish: () => undefined };

/** Browser preview: no projector window to watch, so the badge stays on standby and Force Failover does nothing. */
const offlineWatchdogStatus: WatchdogStatus = {
  projectorOpen: false,
  armed: false,
  engaged: false,
  manual: false,
  fault: null,
  faultSince: null,
  lastFault: null,
  parked: false,
  displayId: null,
  mode: 'emblem',
  reviveAttempts: 0,
  recoveries: 0,
};
const offlineWatchdog: WatchdogApi = {
  status: async () => offlineWatchdogStatus,
  onStatus: () => () => undefined,
  force: async () => offlineWatchdogStatus,
  setMode: async () => offlineWatchdogStatus,
  failoverMode: async () => 'emblem',
  onFailoverMode: () => () => undefined,
  painted: () => undefined,
};

/** Browser preview: no hardware to read. */
const offlineEdidStatus: EdidStatus = {
  available: false,
  error: 'Open the desktop app to pin the sanctuary projector.',
  queryMs: null,
  shiftAt: null,
  shiftReason: null,
  roles: {},
  monitors: [],
};
const offlineEdid: EdidApi = {
  status: async () => offlineEdidStatus,
  onStatus: () => () => undefined,
  pin: async () => offlineEdidStatus,
  unpin: async () => offlineEdidStatus,
};

/** Browser preview: no laptop to measure. The dashboard shows its health card as unavailable. */
const offlineSystem: SystemApi = {
  health: async () => offlineError(),
};

/** Browser preview: no database to back up or restore. */
const offlineDatabase: DatabaseApi = {
  exportBackup: async () => offlineError(),
  importBackup: async () => offlineError(),
};

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
      onboarded: true,
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

/** Browser preview: nothing is saved, so setup counts as done and the built-in emblem shows. */
const offlineChurch: ChurchApi = {
  getProfile: async () => ({ churchName: 'Browser preview', logoPath: null, logoDataUrl: null, logoVersion: null, onboarded: true }),
  saveProfile: async () => offlineError(),
  onChanged: () => () => undefined,
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
  setLanguage: async () => offlineError(),
  slotTitle: async () => null,
  setSlotTitle: async () => offlineError(),
  listTemplates: async () => [],
  getTemplate: async () => offlineError(),
  saveTemplate: async () => offlineError(),
  deleteTemplate: async () => offlineError(),
};

/** Browser preview has no database: every day shows its Ordo name, and a day's own title cannot be saved. */
const offlineCalendar: CalendarApi = {
  getDayNotes: async () => ({}),
  saveDayNote: async () => offlineError(),
  deleteDayNote: async () => offlineError(),
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
  saveCopy: async () => offlineError(),
  remove: async () => offlineError(),
  onChanged: () => () => {},
};

// No database in the browser preview: the standard Missal text is shown, and edits cannot be kept.
const offlineMassOrder: MassOrderApi = {
  list: async () => ({ texts: [], custom: [] }),
  saveAll: async () => offlineError(),
  create: async () => offlineError(),
  reset: async () => offlineError(),
  remove: async () => offlineError(),
  onChanged: () => () => {},
};

const offlineQuickLive: QuickLiveApi = {
  projectorOpen: async () => false,
  logSpontaneous: async () => offlineError(),
};

const offlineDisplays: DisplaysApi = {
  list: async () => [],
  identify: async () => offlineError(),
};

const offlineWhiteboard: WhiteboardApi = {
  list: async () => [],
  save: async () => offlineError(),
  remove: async () => offlineError(),
  get: async () => null,
  makeEditable: async () => offlineError(),
  restorePicture: async () => offlineError(),
  pptxSource: async () => null,
  layersFromFile: async () => offlineError(),
  openEditor: async () => false,
  onChanged: () => () => undefined,
  onEditorFlush: () => () => undefined,
  editorFlushed: () => undefined,
  closeEditor: () => undefined,
  removeMany: async () => offlineError(),
  clearUnfiled: async () => offlineError(),
  rename: async () => offlineError(),
  setNotes: async () => offlineError(),
  reorder: async () => offlineError(),
  folders: async () => [],
  createFolder: async () => offlineError(),
  renameFolder: async () => offlineError(),
  deleteFolder: async () => offlineError(),
  move: async () => offlineError(),
  moveSelectedToFolder: async () => offlineError(),
  importPowerPoint: async () => offlineError(),
  onImportProgress: () => () => {},
};

const offlineLowerThird: LowerThirdApi = {
  save: async () => offlineError(),
  info: async () => ({ port: 3002, local: 'http://127.0.0.1:3002/lower-third', lan: null }),
};

const offlineRole: RemoteRoleStatus = { enabled: false, port: 0, pinSet: false, running: false, url: null, devices: 0, clients: [], error: 'Open the desktop app to share the live view.' };
/** Library export and import: the library lives in the desktop app's database, so the browser preview has none. */
export type LibraryType = 'songs' | 'setlists' | 'plans' | 'praiseWorship' | 'massOrder';

/** A backup is saved with a dialog, and a restore asks for a file with a dialog. A restore restarts the app. */
export interface DatabaseBackupResult {
  success: boolean;
  /** True when the operator closed the dialog. Nothing changed. */
  cancelled?: boolean;
  filePath?: string;
  error?: string;
}

export interface DatabaseApi {
  exportBackup(): Promise<DatabaseBackupResult>;
  importBackup(): Promise<DatabaseBackupResult>;
}

export interface LibraryExportOptions {
  plans: boolean;
  setlists: boolean;
  praiseWorship: boolean;
  songs: boolean;
  lyrics: boolean;
  /** The parish's Holy Mass Order words and titles, and its own items. */
  massOrder: boolean;
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

/** Mass intention privacy on this database and this laptop. */
export interface VaultStatus {
  /** The database has a parish passphrase. */
  configured: boolean;
  /** This laptop holds the key, so sealed Mass intentions can be read and saved here. */
  unlocked: boolean;
  /** An unlocked laptop keeps the key between starts (Windows can protect it). */
  remembers: boolean;
}

export interface VaultApi {
  status(): Promise<VaultStatus>;
  setup(passphrase: string): Promise<VaultStatus>;
  unlock(passphrase: string): Promise<VaultStatus>;
  lock(): Promise<VaultStatus>;
  /** `damaged` counts sealed notes that failed their integrity check and were left as they were. */
  changePassphrase(current: string, next: string): Promise<VaultStatus & { damaged: number }>;
  disable(passphrase: string): Promise<VaultStatus>;
}

const offlineVault: VaultApi = {
  status: async () => ({ configured: false, unlocked: false, remembers: false }),
  setup: async () => offlineError(),
  unlock: async () => offlineError(),
  lock: async () => offlineError(),
  changePassphrase: async () => offlineError(),
  disable: async () => offlineError(),
};

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
  renewLicense(setupKey: string): Promise<{ licenseExpiresAt: string | null }>;
  defaultLabel(): Promise<string>;
}

const offlineCloud: CloudApi = {
  status: async () => ({ linked: false, error: 'Open the desktop app to set up cloud sync.' }),
  link: async () => offlineError(),
  unlink: async () => ({ linked: false, error: null }),
  createWebUser: async () => offlineError(),
  createChurchAdmin: async () => offlineError(),
  renewLicense: async () => offlineError(),
  songsStatus: async () => ({ status: 'idle', lastSyncedAt: null, message: null }),
  plansStatus: async () => ({ status: 'idle', lastSyncedAt: null, message: null, counts: null }),
  saveAddress: async () => ({ ok: false, message: 'Open the desktop app to change the cloud address.' }),
  syncSongsNow: async () => ({ status: 'idle', lastSyncedAt: null, message: null }),
  defaultLabel: async () => 'This computer',
};

/** This laptop's license window. The text is written by the main process (electron/license-manager.js). */
export interface LicenseStatus {
  state: 'unlinked' | 'perpetual' | 'active' | 'expired';
  expiresAt: string | null;
  canProject: boolean;
  statusText: string | null;
  banner: string | null;
}

export interface LicenseApi {
  get(): Promise<LicenseStatus>;
  /** Told when a renewal or the heartbeat changes the license. Returns the stop function. */
  onChanged(callback: (status: LicenseStatus) => void): () => void;
}

const offlineLicense: LicenseApi = {
  get: async () => ({ state: 'unlinked', expiresAt: null, canProject: true, statusText: null, banner: null }),
  onChanged: () => () => undefined,
};

const offlineRemoteView: RemoteViewApi = {
  get: async () => ({ primary: offlineRole, secondary: offlineRole, devices: 0, deviceLimit: 20, hotspot: false, hotspotWarnAbove: 8, activity: [] }),
  save: async () => offlineError(),
  getNetworkInfo: async () => ({ kind: 'none', ssid: null, ip: null, port: null }),
  disconnect: async () => offlineError(),
};

const offlineProjector: ProjectorApi = {
  save: async () => offlineError(),
  // A plain browser has no second window to open.
  openConfidenceWindow: async () => false,
};

const offlineWelcome: WelcomeApi = {
  save: async () => offlineError(),
};

const offlineMedia: MediaApi = {
  list: async () => [],
  importMedia: async () => offlineError(),
  importFiles: async () => offlineError(),
  deleteMedia: async () => offlineError(),
  rename: async () => offlineError(),
  reveal: async () => offlineError(),
  folders: async () => [],
  createFolder: async () => offlineError(),
  deleteFolder: async () => offlineError(),
  moveToFolder: async () => offlineError(),
  onEvent: () => () => undefined,
};

const offlineLyrics: LyricsApi = {
  onChanged: () => () => undefined,
  listHymns: async () => [],
  getHymn: async () => null,
  createHymn: async () => offlineError(),
  createHymns: async () => offlineError(),
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
  pickBatchFile: async () => offlineError(),
  readBatchFile: async () => offlineError(),
  listSongCategories: async () => [],
  createSongCategory: async () => offlineError(),
  renameSongCategory: async () => offlineError(),
  deleteSongCategory: async () => offlineError(),
  editHymn: async () => offlineError(),
  editLyrics: async () => offlineError(),
  splitStanza: async () => offlineError(),
};

const offlineLectionary: LectionaryApi = {
  getDay: async (date) => ({ date, seasonInfo: '', readings: [] }),
  saveReading: async () => offlineError(),
  clearReading: async () => offlineError(),
  setSeasonInfo: async () => offlineError(),
  overview: async () => ({ readings: 0, days: 0, earliest: null, latest: null, bySlot: { 'First Reading': 0, 'Responsorial Psalm': 0, 'Second Reading': 0, 'Gospel Acclamation': 0, Gospel: 0, 'Prayer of the Faithful': 0 }, range: [] }),
  exportJSON: async () => offlineError(),
  importJSON: async () => offlineError(),
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
    // No main process in the browser: the console page catches the hotkey itself.
    onSanctuaryAlertHotkey(callback) {
      const onKey = (e: KeyboardEvent) => {
        const primary = e.ctrlKey || e.metaKey;
        if (!primary || !e.shiftKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'a') return;
        e.preventDefault();
        callback({ toggle: true });
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    },
    open: async (target) => window.open(target, '_blank', 'noopener'),
    watchdog: offlineWatchdog,
    edid: offlineEdid,
    announcements: offlineAnnouncements,
    files: { pathFor: offlineError },
    pdf: offlinePdf,
    lyrics: offlineLyrics,
    lectionary: offlineLectionary,
    bible: offlineBible,
    rosary: offlineRosary,
    media: offlineMedia,
    plans: offlinePlans,
    calendar: offlineCalendar,
    pw: offlinePw,
    notes: offlineNotes,
    massOrder: offlineMassOrder,
    displays: offlineDisplays,
    projector: offlineProjector,
    quickLive: offlineQuickLive,
    welcome: offlineWelcome,
    lowerThird: offlineLowerThird,
    cloud: offlineCloud,
    license: offlineLicense,
    vault: offlineVault,
    remoteView: offlineRemoteView,
    library: offlineLibrary,
    whiteboard: offlineWhiteboard,
    config: offlineConfig,
    church: offlineChurch,
    database: offlineDatabase,
    system: offlineSystem,
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
  // The parish logo comes from the app's server. Its version arrives with each push, so a new logo is fetched again.
  let profile: ChurchProfile = { churchName: '', logoPath: null, logoDataUrl: null, logoVersion: null, onboarded: true };
  const profileListeners = new Set<(p: ChurchProfile) => void>();
  const source = new EventSource('/api/lower-third/stream');
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data) as {
      lowerThird: LiveState['lowerThird']['live'];
      lowerStyle: LiveState['lowerStyle'] | null;
      churchLogoVersion?: number | null;
    };
    state = {
      ...state,
      lowerThird: { ...state.lowerThird, live: payload.lowerThird },
      lowerStyle: payload.lowerStyle ?? state.lowerStyle,
    };
    listeners.forEach((listener) => listener(state));
    const version = payload.churchLogoVersion ?? null;
    if (version !== profile.logoVersion) {
      profile = { ...profile, logoVersion: version, logoDataUrl: version ? `/api/church-logo?v=${version}` : null };
      profileListeners.forEach((listener) => listener(profile));
    }
  };
  return {
    ...base,
    church: {
      getProfile: async () => profile,
      saveProfile: async () => profile,
      onChanged: (callback) => {
        profileListeners.add(callback);
        return () => profileListeners.delete(callback);
      },
    },
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
