import type { MassLanguage } from '../../shared/mass-language.js';
import type { PlanAppearance, PlanKind } from '../../shared/plan-appearance.js';

export type { MassLanguage };
export type LiturgicalBlock = 'introductory' | 'word' | 'eucharist' | 'communion' | 'concluding';
export type SourceModule = 'lyrics' | 'lectionary' | 'announcements' | 'media' | 'mass_order' | 'bible' | 'custom' | 'notes';

export interface PlanItem {
  block: LiturgicalBlock;
  module: SourceModule;
  /** Text: a table id, `YYYY-MM-DD|Reading Type` for readings, or a Mass Order part key. */
  sourceId: string;
  /** Snapshot of the name at the time it was added. */
  label: string;
  /** Set when loading a plan: the source was deleted after the plan was saved. */
  stale?: boolean;
  /** A song or hymn that was deleted but can still be undone. It is also stale while it is deleted. */
  deleted?: boolean;
  /** The Holy Mass slot this item fills (see shared/mass-slots.js), or none for an additional item. */
  slot?: string | null;
}

/** A plan saved to load into another: its name and how many items it holds. */
export interface PlanTemplateSummary {
  id: number;
  name: string;
  count: number;
}

export interface PlanTemplate {
  id: number;
  name: string;
  /** `stale` marks an item whose source was deleted since the template was saved. */
  items: PlanItem[];
}

/**
 * A Holy Mass plan's schedule (shared/mass-schedule.js): the time as typed ("6:00 AM") and its language ('English', 'Cebuano', 'Tagalog' or
 * the operator's own). Both are '' on a plan made before schedules.
 */
export interface MassSchedule {
  massTime: string;
  massLanguage: string;
}

export interface PlanSummary extends Partial<MassSchedule> {
  id: number;
  name: string;
  liturgicalDate: string;
  /** The language the Mass is celebrated in: its Bible translation, Mass Order words and reading endings. */
  language: MassLanguage;
  createdAt: string;
  /** How many items the plan holds. Absent from a source that does not count them. */
  itemCount?: number;
  /** The ids of the Holy Mass slots the plan fills, for the calendar's ready / draft mark. */
  filledSlots?: string[];
}

export interface PlanDetail extends Partial<MassSchedule> {
  id: number;
  name: string;
  liturgicalDate: string;
  language: MassLanguage;
  items: PlanItem[];
}

/** An asset in the left-hand browser, not yet placed in a plan. */
export interface LibraryItem {
  module: SourceModule;
  sourceId: string;
  label: string;
  sub: string;
  /** A Content Hub row: a prayer, a Holy Mass flow text or a notice the congregation sees, or a private operator note. */
  kind?: NoteKind;
  /** A song row: the song's id, for its lyrics drawer and Edit Song. */
  hymnId?: number;
  /** A song row: every song category it is filed under, primary first (see shared/song-filing.js), shown as badges on its card. */
  categories?: string[];
}

/** What the Planner sends to clean up plans (shared/planner-cleanup.js holds the matching rules). */
export interface PlannerCleanupRequest {
  year: number;
  /** 0 (January) to 11. Null: the entire year. */
  months: number[] | null;
  planType: 'all' | 'mass' | 'pw';
  /** Also delete the plans from the cloud / Web Planner (records the sync deletions). */
  deleteFromCloud?: boolean;
  /** Plans loaded on air in Go Live. They are skipped and reported, never deleted. */
  protectedMassIds?: number[];
  protectedPwIds?: number[];
}

export interface PlannerCleanupResult {
  year: number;
  months: number[] | null;
  deletedMass: number;
  deletedPw: number;
  deleted: number;
  skipped: { kind: 'mass' | 'pw'; id: number; name: string; liturgicalDate: string }[];
  deletedFromCloud: boolean;
  /** The ids that were deleted, so the Planner can close an editor that held one. */
  massIds: number[];
  pwIds: number[];
}

