// The Holy Mass Planner's liturgical calendar: the month grid, each day's liturgical colour and rank (from its Ordo code, see
// shared/liturgical-day.js), the month's traditional dedication, and whether a saved plan for a day is ready or still a draft.
//
// Pure, so it runs in the renderer and under node:test. Run with: node --test shared/liturgical-calendar.test.js
import { dayCodeOf, dateOfIso } from './liturgical-day.js';
import { MASS_SLOTS } from './mass-slots.js';
import { seasonOf } from './liturgical-season.js';

const pad = (n) => String(n).padStart(2, '0');
/** A date as "YYYY-MM-DD", read in local time. */
export const isoOfDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * The days a month's grid shows, Sunday to Saturday, as whole weeks: the month's own days and the days of the weeks it starts and ends in.
 * `month` is 0 for January. Each week is seven "YYYY-MM-DD" days.
 */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const last = new Date(year, month + 1, 0);
  const days = Math.round((Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000) + 1;
  const weeks = [];
  for (let i = 0; i < Math.ceil(days / 7) * 7; i += 7) {
    weeks.push(Array.from({ length: 7 }, (_, d) => isoOfDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i + d))));
  }
  return weeks;
}

/** Solemnities and feasts kept on a fixed date whose vestments are red: apostles, evangelists, martyrs, and the Holy Cross. */
const RED_DATED = ['04-25', '05-03', '05-14', '06-29', '07-03', '07-25', '08-10', '08-24', '09-14', '09-21', '10-18', '10-28', '11-30', '12-26', '12-28'];
/** Solemnities by date, and the movable ones, by Ordo code. */
const SOLEMNITY_CODES = ['01-01', '03-19', '03-25', '06-24', '06-29', '08-15', '11-01', '11-02', '12-08', '12-25', 'easter', 'vigil', 'ascension', 'pentecost', 'trinity', 'corpus', 'sacred-heart', 'christ-king', 'epiphany'];
/** Feasts by date, and the movable ones, by Ordo code. */
const FEAST_CODES = ['01-25', '02-02', '02-22', '04-25', '05-03', '05-14', '05-31', '07-03', '07-22', '07-25', '08-06', '08-10', '08-24', '09-08', '09-14', '09-21', '09-29', '10-18', '10-28', '11-09', '11-30', '12-26', '12-27', '12-28', 'holy-family', 'baptism', 'santo-nino'];
const DATED = /^\d\d-\d\d$/;

/**
 * The colour of a liturgical day, by its Ordo code: green, violet, white (white or gold), red or rose.
 *   Rose     Gaudete (3rd Sunday of Advent) and Laetare (4th Sunday of Lent)
 *   Red      Palm Sunday, Good Friday, Pentecost, apostles and martyrs, the Holy Cross
 *   Violet   Advent, Lent, the first days of Holy Week, All Souls
 *   White    Christmas, Easter, solemnities and feasts of the Lord, of Mary, the angels and saints who were not martyrs
 *   Green    Ordinary Time
 */
export function liturgicalColorOf(code) {
  if (code === 'adv3' || code === 'lent4') return 'rose';
  if (code === 'palm' || code === 'good-fri' || code === 'pentecost') return 'red';
  if (code === '11-02') return 'violet';
  if (DATED.test(code)) {
    if (RED_DATED.includes(code)) return 'red';
    // The last weekdays of Advent are read by their date.
    if (code >= '12-17' && code <= '12-24') return 'violet';
    return 'white';
  }
  if (/^holy-[1-6]$/.test(code) || code === 'ash' || /^ash-/.test(code) || /^(adv|lent)\d/.test(code)) return 'violet';
  if (/^ot\d/.test(code)) return 'green';
  // Easter and its season, the Triduum's other days, Christmastide and the movable solemnities and feasts.
  return 'white';
}

/** A day's rank, as the calendar marks it: a solemnity, a feast, a Sunday, or a weekday. */
export function liturgicalRankOf(code, date) {
  if (SOLEMNITY_CODES.includes(code)) return 'solemnity';
  if (FEAST_CODES.includes(code)) return 'feast';
  return (typeof date === 'string' ? dateOfIso(date) : date).getDay() === 0 ? 'sunday' : 'weekday';
}

/** The day's Ordo code, colour, rank and season. */
export function calendarDayOf(iso) {
  const date = dateOfIso(iso);
  const code = dayCodeOf(date);
  return { iso, code, color: liturgicalColorOf(code), rank: liturgicalRankOf(code, date), season: seasonOf(date) };
}

/**
 * A weekday's name in a calendar cell: "Tuesday of the 34th Week in Ordinary Time" is shown as "34th Week in Ordinary Time", since the
 * column already names the weekday. Every other name is kept.
 */
export function shortDayName(name) {
  return String(name).replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) of the /, '');
}

/** The traditional devotion each month is dedicated to, as a planner string key: month_dedication_0 is January. */
export const monthDedicationKey = (month) => `month_dedication_${month}`;

/**
 * The slots a Mass on `iso` needs filled to count as ready: every slot that is not optional, and on a weekday that is not a solemnity, not
 * the parts said only on Sundays and solemnities (the Gloria, the Second Reading, the Creed).
 */
export function requiredSlotsFor(iso) {
  const day = calendarDayOf(iso);
  const festive = day.rank === 'sunday' || day.rank === 'solemnity';
  return MASS_SLOTS.filter((slot) => !slot.optional && (festive || !slot.sundayOnly)).map((slot) => slot.id);
}

/**
 * A saved plan's state in the calendar: 'ready' when every slot its day needs is filled (see requiredSlotsFor), otherwise 'draft'.
 * `filledSlots` are the ids of the slots the plan fills.
 */
export function planStatusOf(iso, filledSlots) {
  const filled = new Set(filledSlots ?? []);
  return requiredSlotsFor(iso).every((id) => filled.has(id)) ? 'ready' : 'draft';
}

/** The seasons a month's own days fall in, in the order they come. November 2026 runs from Ordinary Time into Advent. */
export function seasonsOfMonth(year, month) {
  const out = [];
  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const season = seasonOf(new Date(year, month, d));
    if (!out.includes(season)) out.push(season);
  }
  return out;
}
