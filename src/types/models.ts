// Domain models. Mirrors db/schema.sql (SQLite, owned by the Electron main process).
import type { Frame, Lang } from '../../shared/live.js';

export type Localized<T = string> = Partial<Record<Lang, T>> & { en: T };

// ── Lectionary ──────────────────────────────────────────────────────────────
export type Season = 'advent' | 'christmas' | 'lent' | 'triduum' | 'easter' | 'ordinary';
export type Rank = 'solemnity' | 'feast' | 'sunday' | 'memorial' | 'optional_memorial' | 'weekday';

export interface LectionaryDay {
  id: string;
  /** Fixed date (feasts) or null for moveable days resolved by the calendar engine. */
  date: string | null;
  sundayCycle: 'A' | 'B' | 'C' | null;
  weekdayCycle: 'I' | 'II' | null;
  season: Season;
  rank: Rank;
  celebration: Localized;
  /** e.g. PH-specific: Santo Niño (3rd Sun. Jan), San Lorenzo Ruiz (Sep 28). */
  regional: boolean;
  readings: Reading[];
  psalm: ResponsorialPsalm;
}

export interface Reading {
  kind: 'first' | 'second' | 'gospel_acclamation' | 'gospel';
  lang: Lang;
  citation: string;
  intro?: string; // "A reading from the Book of…" / "Pagbasa mula sa…"
  body: string;
  conclusion?: string; // "The word of the Lord." / "Ang Salita ng Diyos."
  reply?: string; // "Thanks be to God." / "Salamat sa Diyos."
}

export interface ResponsorialPsalm {
  lang: Lang;
  citation: string;
  response: string;
  stanzas: string[][];
}

// ── Hymns ───────────────────────────────────────────────────────────────────
export type Hymnal = 'Bukas Palad' | 'Hangad' | 'Papuri' | 'Himig Heswita' | 'Ministry Original' | 'Other';
export type MassMoment =
  | 'entrance' | 'kyrie' | 'gloria' | 'psalm' | 'alleluia' | 'offertory' | 'sanctus'
  | 'acclamation' | 'amen' | 'pater_noster' | 'agnus_dei' | 'communion' | 'thanksgiving' | 'recessional' | 'praise_worship';

export interface Hymn {
  id: string;
  title: string;
  hymnal: Hymnal;
  hymnalNumber?: string;
  composer?: string;
  lang: Lang;
  key?: string;
  tempo?: number;
  moments: MassMoment[];
  seasons: Season[];
  sections: HymnSection[];
  /** Section ids in sung order, e.g. ["v1","r","v2","r","b","r"]. */
  arrangement: string[];
  /** Licensing note (JMM permission, OneLicense #, etc.) — lyrics are copyrighted. */
  license?: string;
}

export interface HymnSection {
  id: string;
  kind: 'verse' | 'refrain' | 'chorus' | 'bridge' | 'tag';
  label: string;
  lines: string[];
}

// ── Special prayers (CBCP / diocesan) ───────────────────────────────────────
export type PrayerCategory = 'oratio_imperata' | 'election' | 'calamity' | 'pastoral_letter' | 'novena' | 'other';

export interface SpecialPrayer {
  id: string;
  category: PrayerCategory;
  title: Localized;
  issuedBy: 'CBCP' | 'Archdiocese' | 'Diocese' | 'Parish';
  occasion?: string; // "typhoon", "national elections", "drought", "epidemic"…
  effectiveFrom?: string;
  effectiveUntil?: string;
  body: Localized;
  /** Pinned prayers appear as one-click launches in Announcements / Notes. */
  pinned: boolean;
}

/** Quick-launch slots shipped empty: paste the current official text when the CBCP / diocese issues it. */
export const SPECIAL_PRAYER_SLOTS: Pick<SpecialPrayer, 'id' | 'category' | 'occasion' | 'issuedBy'>[] = [
  { id: 'oi-calamity', category: 'oratio_imperata', occasion: 'typhoon / calamity', issuedBy: 'CBCP' },
  { id: 'oi-elections', category: 'election', occasion: 'national & local elections', issuedBy: 'CBCP' },
  { id: 'oi-epidemic', category: 'oratio_imperata', occasion: 'epidemic / health crisis', issuedBy: 'CBCP' },
  { id: 'oi-drought', category: 'oratio_imperata', occasion: 'drought / El Niño', issuedBy: 'CBCP' },
];

// ── Announcements, media, planner ───────────────────────────────────────────
export interface Announcement {
  id: string;
  title: Localized;
  body: Localized;
  mediaId?: string;
  startsAt?: string;
  endsAt?: string;
  order: number;
}

export interface MediaAsset {
  id: string;
  kind: 'image' | 'video' | 'background';
  path: string;
  label: string;
  loop: boolean;
}

export interface MassPlan {
  id: string;
  date: string;
  time: string; // "06:00", "17:30" — anticipated Mass, etc.
  celebration: string;
  lang: Lang;
  lectionaryDayId?: string;
  items: MassPlanItem[];
}

export interface MassPlanItem {
  id: string;
  kind: 'mass_part' | 'hymn' | 'reading' | 'psalm' | 'announcement' | 'prayer' | 'media' | 'note';
  refId: string;
  label: string;
  moment?: MassMoment;
  /** Pre-rendered frame so the queue can fire without a lookup. */
  frame?: Frame;
}
