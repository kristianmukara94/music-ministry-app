// The day's readings as the Lectionary shows them and as they go to the Holy Mass: all six parts for a date, each with its full text and the
// slides it plays as, and the three ways a reading leaves the Lectionary (Go Live now, the Service Queue, a Mass plan).
//
// The texts come from the operator's own Lectionary library and nowhere else: they are copyrighted and vary by region, so the app never
// ships or downloads them (see electron/lectionary.js). A part with nothing saved is resolved as empty, for the operator to paste in, or
// drafted from the offline Bible: from the citation saved for it, or the one the built-in Ordo (src/data/lectionary_ordo.json) gives the day.
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi } from '../state/ui';
import { readingSlides } from '../lectionary/pages';
import { GOSPEL_ACCLAMATION, READING_TYPES, type LectionaryDay, type ReadingRow, type ReadingType } from '../lectionary/types';
import { GOSPEL, hasResponse, intoReadingSlots, readingItem, readingSlotOf, withAllReadings } from '../../shared/daily-readings.js';
import { indexOfSlot, placeInSlot } from '../../shared/mass-slots.js';
import { stageReading } from '../planner/routing';
import { loadPlanToQueue, queuePlanOrQuick, syncQueueIfLoaded } from '../planner/plan-api';
import { fromScripture, resolveCitationToText, type ResolvedScripture } from './citationResolver';
import { ordoDayOf, type Ordo, type OrdoDay } from '../../shared/liturgical-day.js';
import ordo from '../data/lectionary_ordo.json';

/** How the reader closes the part: "The word of the Lord." after a reading, "The Gospel of the Lord." after the Gospel, or nothing. */
export type ReadingEnding = 'word' | 'gospel' | null;

export interface ResolvedReading extends ReadingRow {
  /** Text is saved for the date. */
  saved: boolean;
  /** The slides it plays as, the same ones Mass Live steps through with its numbered chips. */
  slides: string[];
  ending: ReadingEnding;
  /** Whether a Holy Mass plan can hold it. The Gospel Acclamation is for Praise & Worship, so it cannot. */
  forMass: boolean;
}

export interface ResolvedDay {
  date: string;
  seasonInfo: string;
  /** All six parts, in Mass order, saved or not. */
  readings: ResolvedReading[];
}

const endingOf = (readingType: ReadingType): ReadingEnding =>
  readingType === GOSPEL ? 'gospel' : readingType === 'First Reading' || readingType === 'Second Reading' ? 'word' : null;

/** A loaded day as the six parts the Lectionary cards show. */
export function resolveReadings(day: LectionaryDay): ResolvedDay {
  const readings = READING_TYPES.map((readingType): ResolvedReading => {
    const row = day.readings.find((r) => r.readingType === readingType);
    const rawText = row?.rawText ?? '';
    return {
      readingType,
      citation: row?.citation ?? '',
      congregationResponse: row?.congregationResponse ?? '',
      rawText,
      style: row?.style ?? null,
      saved: Boolean(rawText.trim()),
      slides: rawText.trim() ? readingSlides(readingType, rawText) : [],
      ending: endingOf(readingType),
      forMass: readingType !== GOSPEL_ACCLAMATION,
    };
  });
  return { date: day.date, seasonInfo: day.seasonInfo, readings };
}

/** All six parts saved for a date. */
export async function resolveDay(date: string): Promise<ResolvedDay> {
  return resolveReadings(await bridge.lectionary.getDay(date));
}

/** The liturgical day of `date` ("YYYY-MM-DD") in the built-in Ordo, with its citations. Never a Prayer of the Faithful. */
export const ordoDay = (date: string): OrdoDay => ordoDayOf(ordo as Ordo, date);

/** The citation a part reads from: the one saved for the date, or else the built-in Ordo's. Empty when there is neither. */
export function citationFor(day: LectionaryDay, readingType: ReadingType): string {
  return day.readings.find((r) => r.readingType === readingType)?.citation.trim() || ordoDay(day.date).citations[readingType as keyof OrdoDay['citations']] || '';
}

