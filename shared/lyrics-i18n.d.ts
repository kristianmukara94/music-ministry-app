export const LY_LANGS: readonly ['en', 'tl', 'ceb'];

/** Keys in lyrics-i18n.js. Category labels are `cat_<Category>`, language labels `lang_<code>`. */
export type LyKey = string;

export function lyT(lang: string, key: LyKey, vars?: Record<string, string | number>): string;
