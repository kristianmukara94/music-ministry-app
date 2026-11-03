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

export interface PlanSummary {
  id: number;
  name: string;
  liturgicalDate: string;
  createdAt: string;
}

export interface PlanDetail {
  id: number;
  name: string;
  liturgicalDate: string;
  items: PlanItem[];
}

/** An asset in the left-hand browser, not yet placed in a plan. */
export interface LibraryItem {
  module: SourceModule;
  sourceId: string;
  label: string;
  sub: string;
}

export interface PlansApi {
  list(): Promise<PlanSummary[]>;
  create(input: { name: string; liturgicalDate: string }): Promise<{ id: number; name: string; liturgicalDate: string }>;
  deletePlan(id: number): Promise<boolean>;
  get(id: number): Promise<PlanDetail>;
  save(id: number, items: PlanItem[]): Promise<number>;
  listTemplates(): Promise<PlanTemplateSummary[]>;
  getTemplate(id: number): Promise<PlanTemplate>;
  /** Saves items as a template under a name. A name already used is refused. */
  saveTemplate(input: { name: string; items: PlanItem[] }): Promise<PlanTemplateSummary>;
  deleteTemplate(id: number): Promise<boolean>;
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
