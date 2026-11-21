// The plan actions the Planner's list and the Plan Editor share: Duplicate Plan and Delete Plan. Each one talks to the server and says what
// happened in plain words; the page decides where to go next.
import { createPlan, deletePlan, getPlan, savePlan } from './plan-api.js';
import { duplicateRequest, savePayload } from './plan-model.js';
import { forgetPlan } from './planner-header.js';

/**
 * Copies a plan, with its items, onto the same day. Returns { created, updatedAt, message, failed }: `created` is the new plan as the server
 * made it, `failed` says the copy was made but its language could not be copied.
 */
export async function duplicatePlanById(id) {
  const { plan: source } = await getPlan(id);
  const { plan: created } = await createPlan(duplicateRequest(source, crypto.randomUUID()));
  let updatedAt = created.updatedAt;
  let message = `Copied to ${created.name}.`;
  let failed = false;
  // A new plan starts without a language, so a Holy Mass plan's readings language and schedule language are saved onto the copy straight
  // after. The copy is on the same day, so it takes no time: two Holy Masses on one day cannot share one. Set it in the copy's editor.
  if (created.kind !== 'pw' && (source.language || source.massLanguage)) {
    try {
      updatedAt = (await savePlan(savePayload(created, created.items, { language: source.language, massLanguage: source.massLanguage ?? '' }))).savedAt;
    } catch {
      message = `Copied to ${created.name}, but its language was not copied. Open the copy to set it.`;
      failed = true;
    }
  }
  return { created, source, updatedAt, message, failed };
}

/** Deletes a plan for everyone, and forgets it as the Plan Editor tab's plan. */
export async function deletePlanById(id) {
  await deletePlan(id);
  forgetPlan(id);
}

/** What the Delete Plan dialog says about a plan. */
export const deleteWarning = (name) => `“${name}” will be removed for everyone, and from the church laptops at their next sync. This cannot be undone here.`;
