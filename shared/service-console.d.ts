export interface ServiceGaps {
  missing: number;
  missingMedia: number;
  needsPrayer: number;
  needsSong: number;
  total: number;
}

export interface CloudSyncReadiness {
  ok: boolean | null;
  linked: boolean;
  canSync: boolean;
  detail: string;
}

export function lanUrl(address: string | null | undefined, port?: number | null): string | null;
export function serviceGaps(
  queue: ReadonlyArray<{ stale?: boolean; module?: string }> | null | undefined,
  pwStatuses?: ReadonlyArray<string> | null,
): ServiceGaps;
export function serviceGapsText(gaps: ServiceGaps): string;
export function cloudSyncReadiness(
  link: { linked: boolean; lastSeenAt?: string | null; offline?: boolean } | null | undefined,
  plans: { status?: string; lastSyncedAt?: string | null; message?: string | null; counts?: { failed?: number } | null } | null | undefined,
  now?: number,
): CloudSyncReadiness;
export function isoDayInZone(ms: number, timeZone: string): string;
export function scheduledPlan<T extends { liturgicalDate: string; massTime?: string | null }>(
  plans: ReadonlyArray<T> | null | undefined,
  date: string,
  time: string,
): T | null;
