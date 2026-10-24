export const PLANNER_LANGS: readonly ['en', 'tl', 'ceb'];

/** Keys in planner-i18n.js. Block names are `block_<id>`, hints `hint_<id>`, modules `module_<key>`. */
export type PlannerKey = string;

export function plannerT(lang: string, key: PlannerKey, vars?: Record<string, string | number>): string;
