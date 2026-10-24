export const BIBLE_LANGS: readonly ['en', 'tl', 'ceb'];

/** Keys in bible-i18n.js. */
export type BibleKey = string;

export function bibleT(lang: string, key: BibleKey, vars?: Record<string, string | number>): string;
