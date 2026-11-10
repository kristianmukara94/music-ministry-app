// Types for shared/lineup-templates.js: the default lineups and the song picker's categories.

export type ServiceTypeId = 'mass' | 'praise_worship';
export type SongScope = 'GENERAL' | 'MASS' | 'PRAISE_AND_WORSHIP';

export interface ServiceType {
  id: ServiceTypeId;
  planKind: 'mass' | 'pw';
  scope: SongScope;
  label: string;
  allLabel: string;
}

export interface LineupGroup {
  key: string;
  name: string;
}

export interface LineupSegment {
  key: string;
  group: string;
  name: string;
  type: 'prayer' | 'song' | 'scripture';
  /** Every type the slot may hold. Omitted means only `type`. */
  types?: Array<'prayer' | 'song' | 'scripture'>;
  minutes: number;
  /** The most songs a song slot holds. */
  maxSongs?: number;
  /** The song picker category the slot opens on. */
  pickerCategory?: string;
  /** The older hymn category the laptop's lineup matches a song by. */
  legacyCategory?: string;
  /** The lectionary reading a scripture slot fills from. Without one it is a title slide. */
  readingType?: string;
}

export interface PwLineup {
  name: string;
  groups: LineupGroup[];
  segments: LineupSegment[];
}

export interface MassLineupPart {
  number: number;
  name: string;
  /** Slot numbers (1 to 28), in Mass order. */
  slots: number[];
}

export interface PickerCategory {
  id: string;
  label: string;
  /** Song category names, lower case. */
  names: string[];
}

export interface PickerPill {
  id: string;
  label: string;
  count: number;
}

export interface PickerSong {
  title: string;
  category?: string | null;
  scope?: SongScope | null;
}

export const GENERAL_SCOPE: 'GENERAL';
export const ALL_CATEGORIES: 'all';
export const SERVICE_TYPES: ServiceType[];
export const PW_LINEUP: PwLineup;
export const PW_SEGMENT_KEYS: string[];
export const MASS_LINEUP: MassLineupPart[];
export const PICKER_CATEGORIES: Record<ServiceTypeId, PickerCategory[]>;

export function serviceTypeOf(id: unknown): ServiceType | null;
export function serviceTypeOfPlanKind(kind: unknown): ServiceTypeId;
export function scopesOfServiceType(id: unknown): SongScope[] | null;
export function pickerCategoriesOf(serviceType: unknown): PickerCategory[];
export function pickerCategoryOf(serviceType: unknown, id: unknown): PickerCategory | null;
export function pickerCategoryForName(serviceType: unknown, name: unknown): string | null;
export function songInServiceType(song: PickerSong, serviceType: unknown): boolean;
export function songInPickerCategory(song: PickerSong, serviceType: unknown, categoryId?: string | null): boolean;
export function pickerFilterOf(serviceType?: unknown, categoryId?: string | null): { scopes: SongScope[] | null; names: string[] | null } | null;
export function filterPickerSongs<T extends PickerSong>(songs: T[], filter?: { serviceType?: unknown; category?: string; query?: string }): T[];
export function pickerPillsFor(songs: PickerSong[], serviceType: unknown, options?: { query?: string }): PickerPill[];
export function pickerCategoryLabel(serviceType: unknown, categoryId?: string | null): string;
