export const PW_LANGS: readonly ['en', 'tl'];

/** Keys in pw-i18n.js. Statuses are `status_<PwStatus>`, types `type_<PwType>`, tabs `tab_<view>`. */
export type PwKey = string;

export function pwT(lang: string, key: PwKey, vars?: Record<string, string | number>): string;
