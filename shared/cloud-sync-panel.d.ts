// Types for shared/cloud-sync-panel.js, so the Cloud sync screen can import it with full checking.
export const ACTIVITY_LIMIT: number;

export interface ActivityEntry {
  at: string;
  direction: 'push' | 'pull' | 'both';
  channel: 'plans' | 'songs' | 'theme';
  status: 'ok' | 'warn' | 'error';
  summary: string;
  trigger: string;
}

export function createActivityLog(options?: { limit?: number; now?: () => number }): {
  record(entry: Partial<ActivityEntry>): ActivityEntry;
  list(): ActivityEntry[];
  clear(): void;
};

export function redact(text: string): string;
export function songTotal(counts: unknown): number | null;
export function planRunEntry(run: unknown): Partial<ActivityEntry>;
export function songRunEntry(state: unknown, trigger?: string): Partial<ActivityEntry>;
export function themeEntry(input: { ok: boolean; theme?: string | null; message?: string | null }, trigger?: string): Partial<ActivityEntry>;

export type PillTone = 'connected' | 'syncing' | 'attention' | 'offline' | 'unlinked';
export function connectionPill(input: { link?: unknown; plans?: unknown; songs?: unknown; theme?: unknown }): { tone: PillTone; label: string };
export function latest(...times: Array<string | null | undefined>): string | null;

export type CardTone = 'connected' | 'syncing' | 'attention' | 'offline' | 'idle';
export interface ChannelCard {
  id: 'plans' | 'songs' | 'theme';
  title: string;
  tone: CardTone;
  badge: string;
  count: string;
  last: string;
  detail: string | null;
}
export function channelCards(input: { plans?: unknown; songs?: unknown; theme?: unknown }, now?: number): ChannelCard[];

export function failedPlanWhen(failure: { date?: string | null; kind?: string | null; massTime?: string; massLanguage?: string }): string;

export type UnlinkStep = 'idle' | 'confirming' | 'unlinking';
export function unlinkStep(step: UnlinkStep, action: 'request' | 'cancel' | 'confirm' | 'done'): UnlinkStep;

export function diagnosticsText(input: {
  appVersion?: string;
  platform?: string;
  link?: unknown;
  license?: unknown;
  plans?: unknown;
  songs?: unknown;
  theme?: unknown;
  activity?: ActivityEntry[];
  now?: number;
}): string;
