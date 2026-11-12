// Rosary sequencing, shared by the renderer's deck and its tests. Pure: no DOM, no database.

/** Mystery set for each weekday, indexed by Date#getDay() (0 = Sunday). */
export const MYSTERY_BY_WEEKDAY = ['glorious', 'joyful', 'sorrowful', 'glorious', 'luminous', 'sorrowful', 'joyful'];

/** The mystery set for a date: Mon/Sat joyful, Tue/Fri sorrowful, Wed/Sun glorious, Thu luminous. */
export function mysteryTypeFor(date) {
  return MYSTERY_BY_WEEKDAY[date.getDay()];
}

/**
 * The optional prayers in the deck. The Fatima prayer ends each decade; the Litany of Loreto and the St. Michael prayer
 * follow the Hail Holy Queen. The defaults keep the sequence the deck has always had: Fatima and the Litany in, St. Michael out.
 */
export const SEQUENCE_DEFAULTS = Object.freeze({ fatima: true, litany: true, stMichael: false });

/** Introductory prayers, in order: Apostles' Creed, Our Father, three Hail Marys, Glory Be. */
const INTRO = ['creed', 'our_father', 'hail_mary', 'hail_mary', 'hail_mary', 'glory_be'];

export const DECADES = 5;
export const INTRO_BEADS = 3;
export const DECADE_BEADS = 10;

/** Fills in any option left out, so callers can pass a partial set or nothing at all. */
const withDefaults = (options) => ({ ...SEQUENCE_DEFAULTS, ...(options ?? {}) });

/** Steps in one decade: announce, Our Father, ten Hail Marys, Glory Be, then the Fatima prayer when it is on. */
export function stepsPerDecade(options) {
  return withDefaults(options).fatima ? 14 : 13;
}

/** The closing prayers, in order: Hail Holy Queen, then the Litany and St. Michael when they are on. */
export function closingPrayers(options) {
  const o = withDefaults(options);
  return ['hail_holy_queen', ...(o.litany ? ['litany_loreto'] : []), ...(o.stMichael ? ['st_michael'] : [])];
}

const INTRO_END = INTRO.length;
const closingStart = (options) => INTRO_END + DECADES * stepsPerDecade(options);

/** How many steps the whole rosary has with these options. */
export function totalPositions(options) {
  return closingStart(options) + closingPrayers(options).length;
}

/** With the default options: kept for callers that do not choose. */
export const STEPS_PER_DECADE = stepsPerDecade();
export const TOTAL_POSITIONS = totalPositions();

/**
 * What the rosary shows at a position in the sequence. `section` is 'intro', 'decade' or 'closing'.
 * `decade` is 1 to 5 on a decade and null otherwise. `bead` is the Hail Mary number (1 to 10, or 1 to 3
 * in the introduction) and null otherwise.
 */
export function stepAt(position, options) {
  const perDecade = stepsPerDecade(options);
  const closing = closingPrayers(options);
  const start = closingStart(options);
  const p = Math.min(Math.max(0, position), start + closing.length - 1);
  if (p < INTRO_END) {
    const kind = INTRO[p];
    return { section: 'intro', decade: null, kind, bead: kind === 'hail_mary' ? p - 1 : null };
  }
  if (p >= start) {
    return { section: 'closing', decade: null, kind: closing[p - start], bead: null };
  }
  const q = p - INTRO_END;
  const decade = Math.floor(q / perDecade) + 1;
  const s = q % perDecade;
  if (s === 0) return { section: 'decade', decade, kind: 'announce', bead: null };
  if (s === 1) return { section: 'decade', decade, kind: 'our_father', bead: null };
  if (s <= 11) return { section: 'decade', decade, kind: 'hail_mary', bead: s - 1 };
  if (s === 12) return { section: 'decade', decade, kind: 'glory_be', bead: null };
  return { section: 'decade', decade, kind: 'fatima', bead: null };
}

/** Every step in order, for an outline of the deck. */
export function rosarySequence(options) {
  return Array.from({ length: totalPositions(options) }, (_, i) => stepAt(i, options));
}

/** The first position of the introductory prayers. */
export function positionOfIntro() {
  return 0;
}

/** The first position of a decade, so the left-hand list can jump to it. */
export function positionOfDecade(decade, options) {
  return INTRO_END + (decade - 1) * stepsPerDecade(options);
}

/** The position of a closing prayer, or -1 when that prayer is turned off. */
export function positionOfClosing(kind, options) {
  const at = closingPrayers(options).indexOf(kind);
  return at < 0 ? -1 : closingStart(options) + at;
}

/**
 * Position of Hail Mary `n` (1-based) in the section a step belongs to. The introduction's
 * Hail Marys come straight after the Our Father; a decade's come after its Our Father too.
 */
export function beadPosition(step, n, options) {
  const origin = step.section === 'decade' ? positionOfDecade(step.decade, options) : positionOfIntro();
  return origin + 1 + n;
}
