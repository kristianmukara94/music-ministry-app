import { plannerT, type PlannerKey } from '../../shared/planner-i18n.js';
import { useUi } from '../state/ui';

export type PlannerT = (key: PlannerKey, vars?: Record<string, string | number>) => string;

/** Localized labels for the Mass Planner and Service Queue, following the sidebar language switch. */
export function usePlannerT(): PlannerT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => plannerT(lang, key, vars);
}
