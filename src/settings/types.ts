import type { ThemeId } from '../theme/themes';

export type Language = 'en' | 'tl' | 'ceb';

export interface DatabaseStatus {
  connected: boolean;
  path: string | null;
  /** True when the configured database could not be opened and the local copy is in use. */
  fallback: boolean;
  error: string | null;
}

export interface ConfigState {
  config: { database_path: string | null; default_language: Language; theme: ThemeId };
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
  /** Null when the operator cancelled the picker. */
  changeLocation(): Promise<{ changed: boolean; path: string } | null>;
  /** Null when the operator cancelled the picker. */
  backup(): Promise<{ path: string } | null>;
}

export interface UpdateInfo {
  version: string;
  releaseDate: string | null;
  /** Plain-text summary of the release notes, shortened in the main process. */
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
  | { channel: 'UPDATE_DOWNLOADED'; payload: UpdateInfo }
  | { channel: 'UPDATE_ERROR'; payload: { message: string } };

export interface UpdatesState {
  /** The most recent event, or null if no check has run since the app started. */
  last: UpdateEvent | null;
  /** Epoch milliseconds of the last finished check, or null. */
  lastCheckedAt: number | null;
}

export interface UpdatesApi {
  getState(): Promise<UpdatesState>;
  /** Looks for a newer release on GitHub. Results arrive through onEvent. */
  check(): Promise<void>;
  /** Downloads the release found by the last check. Progress arrives through onEvent. */
  download(): Promise<void>;
  /** Quits APCCMMA and installs the downloaded update. */
  restart(): Promise<void>;
  /** Returns an unsubscribe function. */
  onEvent(callback: (event: UpdateEvent) => void): () => void;
}
