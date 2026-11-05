// The Holy Mass order of the Philippines (the Roman Missal as the CBCP has it): 28 slots in the four parts of the Mass, as the planner shows
// them. Pure data and rules, so they can be tested.
//
// A slot is a named place in the Mass (First Reading, Offertory). A plan item with a `slot` fills that place; an item with none is an additional
// item (a note, an announcement, a plan from before slots). Every plan shows every slot, filled or empty, so no placeholder rows are stored: an
// empty slot is simply a slot no item names. Within a block the slots come first in Mass order, then the additional items.
//
// Ids and numbers. `id` is what a saved plan stores and `number` is how the website names a slot. Both stay the same for good: the first 17
// slots keep the numbers they always had, and the slots added for the full order of Mass are 18 to 28. `position` (1 to 28) is the slot's
// place in the Mass, the number the operator sees.
//
// Blocks and parts. `block` is the plan's liturgical block (the Service Queue plays a plan block by block). The four parts of the Mass group
// them: the Communion Rite keeps its own block, inside the Liturgy of the Eucharist.
//
// `name` is the slot's English name; shared/mass-language.js has the Tagalog and Cebuano ones and the default titles.
// kind: 'song' (a hymn, offered from the Hymn Library under songCategory), 'reading' (a reading from the Lectionary) or 'text' (a spoken part:
// typed text or a Mass Order text). massOrderId is the Mass Order text that matches the slot, when the app has one. isReading marks the slots
// the Lectionary fills for the plan's date (see shared/daily-readings.js). sundayOnly marks a part said on Sundays and solemnities; optional,
// a part a Mass may leave out. presets are the opening words of a spoken slot's own text, for a one-click fill.

const SLOTS = [
  // 1. Introductory Rites
  { id: 'entrance', number: 1, type: 'ENTRANCE_HYMN', block: 'introductory', name: 'Entrance Hymn', kind: 'song', songCategory: 'Entrance Procession' },
  { id: 'confess', number: 2, type: 'CONFITEOR', block: 'introductory', name: 'I Confess (Confiteor)', kind: 'text' },
  { id: 'kyrie', number: 3, type: 'KYRIE', block: 'introductory', name: 'Lord, Have Mercy (Kyrie)', kind: 'song', songCategory: 'Kyrie', massOrderId: 'kyrie' },
  { id: 'gloria', number: 18, type: 'GLORIA', block: 'introductory', name: 'Glory to God (Gloria)', kind: 'song', songCategory: 'Gloria', massOrderId: 'gloria', sundayOnly: true },
  { id: 'collect', number: 19, type: 'COLLECT', block: 'introductory', name: 'Opening Prayer (Collect)', kind: 'text' },
  // 2. Liturgy of the Word
  { id: 'first-reading', number: 20, type: 'FIRST_READING', block: 'word', name: 'First Reading', kind: 'reading', isReading: true },
  { id: 'psalm', number: 4, type: 'RESPONSORIAL_PSALM', block: 'word', name: 'Responsorial Psalm', kind: 'song', songCategory: 'Responsorial Psalm', isReading: true },
  { id: 'second-reading', number: 21, type: 'SECOND_READING', block: 'word', name: 'Second Reading', kind: 'reading', isReading: true, sundayOnly: true },
  { id: 'gospel-acclamation', number: 5, type: 'GOSPEL_ACCLAMATION', block: 'word', name: 'Gospel Acclamation', kind: 'song', songCategory: 'Gospel Acclamation' },
  { id: 'gospel', number: 22, type: 'GOSPEL', block: 'word', name: 'Holy Gospel', kind: 'reading', isReading: true },
  { id: 'homily', number: 23, type: 'HOMILY', block: 'word', name: 'Homily', kind: 'text', optional: true },
  { id: 'creed', number: 24, type: 'CREED', block: 'word', name: 'Profession of Faith (Creed)', kind: 'text', massOrderId: 'credo' },
  { id: 'prayer-faithful', number: 6, type: 'PRAYER_OF_THE_FAITHFUL', block: 'word', name: 'Prayer of the Faithful', kind: 'text', isReading: true, presets: ['Lord, hear our prayer'] },
  // 3. Liturgy of the Eucharist
  { id: 'offertory', number: 7, type: 'OFFERTORY', block: 'eucharist', name: 'Offertory / Presentation of Gifts', kind: 'song', songCategory: 'Preparation of the Gifts' },
  { id: 'accept-sacrifice', number: 8, type: 'ACCEPT_SACRIFICE', block: 'eucharist', name: 'May the Lord Accept the Sacrifice', kind: 'text', presets: ['May the Lord accept the sacrifice at your hands'] },
  { id: 'sanctus', number: 9, type: 'SANCTUS', block: 'eucharist', name: 'Holy, Holy, Holy (Sanctus)', kind: 'song', songCategory: 'Holy, Holy, Holy', massOrderId: 'sanctus' },
  { id: 'memorial-acclamation', number: 10, type: 'MEMORIAL_ACCLAMATION', block: 'eucharist', name: 'Memorial Acclamation', kind: 'song', songCategory: 'Memorial Acclamation', massOrderId: 'memorial-acclamation' },
  // The doxology that closes the Eucharistic Prayer ("Through him, and with him"), which the Great Amen answers.
  { id: 'doxology', number: 13, type: 'DOXOLOGY', block: 'eucharist', name: 'Doxology', kind: 'text', presets: ['Through him, and with him, and in him'] },
  { id: 'great-amen', number: 11, type: 'GREAT_AMEN', block: 'eucharist', name: 'Great Amen', kind: 'song', songCategory: 'Great Amen' },
  { id: 'lords-prayer', number: 12, type: 'LORD_PRAYER', block: 'eucharist', name: "The Lord's Prayer (Our Father)", kind: 'song', songCategory: 'Our Father', massOrderId: 'pater-noster' },
  { id: 'sign-of-peace', number: 25, type: 'SIGN_OF_PEACE', block: 'eucharist', name: 'Sign of Peace', kind: 'text', optional: true },
  { id: 'agnus-dei', number: 14, type: 'AGNUS_DEI', block: 'eucharist', name: 'Lamb of God (Agnus Dei)', kind: 'song', songCategory: 'Lamb of God', massOrderId: 'agnus-dei' },
  { id: 'not-worthy', number: 15, type: 'NOT_WORTHY', block: 'eucharist', name: 'Lord, I Am Not Worthy', kind: 'text', presets: ['Lord, I am not worthy that you should enter under my roof'] },
  { id: 'communion', number: 16, type: 'COMMUNION_HYMN', block: 'communion', name: 'Communion Hymn', kind: 'song', songCategory: 'Communion Procession' },
  { id: 'prayer-after-communion', number: 26, type: 'PRAYER_AFTER_COMMUNION', block: 'communion', name: 'Prayer after Communion', kind: 'text' },
  // 4. Concluding Rites
  { id: 'announcements', number: 27, type: 'ANNOUNCEMENTS', block: 'concluding', name: 'Parish Announcements', kind: 'text', optional: true },
  { id: 'final-blessing', number: 28, type: 'FINAL_BLESSING', block: 'concluding', name: 'Final Blessing & Dismissal', kind: 'text' },
  { id: 'recessional', number: 17, type: 'RECESSIONAL_HYMN', block: 'concluding', name: 'Recessional Hymn', kind: 'song', songCategory: 'Recessional' },
];

