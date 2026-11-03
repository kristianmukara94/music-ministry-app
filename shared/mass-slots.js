// The Holy Mass order of 17 slots in five sections, as the planner shows it. Pure data and rules, so they can be tested.
//
// A slot is a named place in the Mass (7. Offertory Hymn). A plan item with a `slot` fills that place; an item with none is an additional
// item (a note, an announcement, a plan from before slots). Every plan shows all 17 slots, filled or empty, so no placeholder rows are
// stored: an empty slot is simply a slot no item names. The sections follow the plan's liturgical blocks, so the Service Queue still reads the
// plan block by block, and within a block the slots come first in slot order, then the additional items.
//
// Liturgical names stay in English in every language, the way parish worship aids print them.
//
// kind: 'song' (a hymn, offered from the Hymn Library under songCategory) or 'text' (a spoken part: typed text or a Mass Order text).
// massOrderId is the Mass Order text that matches the slot, when the app has one.
// presets are the opening words of a spoken slot's own text, for a one-click fill: the planner stores them as the slot's typed text.

export const MASS_SLOTS = [
  // 1. Introductory Rites
  { id: 'entrance', number: 1, block: 'introductory', name: 'Entrance Hymn', kind: 'song', songCategory: 'Entrance Procession' },
  { id: 'confess', number: 2, block: 'introductory', name: 'I Confess', kind: 'text', presets: ['I confess to almighty God'] },
  { id: 'kyrie', number: 3, block: 'introductory', name: 'Lord, Have Mercy', kind: 'song', songCategory: 'Kyrie', massOrderId: 'kyrie' },
  // 2. Liturgy of the Word
  { id: 'psalm', number: 4, block: 'word', name: 'Responsorial Psalm', kind: 'song', songCategory: 'Responsorial Psalm' },
  { id: 'gospel-acclamation', number: 5, block: 'word', name: 'Gospel Acclamation', kind: 'song', songCategory: 'Gospel Acclamation' },
  { id: 'prayer-faithful', number: 6, block: 'word', name: 'Prayer of the Faithful', kind: 'text', presets: ['Lord, hear our prayer'] },
  // 3. Liturgy of the Eucharist
  { id: 'offertory', number: 7, block: 'eucharist', name: 'Offertory Hymn', kind: 'song', songCategory: 'Preparation of the Gifts' },
  { id: 'accept-sacrifice', number: 8, block: 'eucharist', name: 'May the Lord Accept the Sacrifice', kind: 'text', presets: ['May the Lord accept the sacrifice at your hands'] },
  { id: 'sanctus', number: 9, block: 'eucharist', name: 'Holy, Holy, Holy', kind: 'song', songCategory: 'Holy, Holy, Holy', massOrderId: 'sanctus' },
  { id: 'memorial-acclamation', number: 10, block: 'eucharist', name: 'Memorial Acclamation', kind: 'song', songCategory: 'Memorial Acclamation', massOrderId: 'memorial-acclamation' },
  { id: 'great-amen', number: 11, block: 'eucharist', name: 'Great Amen', kind: 'song', songCategory: 'Great Amen' },
  { id: 'lords-prayer', number: 12, block: 'eucharist', name: "The Lord's Prayer", kind: 'song', songCategory: 'Our Father', massOrderId: 'pater-noster' },
  { id: 'doxology', number: 13, block: 'eucharist', name: 'Doxology', kind: 'text', presets: ['Through him, and with him, and in him'] },
  { id: 'agnus-dei', number: 14, block: 'eucharist', name: 'Lamb of God', kind: 'song', songCategory: 'Lamb of God', massOrderId: 'agnus-dei' },
  { id: 'not-worthy', number: 15, block: 'eucharist', name: 'Lord, I Am Not Worthy', kind: 'text', presets: ['Lord, I am not worthy that you should enter under my roof'] },
  // 4. Communion
  { id: 'communion', number: 16, block: 'communion', name: 'Communion Hymn', kind: 'song', songCategory: 'Communion Procession' },
  // 5. Concluding Rites
  { id: 'recessional', number: 17, block: 'concluding', name: 'Recessional Hymn', kind: 'song', songCategory: 'Recessional' },
];

/** The sections in Mass order, with the name each is shown under. The ids are the plan's liturgical blocks. */
export const MASS_SECTIONS = [
  { block: 'introductory', number: 1, name: 'Introductory Rites' },
  { block: 'word', number: 2, name: 'Liturgy of the Word' },
  { block: 'eucharist', number: 3, name: 'Liturgy of the Eucharist' },
  { block: 'communion', number: 4, name: 'Communion' },
  { block: 'concluding', number: 5, name: 'Concluding Rites' },
];

