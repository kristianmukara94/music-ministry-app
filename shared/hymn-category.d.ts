/** The song category refusal, in English. The form recognises it and shows the translated prompt instead. */
export const SONG_CATEGORY_REQUIRED_EN: 'Choose a song category before saving.';

/** True when no song category has been chosen ("No category" is an empty value). */
export function isSongCategoryMissing(value: unknown): boolean;

/** True when an error message is the song category refusal. */
export function isSongCategoryRefusal(message: string): boolean;
