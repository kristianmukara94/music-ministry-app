import { BLOCK_RANK, type LiturgicalBlock, type PlanItem } from './types';

/** Where a drag came from: a library item, or a row already in the plan. */
/** A library item has no block until it is dropped into one. */
export type DragSource = { kind: 'library'; item: Omit<PlanItem, 'block'> } | { kind: 'plan'; index: number };

/**
 * Returns the plan with `source` placed at `slot` inside `block`. `slot` is the
 * position among the block's rows as they are shown, source row included. Items stay
 * grouped in Mass order, so a block can never end up out of sequence.
 */
export function moveInto(items: PlanItem[], source: DragSource, block: LiturgicalBlock, slot: number): PlanItem[] {
  const original = source.kind === 'plan' ? items[source.index] : undefined;
  if (source.kind === 'plan' && !original) return items;
  // The row takes the block it was dropped into, which may differ from where it came from.
  const moved: PlanItem = source.kind === 'plan' ? { ...original!, block } : { ...source.item, block };

  const rest = items.filter((_, i) => !(source.kind === 'plan' && i === source.index));

  // Removing a row above the target shifts the target up by one.
  let targetSlot = slot;
  if (source.kind === 'plan' && items[source.index].block === block) {
    const sourceSlot = items.slice(0, source.index).filter((it) => it.block === block).length;
    if (sourceSlot < slot) targetSlot = slot - 1;
  }

  const members = rest.flatMap((it, i) => (it.block === block ? [i] : []));
  let at: number;
  if (members.length === 0) {
    // An empty block goes before the first later block; otherwise at the end.
    at = rest.findIndex((it) => BLOCK_RANK[it.block] > BLOCK_RANK[block]);
    if (at < 0) at = rest.length;
  } else if (targetSlot < members.length) {
    at = members[Math.max(targetSlot, 0)];
  } else {
    at = members[members.length - 1] + 1;
  }

  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** The rows of one block, in order. */
export function blockRows(items: PlanItem[], block: LiturgicalBlock): PlanItem[] {
  return items.filter((it) => it.block === block);
}

/**
 * Converts a plan into Service Queue entries, one per plan row and in the same order, so a queue position is a plan position (the planner and
 * the in-flow inserts rely on that). Ids are positional, so repeated items stay distinct. Each entry keeps the Holy Mass slot it fills, so Go
 * Live can show all 17 slots around the rows, empty ones too (see massLineup in shared/flow-insert.js): slides put in never hide the order.
 */
export function queueFromPlan(items: PlanItem[]) {
  return items.map((it, i) => ({
    id: `${i}:${it.module}:${it.sourceId}`,
    label: it.label,
    block: it.block,
    module: it.module,
    sourceId: it.sourceId,
    slot: it.slot ?? null,
    stale: it.stale ?? false,
    deleted: it.deleted ?? false,
  }));
}
