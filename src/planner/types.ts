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
