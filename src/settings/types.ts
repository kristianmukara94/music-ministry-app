import type { ThemeId } from '../theme/themes';

export type Language = 'en' | 'tl' | 'ceb';

export interface DatabaseStatus {
  connected: boolean;
  path: string | null;
  /** True when the configured database could not be opened and the local copy is in use. */
  fallback: boolean;
  error: string | null;
}

/** The church, parish, or ministry the software is licensed to, and where it is. */
export interface Registration {
  church: string;
  location: string;
}

export interface ConfigState {
  config: {
    database_path: string | null;
    default_language: Language;
    theme: ThemeId;
    eula_accepted: boolean;
    registered_church: string | null;
    registered_location: string | null;
    /** ISO date of the EULA acceptance, or null before it. */
    registered_at: string | null;
  };
  databasePath: string;
  defaultDatabasePath: string;
  /** The `apccmma_assets` folder beside the active database: media and slide files live here. */
  assetsPath: string;
  status: DatabaseStatus;
  version: string;
}

/** Sent while the database location is being changed. `done` counts copied files, including the database. */
export interface MigrationProgress {
  done: number;
  total: number;
  /** The file just copied, relative to the media folder (empty at the start and end). */
  current: string;
}

export interface ConfigApi {
  /** Subscribes to migration progress. Returns an unsubscribe function. */
  onMigrationProgress(callback: (progress: MigrationProgress) => void): () => void;
  get(): Promise<ConfigState>;
  setLanguage(lang: Language): Promise<unknown>;
  setTheme(theme: ThemeId): Promise<ThemeId>;
  /** Records the EULA acceptance and the church registration on this machine. Rejects a blank registration. */
  acceptEula(registration: Registration): Promise<void>;
  /** Changes the church and location on an existing registration. */
  updateRegistration(registration: Registration): Promise<void>;
  /** Null when the operator cancelled the picker. */
  changeLocation(): Promise<{ changed: boolean; path: string } | null>;
  /** Null when the operator cancelled the picker. */
  backup(): Promise<{ path: string } | null>;
}

export interface UpdateInfo {
  version: string;
  releaseDate: string | null;
  /** Release notes as plain text with their line breaks kept. Shortened in the main process, and empty when the release has none. */
  notes: string;
}

export interface UpdateProgress {
  /** 0 to 100. */
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/** One update event from the main process. The channel says what happened; the payload carries its details. */
export type UpdateEvent =
  | { channel: 'UPDATE_CHECKING'; payload?: undefined }
  | { channel: 'UPDATE_AVAILABLE'; payload: UpdateInfo }
  | { channel: 'UPDATE_NOT_AVAILABLE'; payload: { version: string } }
  | { channel: 'UPDATE_PROGRESS'; payload: UpdateProgress }
  /** The download waits because the connection is metered. Downloading anyway is the operator's choice. */
  | { channel: 'UPDATE_PAUSED'; payload: { reason: 'metered' } }
  | { channel: 'UPDATE_DOWNLOADED'; payload: UpdateInfo }
  | { channel: 'UPDATE_ERROR'; payload: { message: string } };

export type UpdateChannel = 'stable' | 'beta';

export interface UpdateSettings {
  channel: UpdateChannel;
  /** The version the operator chose to skip. Background checks stay quiet for it; a manual check still shows it. */
  skippedVersion: string | null;
  pauseOnMetered: boolean;
}

export interface UpdatesState {
  /** The most recent event, or null if no check has run since the app started. */
  last: UpdateEvent | null;
  /** Epoch milliseconds of the last finished check, or null. */
  lastCheckedAt: number | null;
  settings: UpdateSettings;
}

/** One published GitHub release, as the history list shows it. */
export interface ReleaseSummary {
  name: string;
  tag_name: string;
  published_at: string;
  /** The release notes in Markdown. */
  body: string;
  prerelease: boolean;
}

export interface UpdatesApi {
  getState(): Promise<UpdatesState>;
  /** Looks for a newer release on GitHub. Results arrive through onEvent. */
  check(): Promise<void>;
  /** Downloads the release found by the last check. Progress arrives through onEvent. `force` ignores the metered-connection pause once. */
  download(force?: boolean): Promise<void>;
  /** Quits APCCMMA and installs the downloaded update. */
  restart(): Promise<void>;
  setChannel(channel: UpdateChannel): Promise<void>;
  skipVersion(version: string): Promise<void>;
  /** Hides the update for a day in background checks. Manual checks still show it. */
  remindLater(): Promise<void>;
  setPauseOnMetered(enabled: boolean): Promise<void>;
  /** The last five published releases, newest first. */
  getReleaseHistory(): Promise<ReleaseSummary[]>;
  /** Returns an unsubscribe function. */
  onEvent(callback: (event: UpdateEvent) => void): () => void;
}
