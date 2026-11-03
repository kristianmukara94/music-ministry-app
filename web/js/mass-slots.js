// The Holy Mass order of 17 slots in five sections, as the church laptop has it (shared/mass-slots.js). The website cannot load the laptop's
// files, so the list is repeated here, and a test keeps the two equal. A slot is a place in the Holy Mass; a plan item names the slot it fills
// by number, 1 to 17. Liturgical names stay in English.
//
// `group` is the plan group the slot's items are saved in. It is the laptop's liturgical block, so an item stays in the same block on both sides.
// `category` is the song category the song list is narrowed to, and `kind` is 'song' (a hymn from the church's list, or typed text) or 'text'
// (a spoken part, typed).

export const MASS_SLOTS = [
  { number: 1, group: 'introductory', name: 'Entrance Hymn', kind: 'song', category: 'Entrance Procession' },
  { number: 2, group: 'introductory', name: 'I Confess', kind: 'text' },
  { number: 3, group: 'introductory', name: 'Lord, Have Mercy', kind: 'song', category: 'Kyrie' },
  { number: 4, group: 'word', name: 'Responsorial Psalm', kind: 'song', category: 'Responsorial Psalm' },
  { number: 5, group: 'word', name: 'Gospel Acclamation', kind: 'song', category: 'Gospel Acclamation' },
  { number: 6, group: 'word', name: 'Prayer of the Faithful', kind: 'text' },
  { number: 7, group: 'eucharist', name: 'Offertory Hymn', kind: 'song', category: 'Preparation of the Gifts' },
  { number: 8, group: 'eucharist', name: 'May the Lord Accept the Sacrifice', kind: 'text' },
  { number: 9, group: 'eucharist', name: 'Holy, Holy, Holy', kind: 'song', category: 'Holy, Holy, Holy' },
  { number: 10, group: 'eucharist', name: 'Memorial Acclamation', kind: 'song', category: 'Memorial Acclamation' },
  { number: 11, group: 'eucharist', name: 'Great Amen', kind: 'song', category: 'Great Amen' },
  { number: 12, group: 'eucharist', name: "The Lord's Prayer", kind: 'song', category: 'Our Father' },
  { number: 13, group: 'eucharist', name: 'Doxology', kind: 'text' },
  { number: 14, group: 'eucharist', name: 'Lamb of God', kind: 'song', category: 'Lamb of God' },
  { number: 15, group: 'eucharist', name: 'Lord, I Am Not Worthy', kind: 'text' },
  { number: 16, group: 'communion', name: 'Communion Hymn', kind: 'song', category: 'Communion Procession' },
  { number: 17, group: 'concluding', name: 'Recessional Hymn', kind: 'song', category: 'Recessional' },
];

/** The five sections, in order. `group` is the plan group. */
export const MASS_SECTIONS = [
  { group: 'introductory', number: 1, title: 'Introductory Rites' },
  { group: 'word', number: 2, title: 'Liturgy of the Word' },
  { group: 'eucharist', number: 3, title: 'Liturgy of the Eucharist' },
  { group: 'communion', number: 4, title: 'Communion' },
  { group: 'concluding', number: 5, title: 'Concluding Rites' },
];

export const SLOT_COUNT = MASS_SLOTS.length;

/** The slot a number names, or null for a number that is not 1 to 17. */
export const slotOfNumber = (n) => (Number.isInteger(n) ? MASS_SLOTS.find((slot) => slot.number === n) ?? null : null);

/**
 * The slot each step of the website's earlier editor stands for, by step number. A plan saved by that editor keeps its steps' keys ("4" for
 * the Kyrie) and has no slots, so the editor reads such an item into the slot it stands for. A step with no slot (Greeting, Gloria, the
 * readings, the Homily) is not here and stays an other step.
 */
export const LEGACY_STEP_SLOT = {
  1: 1, // Entrance Procession
  4: 3, // Kyrie
  8: 4, // Responsorial Psalm
  10: 5, // Gospel Acclamation
  14: 6, // Prayer of the Faithful
  15: 7, // Preparation of the Gifts
  18: 9, // Holy, Holy, Holy
  20: 10, // Memorial Acclamation
  21: 11, // Great Amen
  22: 12, // Our Father
  24: 14, // Lamb of God
  25: 16, // Communion Procession
  31: 17, // Recessional
};
