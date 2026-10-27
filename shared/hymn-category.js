// The song category a hymn must have before it is saved. The form and the service use this one rule, so they cannot disagree.
// The service refuses with this exact English message; the form recognises it and shows the translated prompt instead.

export const SONG_CATEGORY_REQUIRED_EN = 'Choose a song category before saving.';

/** True when no song category has been chosen ("No category" is an empty value). */
export const isSongCategoryMissing = (value) => String(value ?? '').trim() === '';

/** True when an error message is the song category refusal. */
export const isSongCategoryRefusal = (message) => message === SONG_CATEGORY_REQUIRED_EN;
