export const MEDIA_LANGS: readonly ['en', 'tl', 'ceb'];

/** Keys in media-i18n.js. */
export type MediaKey = string;

export function mediaT(lang: string, key: MediaKey, vars?: Record<string, string | number>): string;