export const SLOT_IDS = MASS_SLOTS.map((slot) => slot.id);

const BY_ID = new Map(MASS_SLOTS.map((slot) => [slot.id, slot]));
const RANK = new Map(MASS_SLOTS.map((slot, i) => [slot.id, i]));

export const slotById = (id) => BY_ID.get(id) ?? null;
export const isSlotId = (id) => BY_ID.has(id);
export const slotsOfBlock = (block) => MASS_SLOTS.filter((slot) => slot.block === block);

/** The index in `items` of the item filling a slot, or -1 when the slot is empty. */
export const indexOfSlot = (items, slotId) => items.findIndex((item) => item.slot === slotId);

/** The slots of a block that have an item, and how many the block has. */
export function filledIn(items, block) {
  const slots = slotsOfBlock(block);
  return { filled: slots.filter((slot) => indexOfSlot(items, slot.id) >= 0).length, total: slots.length };
}

/**
 * The plan's items with `item` filling `slotId`. An item already in the slot is replaced. A new one goes into its block in slot order: after
 * the slots before it and ahead of the slots after it and of the additional items. The item takes the slot's block and slot id.
 */
export function placeInSlot(items, slotId, item) {
  const slot = slotById(slotId);
  if (!slot) return items;
  const placed = { ...item, block: slot.block, slot: slotId };
  const existing = indexOfSlot(items, slotId);
  if (existing >= 0) return items.map((it, i) => (i === existing ? placed : it));
  const rank = RANK.get(slotId);
  // The block's rows, as positions in `items`. The new item goes before the first row that is an additional item or a later slot.
  const members = items.flatMap((it, i) => (it.block === slot.block ? [i] : []));
  const before = members.find((i) => !items[i].slot || !RANK.has(items[i].slot) || RANK.get(items[i].slot) > rank);
  let at;
  if (before !== undefined) at = before;
  else if (members.length > 0) at = members[members.length - 1] + 1;
  else {
    // A block with nothing in it goes before the first later block, or at the end.
    const order = MASS_SECTIONS.map((s) => s.block);
    at = items.findIndex((it) => order.indexOf(it.block) > order.indexOf(slot.block));
    if (at < 0) at = items.length;
  }
  return [...items.slice(0, at), placed, ...items.slice(at)];
}

/** The plan without the item in a slot. The slot is empty again. */
export function clearSlot(items, slotId) {
  const at = indexOfSlot(items, slotId);
  return at < 0 ? items : items.filter((_, i) => i !== at);
}

/**
 * The item at `index` moved into `slotId`, replacing what was there. The slot it came from is empty after. An item with no slot (an additional
 * item) can be moved into a slot too, and then is no longer an additional one.
 */
export function moveToSlot(items, index, slotId) {
  const moved = items[index];
  if (!moved || !isSlotId(slotId) || moved.slot === slotId) return items;
  const { slot: _from, ...rest } = moved;
  return placeInSlot(items.filter((_, i) => i !== index), slotId, rest);
}

/** The additional items of a block (no slot, or a slot this version does not know), as positions in `items`, in order. */
export const additionalIn = (items, block) => items.flatMap((it, i) => (it.block === block && !isSlotId(it.slot) ? [i] : []));

/**
 * The templates that come with the app, as the slots they fill. `module` and `sourceId` name a Mass Order text; the planner gives each its label.
 * Standard Sunday is the 17 slots, empty, to fill from the Hymn Library. Weekday has the sung parts of the Ordinary as their Mass Order texts.
 */
export const BUILT_IN_TEMPLATES = [
  { id: 'standard', fills: [] },
  {
    id: 'weekday',
    fills: [
      { slot: 'kyrie', module: 'mass_order', sourceId: 'kyrie' },
      { slot: 'sanctus', module: 'mass_order', sourceId: 'sanctus' },
      { slot: 'memorial-acclamation', module: 'mass_order', sourceId: 'memorial-acclamation' },
      { slot: 'lords-prayer', module: 'mass_order', sourceId: 'pater-noster' },
      { slot: 'agnus-dei', module: 'mass_order', sourceId: 'agnus-dei' },
    ],
  },
];

// ---- Slot numbers, for the website ----
// The website knows a slot by its number (1 to 17), which is the same in every version; the laptop stores its id.

/** A slot's number, or null for an id that is not a slot. */
export const slotNumberOf = (id) => slotById(id)?.number ?? null;

/** The slot id for a number from 1 to 17, or null for anything else. */
export function slotIdOfNumber(n) {
  return Number.isInteger(n) ? MASS_SLOTS.find((slot) => slot.number === n)?.id ?? null : null;
}
