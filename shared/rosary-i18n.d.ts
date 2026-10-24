export const ROSARY_LANGS: readonly ['en', 'tl', 'ceb'];

/** Keys in rosary-i18n.js. */
export type RosaryKey = string;

export function rosaryT(lang: string, key: RosaryKey, vars?: Record<string, string | number>): string;