/** The slots in Mass order, each with its `position` in the Mass (1 to 28). */
export const MASS_SLOTS = SLOTS.map((slot, i) => ({ ...slot, position: i + 1 }));

/** The plan's liturgical blocks, in Mass order. */
export const MASS_BLOCKS = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];

/**
 * The four parts of the Mass, with the name each is shown under. `blocks` are the plan blocks a part holds; `block` is its first, which names
 * the part where one block is needed (a collapsed part, the remembered choice).
 */
export const MASS_SECTIONS = [
  { id: 'introductory_rites', block: 'introductory', blocks: ['introductory'], number: 1, name: 'Introductory Rites' },
  { id: 'liturgy_of_the_word', block: 'word', blocks: ['word'], number: 2, name: 'Liturgy of the Word' },
  { id: 'liturgy_of_the_eucharist', block: 'eucharist', blocks: ['eucharist', 'communion'], number: 3, name: 'Liturgy of the Eucharist' },
  { id: 'concluding_rites', block: 'concluding', blocks: ['concluding'], number: 4, name: 'Concluding Rites' },
];

export const SLOT_IDS = MASS_SLOTS.map((slot) => slot.id);

const BY_ID = new Map(MASS_SLOTS.map((slot) => [slot.id, slot]));
const RANK = new Map(MASS_SLOTS.map((slot, i) => [slot.id, i]));

export const slotById = (id) => BY_ID.get(id) ?? null;
export const isSlotId = (id) => BY_ID.has(id);
export const slotsOfBlock = (block) => MASS_SLOTS.filter((slot) => slot.block === block);

/** The part of the Mass a block is in, or null for a block that is not one of the plan's. */
export const sectionOfBlock = (block) => MASS_SECTIONS.find((section) => section.blocks.includes(block)) ?? null;

/** The slots of a part of the Mass (by its id), in Mass order. */
export function slotsOfSection(sectionId) {
  const section = MASS_SECTIONS.find((s) => s.id === sectionId);
  return section ? MASS_SLOTS.filter((slot) => section.blocks.includes(slot.block)) : [];
}

/** The index in `items` of the item filling a slot, or -1 when the slot is empty. */
export const indexOfSlot = (items, slotId) => items.findIndex((item) => item.slot === slotId);

const filledOf = (items, slots) => ({ filled: slots.filter((slot) => indexOfSlot(items, slot.id) >= 0).length, total: slots.length });

/** The slots of a block that have an item, and how many the block has. */
export const filledIn = (items, block) => filledOf(items, slotsOfBlock(block));

/** The slots of a part of the Mass that have an item, and how many the part has. */
export const filledInSection = (items, sectionId) => filledOf(items, slotsOfSection(sectionId));

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
    at = items.findIndex((it) => MASS_BLOCKS.indexOf(it.block) > MASS_BLOCKS.indexOf(slot.block));
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
 * Standard Sunday is every slot, empty, to fill from the Hymn Library and the Lectionary. Weekday has the sung parts of the Ordinary as their
 * Mass Order texts.
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
// The website knows a slot by its number (1 to 28), which is the same in every version; the laptop stores its id.

/** The highest slot number. */
export const SLOT_COUNT = MASS_SLOTS.length;

/** A slot's number, or null for an id that is not a slot. */
export const slotNumberOf = (id) => slotById(id)?.number ?? null;

/** The slot id for a number from 1 to 28, or null for anything else. */
export function slotIdOfNumber(n) {
  return Number.isInteger(n) ? MASS_SLOTS.find((slot) => slot.number === n)?.id ?? null : null;
}
