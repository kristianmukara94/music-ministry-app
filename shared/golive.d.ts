export const GO_LIVE_KINDS: readonly ['mass', 'pw'];

export type GoLiveKind = 'mass' | 'pw';

export interface GoLiveEntry {
  kind: GoLiveKind;
  /** The id in the entry's own module: a Mass plan id, or a Praise & Worship session id. */
  id: number;
  name: string;
  date: string;
}

export function isSunday(iso: string): boolean;
export function listForDate(
  date: string,
  massPlans?: { id: number; name: string; liturgicalDate: string }[],
  pwSessions?: { id: number; name: string; liturgicalDate: string }[],
): GoLiveEntry[];
export function defaultChoice(date: string, entries: GoLiveEntry[]): GoLiveEntry | null;
