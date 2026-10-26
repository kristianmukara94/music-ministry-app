export const LECT_LANGS: readonly ['en', 'tl', 'ceb'];

/** Keys in lectionary-i18n.js. Reading names are `slot_<first|psalm|second|acclamation|gospel>`. */
export type LectKey = string;

export function lectT(lang: string, key: LectKey, vars?: Record<string, string | number>): string;
