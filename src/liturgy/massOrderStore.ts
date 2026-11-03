import { create } from 'zustand';
import { bridge } from '../live/bridge';
import { overridesFromRows, type MassOrderEntry, type MassOrderLang, type MassOrderOverrides } from '../../shared/mass-order-text.js';

interface MassOrderTexts {
  /** The parish's own words and titles, by part and language. A built-in part missing here shows the standard text and name. */
  overrides: MassOrderOverrides;
  /** The parish's own items, in the order they were made. */
  custom: { id: string; createdAt: string }[];
  /** Bumped on every change, so a list that shows the parts can redraw. */
  revision: number;
}

type Entries = Partial<Record<MassOrderLang, MassOrderEntry>>;

/**
 * The parish's Holy Mass Order words, titles and items in this window. Loaded once, and again whenever any window changes them, so the library,
 * the planner's chips and cards, and every slide staged from now on use the new words and titles (see massPartName and massPartFrame).
 */
export const useMassOrderTexts = create<MassOrderTexts>(() => ({ overrides: {}, custom: [], revision: 0 }));

export async function reloadMassOrderTexts(): Promise<void> {
  const { texts, custom } = await bridge.massOrder.list();
  useMassOrderTexts.setState((s) => ({ overrides: overridesFromRows(texts), custom, revision: s.revision + 1 }));
}

/** Saves the words and titles of one part for the languages given, then reloads, so this window has them before the editor closes. */
export async function saveMassOrderEntries(partId: string, entries: Entries): Promise<void> {
  await bridge.massOrder.saveAll(partId, entries);
  await reloadMassOrderTexts();
}

/** Makes a parish item. Resolves to its id. */
export async function createMassOrderItem(entries: Entries): Promise<string> {
  const id = await bridge.massOrder.create(entries);
  await reloadMassOrderTexts();
  return id;
}

/** Back to the standard text and title of a built-in part in one language. */
export async function resetMassOrderText(partId: string, lang: MassOrderLang): Promise<void> {
  await bridge.massOrder.reset(partId, lang);
  await reloadMassOrderTexts();
}

/** Deletes a parish item. */
export async function deleteMassOrderItem(partId: string): Promise<void> {
  await bridge.massOrder.remove(partId);
  await reloadMassOrderTexts();
}

void reloadMassOrderTexts().catch(() => undefined);
bridge.massOrder.onChanged(() => void reloadMassOrderTexts().catch(() => undefined));