export interface PlannerCleanupApi {
  deletePlans(request: PlannerCleanupRequest): Promise<PlannerCleanupResult>;
  /** Null when the operator cancels the save dialog, or nothing matches. */
  exportBackup(request: PlannerCleanupRequest): Promise<{ path: string; counts: Record<string, number> } | null>;
}

export interface PlansApi {
  list(): Promise<PlanSummary[]>;
  /** Makes a plan. A plan with a time and language that another plan on the same day already has is refused. */
  create(input: { name: string; liturgicalDate: string; language?: MassLanguage } & Partial<MassSchedule>): Promise<{ id: number; name: string; liturgicalDate: string; language: MassLanguage } & MassSchedule>;
  deletePlan(id: number): Promise<boolean>;
  /** Copies a plan (items, language, slot titles, Plan Appearance) on the same day as "<name> (Copy)", with no time set. */
  duplicate(id: number): Promise<{ id: number; name: string; liturgicalDate: string; language: MassLanguage } & MassSchedule>;
  get(id: number): Promise<PlanDetail>;
  save(id: number, items: PlanItem[]): Promise<number>;
  /** Sets the plan's language. Its items are left as they are. */
  setLanguage(id: number, language: MassLanguage): Promise<MassLanguage>;
  /** Sets the plan's time and language (its schedule). Refused when another plan on the same day has the same one. */
  setSchedule(id: number, schedule: MassSchedule): Promise<MassSchedule>;
  /** The plan's own choice for showing slot titles on its slides: true, false, or null to follow the projector setting. */
  slotTitle(id: number): Promise<boolean | null>;
  /** Saves the plan's slot-title choice. Null follows the projector setting. */
  setSlotTitle(id: number, show: boolean | null): Promise<boolean | null>;
  listTemplates(): Promise<PlanTemplateSummary[]>;
  getTemplate(id: number): Promise<PlanTemplate>;
  /** Saves items as a template under a name. A name already used is refused. */
  saveTemplate(input: { name: string; items: PlanItem[] }): Promise<PlanTemplateSummary>;
  deleteTemplate(id: number): Promise<boolean>;
}

/** Plan Appearance: each plan's own default look for its slides. `kind` is 'mass' (a Holy Mass plan) or 'pw' (a Praise & Worship plan). */
export interface PlanAppearanceApi {
  get(kind: PlanKind, id: number): Promise<PlanAppearance>;
  /** Saves the appearance and resolves to it as kept. */
  set(kind: PlanKind, id: number, appearance: PlanAppearance): Promise<PlanAppearance>;
}

/** The parish's own titles for calendar days, keyed "YYYY-MM-DD". A day without one shows its Ordo name. */
export type DayNotes = Record<string, string>;

export interface CalendarApi {
  /** Every day with its own title. */
  getDayNotes(): Promise<DayNotes>;
  /** Sets a day's title and returns it as kept (one line, at most 120 characters). A blank title removes it and returns null. */
  saveDayNote(date: string, note: string): Promise<string | null>;
  /** Removes a day's title, so it shows its Ordo name again. True when there was one. */
  deleteDayNote(date: string): Promise<boolean>;
}

/** The fixed liturgical blocks, in Mass order. Labels are looked up in planner-i18n.js. */
export const BLOCKS: { id: LiturgicalBlock; titleKey: string; hintKey: string }[] = [
  { id: 'introductory', titleKey: 'block_introductory', hintKey: 'hint_introductory' },
  { id: 'word', titleKey: 'block_word', hintKey: 'hint_word' },
  { id: 'eucharist', titleKey: 'block_eucharist', hintKey: 'hint_eucharist' },
  { id: 'communion', titleKey: 'block_communion', hintKey: 'hint_communion' },
  { id: 'concluding', titleKey: 'block_concluding', hintKey: 'hint_concluding' },
];

export const BLOCK_RANK: Record<LiturgicalBlock, number> = { introductory: 0, word: 1, eucharist: 2, communion: 3, concluding: 4 };

/** What a Liturgical Content Hub entry is, for its tag in the planner: a prayer, a Holy Mass flow text, a public notice, or a private note. */
export type NoteKind = 'prayer' | 'flow' | 'notice' | 'note';
