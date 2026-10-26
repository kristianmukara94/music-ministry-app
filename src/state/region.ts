import { create } from 'zustand';

/** How the app writes a calendar date. Display only: stored timestamps never change. */
export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';

export const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

/** Auto follows the laptop. Manual uses the zone and formats the operator picked. */
export type RegionMode = 'auto' | 'manual';

/** The saved choice. The zone and formats apply only in Manual mode. */
export interface RegionSettings {
  mode: RegionMode;
  timeZone: string;
  hour12: boolean;
  dateFormat: DateFormat;
}

/** What the laptop reports through Intl. Read on the machine: no network call, no time server. */
export interface SystemRegion {
  timeZone: string;
  hour12: boolean;
  dateFormat: DateFormat;
}

/** The region the app actually displays with. */
export interface ResolvedRegion extends SystemRegion {
  mode: RegionMode;
}

export const DEFAULT_REGION_SETTINGS: RegionSettings = {
  mode: 'auto',
  timeZone: 'Asia/Manila',
  hour12: true,
  dateFormat: 'DD/MM/YYYY',
};

const FALLBACK_TIME_ZONES = [
  'UTC',
  'Asia/Manila',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Reads the laptop's zone, clock style and date order from Intl. The zone falls back to UTC if the OS reports none. */
export function readSystemRegion(): SystemRegion {
  const options = new Intl.DateTimeFormat().resolvedOptions();
  const hour12 = options.hourCycle === 'h11' || options.hourCycle === 'h12' || options.hour12 === true;

  const order = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(2026, 9, 27))
    .map((part) => part.type);
  const dateFormat: DateFormat = order[0] === 'year' ? 'YYYY-MM-DD' : order[0] === 'month' ? 'MM/DD/YYYY' : 'DD/MM/YYYY';

  return { timeZone: options.timeZone || 'UTC', hour12, dateFormat };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Auto takes the laptop's region. Manual takes the saved choice, and falls back to the laptop's zone if the saved one is no longer valid. */
export function resolveRegion(settings: RegionSettings, system: SystemRegion): ResolvedRegion {
  if (settings.mode === 'auto') return { mode: 'auto', ...system };
  return {
    mode: 'manual',
    timeZone: isValidTimeZone(settings.timeZone) ? settings.timeZone : system.timeZone,
    hour12: settings.hour12,
    dateFormat: settings.dateFormat,
  };
}

/** Every zone the dropdown offers, with the current choice kept in the list even if the OS does not report it. */
export function timeZoneOptions(current: string): string[] {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : FALLBACK_TIME_ZONES;
  return supported.includes(current) ? supported : [current, ...supported];
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar and clock fields of an instant, as they read in one time zone. */
function zonedParts(date: Date, timeZone: string) {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zonedFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const DATE_PATTERNS: Record<DateFormat, (year: number, month: number, day: number) => string> = {
  'DD/MM/YYYY': (year, month, day) => `${pad(day)}/${pad(month)}/${year}`,
  'MM/DD/YYYY': (year, month, day) => `${pad(month)}/${pad(day)}/${year}`,
  'YYYY-MM-DD': (year, month, day) => `${year}-${pad(month)}-${pad(day)}`,
};

/** A clock time in the region's zone and clock style, for example "10:05 AM" or "22:05". */
export function formatClock(date: Date, region: ResolvedRegion, { seconds = false } = {}): string {
  const { hour, minute, second } = zonedParts(date, region.timeZone);
  const tail = seconds ? `:${pad(second)}` : '';
  if (!region.hour12) return `${pad(hour)}:${pad(minute)}${tail}`;
  return `${pad(hour % 12 || 12)}:${pad(minute)}${tail} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** A calendar date in the region's zone and date format, for example "27/10/2026". */
export function formatDay(date: Date, region: ResolvedRegion): string {
  const { year, month, day } = zonedParts(date, region.timeZone);
  return DATE_PATTERNS[region.dateFormat](year, month, day);
}

/** A date and time together, for example "27/10/2026, 10:05 AM". */
export function formatDayAndClock(date: Date, region: ResolvedRegion, options?: { seconds?: boolean }): string {
  return `${formatDay(date, region)}, ${formatClock(date, region, options)}`;
}

/** A weekday name in the region's zone, in the given locale. */
export function formatWeekday(date: Date, region: ResolvedRegion, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: region.timeZone }).format(date);
}

/**
 * A planner date stored as YYYY-MM-DD. It has no time, so it is reordered from the string itself: going through a Date
 * could move it to the day before in a zone west of the laptop's.
 */
export function formatIsoDay(iso: string, region: ResolvedRegion): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return DATE_PATTERNS[region.dateFormat](year, month, day);
}

/** The weekday of a YYYY-MM-DD date. Read in UTC, which keeps the calendar day the string names. */
export function formatIsoWeekday(iso: string, locale: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** The laptop's region as Intl reports it now. Re-read every few minutes, so a region change on the laptop is picked up. */
export const useSystemRegion = create<{ system: SystemRegion }>()(() => ({ system: readSystemRegion() }));

const RECHECK_MS = 5 * 60 * 1000;

setInterval(() => {
  const next = readSystemRegion();
  const current = useSystemRegion.getState().system;
  if (next.timeZone !== current.timeZone || next.hour12 !== current.hour12 || next.dateFormat !== current.dateFormat) {
    useSystemRegion.setState({ system: next });
  }
}, RECHECK_MS);
