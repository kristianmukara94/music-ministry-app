/** One person on the clergy and liturgical team roster. */
export interface RosterEntry {
  id: string;
  name: string;
  /** e.g. "Parish Priest". May be empty. */
  role: string;
}

export const DIOCESE_MAX: number;
export const LOCATION_MAX: number;
export const LOGO_SCALE_MIN: number;
export const LOGO_SCALE_MAX: number;
export const LOGO_SCALE_DEFAULT: number;
export const ROSTER_MAX: number;
export const ROSTER_NAME_MAX: number;
export const ROSTER_ROLE_MAX: number;
export const ROSTER_ROLE_SUGGESTIONS: string[];

export function sanitizeOptionalLine(value: unknown, max: number): string | null;
export function sanitizeLogoScale(value: unknown): number;
export function sanitizeRoster(list: unknown): RosterEntry[];
export function checkRoster(list: unknown): RosterEntry[];
export function checkOptionalLine(value: unknown, max: number, label: string): string | null;
export function parishSubtitle(profile: { ministryName?: string | null; diocese?: string | null }): string;
