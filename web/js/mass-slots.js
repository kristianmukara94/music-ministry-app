// The Holy Mass order of the Philippines, as the church laptop has it (shared/mass-slots.js): 28 slots in the four parts of the Mass. The
// website cannot load the laptop's files, so the list is repeated here, and a test keeps the two equal. A slot is a place in the Holy Mass; a
// plan item names the slot it fills by number, 1 to 28. The first 17 slots keep the numbers they always had; the slots added for the full
// order of Mass are 18 to 28. `position` is the slot's place in the Mass, the number shown. Liturgical names stay in English.
//
// `group` is the plan group the slot's items are saved in. It is the laptop's liturgical block, so an item stays in the same block on both sides.
// `category` is the song category the song list is narrowed to, and `kind` is 'song' (a hymn from the church's list, or typed text), 'reading'
// (a reading of the day) or 'text' (a spoken part, typed). `id` is the laptop's slot id; `optional` and `sundayOnly` are the laptop's own
// flags, so liturgical-calendar.js (a byte copy of the laptop's) counts the slots a day needs exactly as the laptop's calendar does.

const SLOTS = [
  // 1. Introductory Rites
  { number: 1, group: 'introductory', id: 'entrance', name: 'Entrance Hymn', kind: 'song', category: 'Entrance Procession' },
  { number: 2, group: 'introductory', id: 'confess', name: 'I Confess (Confiteor)', kind: 'text' },
  { number: 3, group: 'introductory', id: 'kyrie', name: 'Lord, Have Mercy (Kyrie)', kind: 'song', category: 'Kyrie' },
  { number: 18, group: 'introductory', id: 'gloria', name: 'Glory to God (Gloria)', kind: 'song', category: 'Gloria', sundayOnly: true },
  { number: 19, group: 'introductory', id: 'collect', name: 'Opening Prayer (Collect)', kind: 'text' },
  // 2. Liturgy of the Word
  { number: 20, group: 'word', id: 'first-reading', name: 'First Reading', kind: 'reading' },
  { number: 4, group: 'word', id: 'psalm', name: 'Responsorial Psalm', kind: 'song', category: 'Responsorial Psalm' },
  { number: 21, group: 'word', id: 'second-reading', name: 'Second Reading', kind: 'reading', sundayOnly: true },
  { number: 5, group: 'word', id: 'gospel-acclamation', name: 'Gospel Acclamation', kind: 'song', category: 'Gospel Acclamation' },
  { number: 22, group: 'word', id: 'gospel', name: 'Holy Gospel', kind: 'reading' },
  { number: 23, group: 'word', id: 'homily', name: 'Homily', kind: 'text', optional: true },
  { number: 24, group: 'word', id: 'creed', name: 'Profession of Faith (Creed)', kind: 'text' },
  { number: 6, group: 'word', id: 'prayer-faithful', name: 'Prayer of the Faithful', kind: 'text' },
  // 3. Liturgy of the Eucharist
  { number: 7, group: 'eucharist', id: 'offertory', name: 'Offertory / Presentation of Gifts', kind: 'song', category: 'Preparation of the Gifts' },
  { number: 8, group: 'eucharist', id: 'accept-sacrifice', name: 'May the Lord Accept the Sacrifice', kind: 'text' },
  { number: 9, group: 'eucharist', id: 'sanctus', name: 'Holy, Holy, Holy (Sanctus)', kind: 'song', category: 'Holy, Holy, Holy' },
  { number: 10, group: 'eucharist', id: 'memorial-acclamation', name: 'Memorial Acclamation', kind: 'song', category: 'Memorial Acclamation' },
  { number: 13, group: 'eucharist', id: 'doxology', name: 'Doxology', kind: 'text' },
  { number: 11, group: 'eucharist', id: 'great-amen', name: 'Great Amen', kind: 'song', category: 'Great Amen' },
  { number: 12, group: 'eucharist', id: 'lords-prayer', name: "The Lord's Prayer (Our Father)", kind: 'song', category: 'Our Father' },
  { number: 25, group: 'eucharist', id: 'sign-of-peace', name: 'Sign of Peace', kind: 'text', optional: true },
  { number: 14, group: 'eucharist', id: 'agnus-dei', name: 'Lamb of God (Agnus Dei)', kind: 'song', category: 'Lamb of God' },
  { number: 15, group: 'eucharist', id: 'not-worthy', name: 'Lord, I Am Not Worthy', kind: 'text' },
  { number: 16, group: 'communion', id: 'communion', name: 'Communion Hymn', kind: 'song', category: 'Communion Procession' },
  { number: 26, group: 'communion', id: 'prayer-after-communion', name: 'Prayer after Communion', kind: 'text' },
  // 4. Concluding Rites
  { number: 27, group: 'concluding', id: 'announcements', name: 'Parish Announcements', kind: 'text', optional: true },
  { number: 28, group: 'concluding', id: 'final-blessing', name: 'Final Blessing & Dismissal', kind: 'text' },
  { number: 17, group: 'concluding', id: 'recessional', name: 'Recessional Hymn', kind: 'song', category: 'Recessional' },
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