/**
 * Bible text for every scripture part of the day with no text saved, read from its citation (see citationFor) in `translationId`. A
 * citation the Bible cannot answer is left out, so its part stays empty for the operator. Nothing is saved.
 */
export async function resolveDrafts(day: LectionaryDay, translationId: string): Promise<Partial<Record<ReadingType, ResolvedScripture>>> {
  const wanted = READING_TYPES.filter((type) => fromScripture(type) && !day.readings.find((r) => r.readingType === type)?.rawText.trim() && citationFor(day, type));
  const results = await Promise.all(wanted.map(async (type) => [type, await resolveCitationToText(citationFor(day, type), type, translationId).catch(() => null)] as const));
  const drafts: Partial<Record<ReadingType, ResolvedScripture>> = {};
  for (const [type, out] of results) if (out?.status === 'ok') drafts[type] = out.scripture;
  return drafts;
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * Whether a saved part's text is exactly what the offline Bible gives for its citation in one of `translationIds`: a draft the operator
 * saved as it came, not text they pasted or edited, so it can be drafted again in another language.
 */
async function isBibleDraft(row: ReadingRow, citation: string, translationIds: string[]): Promise<boolean> {
  for (const id of translationIds) {
    const out = await resolveCitationToText(citation, row.readingType, id).catch(() => null);
    if (out?.status === 'ok' && sameText(out.scripture.text, row.rawText)) return true;
  }
  return false;
}

export interface BibleFillResult {
  /** The parts saved to the Lectionary from the Bible. */
  saved: ReadingType[];
  /** The parts with text the operator saved themselves, left as they are. */
  own: ReadingType[];
  /** The parts with no citation, or one the Bible cannot answer, left empty. */
  unresolved: ReadingType[];
}

/**
 * Drafts the day's scripture parts from the offline Bible in `translationId` (the built-in Ordo's citations, or the ones saved for the date)
 * and saves them to the Lectionary, so a Holy Mass plan can point at them: every part with no text saved, and with `redraft` every part whose
 * text is a Bible draft from one of `redraftFrom` (another language's translation). Text the operator pasted or edited is never replaced.
 * The Prayer of the Faithful is the parish's own and is never drafted.
 */
export async function fillDayFromBible(date: string, translationId: string, { redraftFrom = [] as string[] } = {}): Promise<BibleFillResult> {
  const day = await bridge.lectionary.getDay(date);
  const seasonInfo = day.seasonInfo || ordoDay(date).name;
  const result: BibleFillResult = { saved: [], own: [], unresolved: [] };
  for (const type of READING_TYPES.filter(fromScripture)) {
    const row = day.readings.find((r) => r.readingType === type);
    const citation = citationFor(day, type);
    if (row?.rawText.trim() && !(citation && redraftFrom.length > 0 && (await isBibleDraft(row, citation, redraftFrom)))) {
      result.own.push(type);
      continue;
    }
    const out = citation ? await resolveCitationToText(citation, type, translationId).catch(() => null) : null;
    if (out?.status !== 'ok') {
      result.unresolved.push(type);
      continue;
    }
    await bridge.lectionary.saveReading({
      date,
      readingType: type,
      seasonInfo,
      citation: row?.citation || out.scripture.citation,
      congregationResponse: hasResponse(type) ? (row?.congregationResponse ?? '') : '',
      rawText: out.scripture.text,
      style: row?.style ?? null,
    });
    result.saved.push(type);
  }
  return result;
}

/** Tells the Mass planner that a reading was saved, cleared or applied, so it reads its plan and library again. */
export function notifyLectionaryChanged(): void {
  setUi((s) => ({ lectionaryRevision: s.lectionaryRevision + 1 }));
}

/** ▶ Go Live Now: stages the saved reading and takes it to the projector at once. Resolves false when nothing is saved for it. */
export async function goLiveReading(date: string, readingType: ReadingType): Promise<boolean> {
  if (!(await stageReading(date, readingType))) return false;
  dispatch({ type: 'projector/take' });
  return true;
}

export type QueueAddResult =
  | { status: 'added'; planId: number }
  | { status: 'already'; planId: number }
  /** The reading's slot holds the operator's own choice, `label`. Ask before calling again with `replace`. */
  | { status: 'occupied'; planId: number; label: string };

/**
 * + Add to Service Queue: puts one saved reading in the plan loaded in the Service Queue (or a new "Quick passages" plan), in its slot in
 * the Mass. A slot holding something
 * else (a sung psalm) is only replaced with `replace`. The queue is reloaded with CURRENT kept on its row, so nothing on air moves.
 */
export async function addReadingToQueue(date: string, readingType: ReadingType, { replace = false } = {}): Promise<QueueAddResult> {
  if (readingType === GOSPEL_ACCLAMATION) throw new Error('The Gospel Acclamation is for Praise & Worship. It cannot be added to a Holy Mass plan.');
  const planId = await queuePlanOrQuick();
  const plan = await bridge.plans.get(planId);
  const wanted = readingItem(date, readingType);
  if (plan.items.some((it) => it.module === wanted.module && it.sourceId === wanted.sourceId && !it.stale)) return { status: 'already', planId };

  // Every reading has its slot. One holding the operator's own choice (a sung psalm, a note) is replaced only when asked.
  const slot = readingSlotOf(readingType);
  if (!slot) throw new Error(`${readingType} has no place in a Holy Mass plan.`);
  const current = intoReadingSlots(plan.items).items;
  const existing = current[indexOfSlot(current, slot)];
  if (existing && !existing.stale && existing.module !== 'lectionary' && !replace) return { status: 'occupied', planId, label: existing.label };
  const items = placeInSlot(current, slot, wanted);
  await bridge.plans.save(planId, items);
  await loadPlanToQueue(planId);
  return { status: 'added', planId };
}

export type ApplyAllResult =
  | { status: 'noPlan' }
  | { status: 'applied'; planId: number; planName: string; placed: string[]; missing: string[]; kept: string[] };

/**
 * ⚡ Apply All Readings to Mass Plan: puts every reading saved for `date` into the Holy Mass plan for that date (see withAllReadings): the one
 * loaded in the Service Queue when it is for that date, otherwise the first plan made for it. With no plan for the date, nothing is changed.
 * `confirmReplace` is asked, with the labels, before a slot holding the operator's own choice (a sung psalm) is replaced; a no keeps it.
 */
export async function applyAllReadings(date: string, confirmReplace: (labels: string[]) => boolean): Promise<ApplyAllResult> {
  const plans = (await bridge.plans.list()).filter((p) => p.liturgicalDate === date);
  if (plans.length === 0) return { status: 'noPlan' };
  const queued = useLive.getState().state.queuePlanId;
  const target = plans.find((p) => p.id === queued) ?? plans[0];

  const [plan, day] = await Promise.all([bridge.plans.get(target.id), bridge.lectionary.getDay(date)]);
  const own = withAllReadings(plan.items, date, day, { replace: false }).slots.kept;
  const ownLabels = own.map((slot) => plan.items[indexOfSlot(plan.items, slot)]?.label ?? slot);
  const replace = own.length === 0 || confirmReplace(ownLabels);
  const out = withAllReadings(plan.items, date, day, { replace });

  await bridge.plans.save(target.id, out.items);
  syncQueueIfLoaded(target.id, (await bridge.plans.get(target.id)).items);
  notifyLectionaryChanged();
  return { status: 'applied', planId: target.id, planName: target.name, placed: out.placed, missing: out.missing, kept: replace ? [] : ownLabels };
}
