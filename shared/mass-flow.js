// The Ordinary of the Mass as 31 steps in five sections, for a new Mass plan. Pure data, so the structure can be tested.
// Liturgical names stay in English in every language, the way parish worship aids print them.
//
// kind: 'song' (a hymn from the Hymn Library, or typed text), 'reading' (typed text, or a passage from the Bible),
// or 'note' (typed text: a presider note or a response). massOrderId is the Mass Order text that matches the step, when
// the app has one; the planner offers it as a choice.

export const MASS_FLOW = [
  // I. Introductory Rites
  { block: 'introductory', id: 'entrance', name: 'Entrance Procession', kind: 'song' },
  { block: 'introductory', id: 'greeting', name: 'Greeting', kind: 'note' },
  { block: 'introductory', id: 'penitential', name: 'Penitential Act', kind: 'note' },
  { block: 'introductory', id: 'kyrie', name: 'Kyrie', kind: 'song', massOrderId: 'kyrie' },
  { block: 'introductory', id: 'gloria', name: 'Gloria', kind: 'song', massOrderId: 'gloria' },
  { block: 'introductory', id: 'collect', name: 'Collect', kind: 'note' },
  // II. Liturgy of the Word
  { block: 'word', id: 'first-reading', name: 'First Reading', kind: 'reading' },
  { block: 'word', id: 'psalm', name: 'Responsorial Psalm', kind: 'song' },
  { block: 'word', id: 'second-reading', name: 'Second Reading', kind: 'reading' },
  { block: 'word', id: 'gospel-acclamation', name: 'Gospel Acclamation', kind: 'song' },
  { block: 'word', id: 'gospel', name: 'Gospel Reading', kind: 'reading' },
  { block: 'word', id: 'homily', name: 'Homily', kind: 'note' },
  { block: 'word', id: 'creed', name: 'Profession of Faith', kind: 'note', massOrderId: 'credo' },
  { block: 'word', id: 'prayer-faithful', name: 'Prayer of the Faithful', kind: 'note' },
  // III. Liturgy of the Eucharist
  { block: 'eucharist', id: 'offertory', name: 'Preparation of the Gifts', kind: 'song' },
  { block: 'eucharist', id: 'prayer-offerings', name: 'Prayer over the Offerings', kind: 'note' },
  { block: 'eucharist', id: 'preface', name: 'Preface', kind: 'note' },
  { block: 'eucharist', id: 'sanctus', name: 'Holy, Holy, Holy', kind: 'song', massOrderId: 'sanctus' },
  { block: 'eucharist', id: 'eucharistic-prayer', name: 'Eucharistic Prayer', kind: 'note' },
  { block: 'eucharist', id: 'memorial-acclamation', name: 'Memorial Acclamation', kind: 'song', massOrderId: 'memorial-acclamation' },
  { block: 'eucharist', id: 'great-amen', name: 'Great Amen', kind: 'song' },
  // IV. Communion Rite
  { block: 'communion', id: 'our-father', name: 'Our Father', kind: 'song', massOrderId: 'pater-noster' },
  { block: 'communion', id: 'sign-of-peace', name: 'Sign of Peace', kind: 'note' },
  { block: 'communion', id: 'agnus-dei', name: 'Lamb of God', kind: 'song', massOrderId: 'agnus-dei' },
  { block: 'communion', id: 'communion-procession', name: 'Communion Procession', kind: 'song' },
  { block: 'communion', id: 'thanksgiving', name: 'Thanksgiving', kind: 'song' },
  { block: 'communion', id: 'prayer-after-communion', name: 'Prayer after Communion', kind: 'note' },
  // V. Concluding Rites
  { block: 'concluding', id: 'announcements', name: 'Announcements', kind: 'note' },
  { block: 'concluding', id: 'final-blessing', name: 'Final Blessing', kind: 'note' },
  { block: 'concluding', id: 'dismissal', name: 'Dismissal', kind: 'note' },
  { block: 'concluding', id: 'recessional', name: 'Recessional', kind: 'song' },
];

/** The sourceId of a placeholder step row. Typed text and library picks never start with this. */
export const STEP_PREFIX = 'step:';

export const stepSourceId = (step) => `${STEP_PREFIX}${step.id}`;

/** The step a placeholder row stands for, or null for any other row. */
export function stepFor(sourceId) {
  if (typeof sourceId !== 'string' || !sourceId.startsWith(STEP_PREFIX)) return null;
  return MASS_FLOW.find((step) => stepSourceId(step) === sourceId) ?? null;
}

/** The song categories the Mass needs: one per song step, named as the step is. The planner's song picker filters by these. */
export const SONG_CATEGORY_NAMES = MASS_FLOW.filter((step) => step.kind === 'song').map((step) => step.name);

/** The song category a step's picker starts on. Only song steps have one. */
export function songCategoryOf(step) {
  return step?.kind === 'song' ? step.name : null;
}
