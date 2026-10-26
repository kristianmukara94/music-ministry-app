export type MassBlock = 'introductory' | 'word' | 'eucharist' | 'communion' | 'concluding';

export interface MassStep {
  block: MassBlock;
  id: string;
  name: string;
  kind: 'song' | 'reading' | 'note';
  /** The Mass Order part that matches this step, when the app has its text. */
  massOrderId?: string;
}

/** The 31 steps of the Ordinary of the Mass, in order. */
export const MASS_FLOW: MassStep[];

/** The prefix of a placeholder step row's sourceId. */
export const STEP_PREFIX: string;

export function stepSourceId(step: MassStep): string;

/** The step a placeholder row stands for, or null for any other row. */
export function stepFor(sourceId: string | undefined): MassStep | null;

/** The names of the song categories seeded for the Mass: one per song step. */
export const SONG_CATEGORY_NAMES: string[];

/** The song category a step's picker starts on, or null for a step that takes no song. */
export function songCategoryOf(step: MassStep | null | undefined): string | null;
