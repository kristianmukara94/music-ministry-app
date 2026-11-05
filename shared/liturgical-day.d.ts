export type SundayCycle = 'A' | 'B' | 'C';
export type WeekdayCycle = 'I' | 'II';

/** The citations of one Ordo entry, by field. A, B and C override for the Sunday cycle; I and II for the weekday cycle. */
export interface OrdoFields {
  name?: string;
  r1?: string;
  ps?: string;
  r2?: string;
  acc?: string;
  gos?: string;
}
export type OrdoEntry = OrdoFields & Partial<Record<SundayCycle | WeekdayCycle, OrdoFields>>;
/** The parsed src/data/lectionary_ordo.json. */
export interface Ordo {
  days: Record<string, OrdoEntry>;
}

export interface OrdoDay {
  /** The Ordo code: "ot32-6", "adv1", "12-08", "easter"... */
  code: string;
  /** English name: "Saturday of the 32nd Week in Ordinary Time". */
  name: string;
  sundayCycle: SundayCycle;
  weekdayCycle: WeekdayCycle;
  /** By reading type. Never the Prayer of the Faithful. */
  citations: Partial<Record<'First Reading' | 'Responsorial Psalm' | 'Second Reading' | 'Gospel Acclamation' | 'Gospel', string>>;
}

export const ORDO_FIELDS: Record<'r1' | 'ps' | 'r2' | 'acc' | 'gos', string>;
export function dateOfIso(iso: string): Date;
export function liturgicalYearOf(date: Date): number;
export function sundayCycleOf(date: Date): SundayCycle;
export function weekdayCycleOf(date: Date): WeekdayCycle;
export function dayCodeOf(date: Date): string;
export function ordoDayOf(ordo: Ordo, date: Date | string): OrdoDay;
