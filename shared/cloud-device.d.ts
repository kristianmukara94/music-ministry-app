// Types for shared/cloud-device.js, so the Settings screen can import it with full checking.
export const LINK_CODE_LENGTH: number;
export function formatLinkCode(input: string): string;
export function isCompleteLinkCode(input: string): boolean;
export function lastSyncedText(iso: string | null | undefined, now?: number): string;

export interface CloudLinkInput {
  linked: boolean;
  church?: string;
  admin?: string | null;
  label?: string;
  lastSeenAt?: string | null;
  offline?: boolean;
  error?: string | null;
}

export type CloudViewState =
  | { kind: 'unlinked'; error: string | null }
  | {
      kind: 'linked';
      churchName: string;
      adminName: string;
      deviceLabel: string;
      lastSynced: string;
      offline: boolean;
      error: string | null;
    };

export function cloudViewState(link: CloudLinkInput | null | undefined): CloudViewState;

export const WEB_USER_ROLES: readonly ['admin', 'planner', 'viewer'];

export interface WebUserInput {
  username: string;
  displayName: string;
  role: string;
}

/** The plain message for the first problem with a new web user, or null when it is fine. */
export function checkWebUser(input: Partial<WebUserInput> | null | undefined): string | null;

/** The text of an error from the main process, without Electron's "Error invoking remote method" prefix. */
export function plainErrorText(text: string | null | undefined): string;

export const SETUP_KEY_LENGTH: number;
export function formatSetupKey(input: string): string;
export function isCompleteSetupKey(input: string): boolean;

export interface ChurchSetupInput {
  setupKey: string;
  churchName: string;
  username: string;
  displayName: string;
  deviceLabel: string;
}

/** The plain message for the first problem with the Create church admin form, or null when it is fine. */
export function checkChurchSetup(input: Partial<ChurchSetupInput> | null | undefined): string | null;

export interface SongsSyncState {
  status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  lastSyncedAt?: string | null;
  message?: string | null;
}

/** The line the Cloud sync screen shows for the song list. */
export function songsStatusText(state: SongsSyncState | null | undefined, now?: number): string;
