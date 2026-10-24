// Rosary sequencing, shared by the renderer's deck and its tests. Pure: no DOM, no database.

/** Mystery set for each weekday, indexed by Date#getDay() (0 = Sunday). */
export const MYSTERY_BY_WEEKDAY = ['glorious', 'joyful', 'sorrowful', 'glorious', 'luminous', 'sorrowful', 'joyful'];

/** The mystery set for a date: Mon/Sat joyful, Tue/Fri sorrowful, Wed/Sun glorious, Thu luminous. */
export function mysteryTypeFor(date) {
  return MYSTERY_BY_WEEKDAY[date.getDay()];
}

/** Introductory prayers, in order: Apostles' Creed, Our Father, three Hail Marys, Glory Be. */
const INTRO = ['creed', 'our_father', 'hail_mary', 'hail_mary', 'hail_mary', 'glory_be'];
/** Closing prayers, after the fifth decade: Hail Holy Queen, then the Litany of Loreto. */
const CLOSING = ['hail_holy_queen', 'litany_loreto'];

/** Steps in one decade: announce, Our Father, ten Hail Marys, Glory Be, Fatima. */
export const STEPS_PER_DECADE = 14;
export const DECADES = 5;
export const INTRO_BEADS = 3;
export const DECADE_BEADS = 10;

const INTRO_END = INTRO.length;
const CLOSING_START = INTRO_END + DECADES * STEPS_PER_DECADE;
export const TOTAL_POSITIONS = CLOSING_START + CLOSING.length;

/**
 * What the rosary shows at a position in the sequence. `section` is 'intro', 'decade' or 'closing'.
 * `decade` is 1 to 5 on a decade and null otherwise. `bead` is the Hail Mary number (1 to 10, or 1 to 3
 * in the introduction) and null otherwise.
 */
export function stepAt(position) {
  const p = Math.min(Math.max(0, position), TOTAL_POSITIONS - 1);
  if (p < INTRO_END) {
    const kind = INTRO[p];
    return { section: 'intro', decade: null, kind, bead: kind === 'hail_mary' ? p - 1 : null };
  }
  if (p >= CLOSING_START) {
    return { section: 'closing', decade: null, kind: CLOSING[p - CLOSING_START], bead: null };
  }
  const q = p - INTRO_END;
  const decade = Math.floor(q / STEPS_PER_DECADE) + 1;
  const s = q % STEPS_PER_DECADE;
  if (s === 0) return { section: 'decade', decade, kind: 'announce', bead: null };
  if (s === 1) return { section: 'decade', decade, kind: 'our_father', bead: null };
  if (s <= 11) return { section: 'decade', decade, kind: 'hail_mary', bead: s - 1 };
  if (s === 12) return { section: 'decade', decade, kind: 'glory_be', bead: null };
  return { section: 'decade', decade, kind: 'fatima', bead: null };
}

/** The first position of the introductory prayers. */
export function positionOfIntro() {
  return 0;
}

/** The first position of a decade, so the left-hand list can jump to it. */
export function positionOfDecade(decade) {
  return INTRO_END + (decade - 1) * STEPS_PER_DECADE;
}

/** The position of a closing prayer: 'hail_holy_queen' or 'litany_loreto'. */
export function positionOfClosing(kind) {
  return CLOSING_START + CLOSING.indexOf(kind);
}

/**
 * Position of Hail Mary `n` (1-based) in the section a step belongs to. The introduction's
 * Hail Marys come straight after the Our Father; a decade's come after its Our Father too.
 */
export function beadPosition(step, n) {
  const origin = step.section === 'decade' ? positionOfDecade(step.decade) : positionOfIntro();
  return origin + 1 + n;
}
