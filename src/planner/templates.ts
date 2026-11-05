import { BUILT_IN_TEMPLATES, placeInSlot, slotById } from '../../shared/mass-slots.js';
import { MASS_ORDER, massPartName } from '../liturgy/massOrder';
import type { PlanItem } from './types';

/** The orders a new plan can start from: the two templates that come with the app. */
export type NewPlanTemplate = 'standard' | 'weekday';
export const NEW_PLAN_TEMPLATES: NewPlanTemplate[] = ['standard', 'weekday'];

/**
 * A built-in template as plan items: the slots it fills, each with the Mass Order text it names, labelled in the operator's language.
 * Standard Sunday fills none, so a plan made from it is the slots, empty, with nothing stored and no additional items.
 */
export function builtInItems(id: string, lang: 'en' | 'tl' | 'ceb'): PlanItem[] {
  const template = BUILT_IN_TEMPLATES.find((tpl) => tpl.id === id);
  let items: PlanItem[] = [];
  for (const fill of template?.fills ?? []) {
    const part = MASS_ORDER.find((p) => p.id === fill.sourceId);
    if (!part || !slotById(fill.slot)) continue;
    items = placeInSlot(items, fill.slot, { module: 'mass_order', sourceId: part.id, label: massPartName(part, lang) });
  }
  return items;
}
