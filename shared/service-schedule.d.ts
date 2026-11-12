/** A Mass time: a weekday (0 = Sunday … 6 = Saturday, or -1 for every day) and a wall-clock "HH:MM" in the region's zone. */
export interface MassTime {
  day: number;
  time: string;
  /** Optional, e.g. "Sunday Morning Mass". Shown on the countdown. */
  label?: string;
}

export interface NextMass {
  /** The start, in milliseconds since 1970. */
  at: number;
  /** Its weekday, 0 = Sunday. */
  day: number;
  time: string;
  label?: string;
  /** True while the Mass is within its first minutes. */
  started: boolean;
}

export const EVERY_DAY: -1;
export const STARTED_GRACE_MS: number;
export const MAX_MASS_TIMES: number;
export const MASS_LABEL_MAX: number;
export function sanitizeMassTimes(list: unknown): MassTime[];
export function nextMassStart(now: Date | number, times: unknown, timeZone: string): NextMass | null;
export function countdownParts(ms: number): { days: number; hours: number; minutes: number; seconds: number };
export function formatCountdown(ms: number): string;
