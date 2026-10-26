export const GOLIVE_LANGS: readonly ['en', 'tl', 'ceb'];

/** Keys in golive-i18n.js. */
export type GoLiveKey = string;

export function goLiveT(lang: string, key: GoLiveKey, vars?: Record<string, string | number>): string;
