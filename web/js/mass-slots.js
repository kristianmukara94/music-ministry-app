// The Holy Mass order of the Philippines, as the church laptop has it (shared/mass-slots.js): 28 slots in the four parts of the Mass. The
// website cannot load the laptop's files, so the list is repeated here, and a test keeps the two equal. A slot is a place in the Holy Mass; a
// plan item names the slot it fills by number, 1 to 28. The first 17 slots keep the numbers they always had; the slots added for the full
// order of Mass are 18 to 28. `position` is the slot's place in the Mass, the number shown. Liturgical names stay in English.
//
// `group` is the plan group the slot's items are saved in. It is the laptop's liturgical block, so an item stays in the same block on both sides.
// `category` is the song category the song list is narrowed to, and `kind` is 'song' (a hymn from the church's list, or typed text), 'reading'
// (a reading of the day) or 'text' (a spoken part, typed).

const SLOTS = [
  // 1. Introductory Rites
  { number: 1, group: 'introductory', name: 'Entrance Hymn', kind: 'song', category: 'Entrance Procession' },
  { number: 2, group: 'introductory', name: 'I Confess (Confiteor)', kind: 'text' },
  { number: 3, group: 'introductory', name: 'Lord, Have Mercy (Kyrie)', kind: 'song', category: 'Kyrie' },
  { number: 18, group: 'introductory', name: 'Glory to God (Gloria)', kind: 'song', category: 'Gloria' },
  { number: 19, group: 'introductory', name: 'Opening Prayer (Collect)', kind: 'text' },
  // 2. Liturgy of the Word
  { number: 20, group: 'word', name: 'First Reading', kind: 'reading' },
  { number: 4, group: 'word', name: 'Responsorial Psalm', kind: 'song', category: 'Responsorial Psalm' },
  { number: 21, group: 'word', name: 'Second Reading', kind: 'reading' },
  { number: 5, group: 'word', name: 'Gospel Acclamation', kind: 'song', category: 'Gospel Acclamation' },
  { number: 22, group: 'word', name: 'Holy Gospel', kind: 'reading' },
  { number: 23, group: 'word', name: 'Homily', kind: 'text' },
  { number: 24, group: 'word', name: 'Profession of Faith (Creed)', kind: 'text' },
  { number: 6, group: 'word', name: 'Prayer of the Faithful', kind: 'text' },
  // 3. Liturgy of the Eucharist
  { number: 7, group: 'eucharist', name: 'Offertory / Presentation of Gifts', kind: 'song', category: 'Preparation of the Gifts' },
  { number: 8, group: 'eucharist', name: 'May the Lord Accept the Sacrifice', kind: 'text' },
  { number: 9, group: 'eucharist', name: 'Holy, Holy, Holy (Sanctus)', kind: 'song', category: 'Holy, Holy, Holy' },
  { number: 10, group: 'eucharist', name: 'Memorial Acclamation', kind: 'song', category: 'Memorial Acclamation' },
  { number: 13, group: 'eucharist', name: 'Doxology', kind: 'text' },
  { number: 11, group: 'eucharist', name: 'Great Amen', kind: 'song', category: 'Great Amen' },
  { number: 12, group: 'eucharist', name: "The Lord's Prayer (Our Father)", kind: 'song', category: 'Our Father' },
  { number: 25, group: 'eucharist', name: 'Sign of Peace', kind: 'text' },
  { number: 14, group: 'eucharist', name: 'Lamb of God (Agnus Dei)', kind: 'song', category: 'Lamb of God' },
  { number: 15, group: 'eucharist', name: 'Lord, I Am Not Worthy', kind: 'text' },
  { number: 16, group: 'communion', name: 'Communion Hymn', kind: 'song', category: 'Communion Procession' },
  { number: 26, group: 'communion', name: 'Prayer after Communion', kind: 'text' },
  // 4. Concluding Rites
  { number: 27, group: 'concluding', name: 'Parish Announcements', kind: 'text' },
  { number: 28, group: 'concluding', name: 'Final Blessing & Dismissal', kind: 'text' },
  { number: 17, group: 'concluding', name: 'Recessional Hymn', kind: 'song', category: 'Recessional' },
];

/** The slots in Mass order, each with its `position` in the Mass. */
export const MASS_SLOTS = SLOTS.map((slot, i) => ({ ...slot, position: i + 1 }));

/** The four parts of the Mass, in order. `groups` are the plan groups a part holds; `group` is its first. */
export const MASS_SECTIONS = [
  { group: 'introductory', groups: ['introductory'], number: 1, title: 'Introductory Rites' },
  { group: 'word', groups: ['word'], number: 2, title: 'Liturgy of the Word' },
  { group: 'eucharist', groups: ['eucharist', 'communion'], number: 3, title: 'Liturgy of the Eucharist' },
  { group: 'concluding', groups: ['concluding'], number: 4, title: 'Concluding Rites' },
];

export const SLOT_COUNT = MASS_SLOTS.length;

/** The slot a number names, or null for a number that is not 1 to 28. */
export const slotOfNumber = (n) => (Number.isInteger(n) ? MASS_SLOTS.find((slot) => slot.number === n) ?? null : null);

/**
 * The slot each step of the website's earlier editor stands for, by step number. A plan saved by that editor keeps its steps' keys ("4" for
 * the Kyrie) and has no slots, so the editor reads such an item into the slot it stands for. A step with no slot (Greeting, Preface,
 * Dismissal …) is not here and stays an other step.
 */
export const LEGACY_STEP_SLOT = {
  1: 1, // Entrance Procession
  4: 3, // Kyrie
  5: 18, // Gloria
  6: 19, // Collect / Opening Prayer
  7: 20, // First Reading
  8: 4, // Responsorial Psalm
  9: 21, // Second Reading
  10: 5, // Gospel Acclamation
  11: 22, // Gospel Reading
  12: 23, // Homily
  13: 24, // Profession of Faith (Creed)
  14: 6, // Prayer of the Faithful
  15: 7, // Preparation of the Gifts
  18: 9, // Holy, Holy, Holy
  20: 10, // Memorial Acclamation
  21: 11, // Great Amen
  22: 12, // Our Father
  23: 25, // Sign of Peace
  24: 14, // Lamb of God
  25: 16, // Communion Procession
  27: 26, // Prayer after Communion
  28: 27, // Announcements
  29: 28, // Final Blessing
  31: 17, // Recessional
};
