// The liturgical day of a date, as a code the built-in Ordo (src/data/lectionary_ordo.json) knows, and the day's Lectionary citations.
//
// The Philippine calendar: Epiphany on the Sunday between 2 and 8 January, the Ascension on the Seventh Sunday of Easter, Corpus Christi
// on the Sunday after Trinity, and the Santo Nino on the third Sunday of January. Memorials take the weekday readings, which the Lectionary
// allows, so only solemnities and feasts have their own entries.
//
//   adv1, lent3, east4, ot21     Sundays          adv2-3, lent4-5, east6-2, ot32-6   weekdays (1 Monday .. 6 Saturday)
//   12-17 .. 12-24, 01-02 ..     dated weekdays   epi-1 .. epi-6                     weekdays after Epiphany
//   12-08, 08-15, 06-29 ...      solemnities and feasts, by month and day
//   palm, holy-1, easter, ascension, pentecost, trinity, corpus, sacred-heart, christ-king, holy-family, epiphany, baptism, santo-nino ...
//
// Pure, so it runs in the renderer and under node:test. Run with: node --test shared/liturgical-day.test.js
import { baptismOfTheLord, easterSunday, firstSundayOfAdvent } from './liturgical-season.js';

const DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const plus = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const daysBetween = (from, to) => Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / DAY);
const sameDay = (a, b) => daysBetween(a, b) === 0;
const monthDay = (date) => `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** The Sunday that starts a date's week. */
const sundayOf = (date) => plus(date, -date.getDay());
const weekFrom = (sunday, date) => daysBetween(sunday, sundayOf(date)) / 7;

/** A date from "YYYY-MM-DD", at local midnight. */
export function dateOfIso(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The year the liturgical year is named for: it starts at Advent, so Advent 2025 begins liturgical year 2026. */
export function liturgicalYearOf(date) {
  return daysBetween(firstSundayOfAdvent(date.getFullYear()), date) >= 0 ? date.getFullYear() + 1 : date.getFullYear();
}

/** Sunday cycle A, B or C: 2026 is Year A. */
export const sundayCycleOf = (date) => ['C', 'A', 'B'][liturgicalYearOf(date) % 3];

/** Weekday cycle: Year I in odd-numbered liturgical years (2025, 2027), Year II in even ones (2026). */
export const weekdayCycleOf = (date) => (liturgicalYearOf(date) % 2 === 1 ? 'I' : 'II');

/** Solemnities, which take a Sunday in Ordinary Time or Christmas. */
const SOLEMNITIES = ['01-01', '03-19', '03-25', '06-24', '06-29', '08-15', '11-01', '11-02', '12-08', '12-25'];
/** Feasts of the Lord, which also take a Sunday in Ordinary Time. */
const LORD_FEASTS = ['02-02', '08-06', '09-14', '11-09'];
/** Feasts, which take a weekday. */
const FEASTS = ['01-25', '02-22', '04-25', '05-03', '05-14', '05-31', '07-03', '07-22', '07-25', '08-10', '08-24', '09-08', '09-21', '09-29', '10-18', '10-28', '11-30', '12-26', '12-27', '12-28', ...LORD_FEASTS];
/** Weekdays read by the date: the last days of Advent, the Octave of Christmas, and the days before Epiphany. */
const DATED = ['12-17', '12-18', '12-19', '12-20', '12-21', '12-22', '12-23', '12-24', '12-29', '12-30', '12-31', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07'];

/** Where a solemnity is kept in `year` when its date falls on a Sunday of Advent or Lent, in Holy Week, or in the Octave of Easter. */
function keptOn(md, year, easter) {
  const [m, d] = md.split('-').map(Number);
  const date = new Date(year, m - 1, d);
  const off = daysBetween(easter, date);
  // Saint Joseph in Holy Week moves back to the Saturday before Palm Sunday; on a Sunday of Lent, to the Monday.
  if (md === '03-19') return off >= -7 && off <= 0 ? plus(easter, -8) : date.getDay() === 0 ? plus(date, 1) : date;
  // The Annunciation in Holy Week or the Octave of Easter moves to the Monday after the Second Sunday of Easter.
  if (md === '03-25') return off >= -7 && off <= 7 ? plus(easter, 8) : date.getDay() === 0 ? plus(date, 1) : date;
  if (md === '12-08') return date.getDay() === 0 ? plus(date, 1) : date;
  return date;
}

/** The day's Ordo code, worked out by the precedence of liturgical days. */
export function dayCodeOf(date) {
  const year = date.getFullYear();
  const dow = date.getDay();
  const md = monthDay(date);
  const easter = easterSunday(year);
  const off = daysBetween(easter, date);
  const advent = firstSundayOfAdvent(year);
  const christmas = new Date(year, 11, 25);
  const inAdvent = daysBetween(advent, date) >= 0 && daysBetween(date, christmas) > 0;

  // Holy Week, the Triduum and the Octave of Easter outrank everything.
  if (off === -7) return 'palm';
  if (off >= -6 && off <= -4) return `holy-${dow}`;
  if (off === -3) return 'holy-thu';
  if (off === -2) return 'good-fri';
  if (off === -1) return 'vigil';
  if (off === 0) return 'easter';
  if (off >= 1 && off <= 6) return `east1-${dow}`;
  if (off === -46) return 'ash';
  if (off >= -45 && off <= -43) return `ash-${dow}`;

  // Sundays of Advent, Lent and Easter.
  if (dow === 0 && inAdvent) return `adv${weekFrom(advent, date) + 1}`;
  if (dow === 0 && off >= -42 && off <= -14) return `lent${weekFrom(plus(easter, -42), date) + 1}`;
  if (off === 42) return 'ascension';
  if (dow === 0 && off >= 7 && off <= 35) return `east${off / 7 + 1}`;

  // Movable solemnities and feasts.
  const christKing = plus(advent, -7);
  if (off === 49) return 'pentecost';
  if (off === 56) return 'trinity';
  if (off === 63) return 'corpus';
  if (off === 68) return 'sacred-heart';
  if (sameDay(date, christKing)) return 'christ-king';
  const epiphany = plus(new Date(year, 0, 2), (7 - new Date(year, 0, 2).getDay()) % 7);
  const baptism = baptismOfTheLord(year);
  if (sameDay(date, epiphany)) return 'epiphany';
  if (sameDay(date, baptism)) return 'baptism';
  if (dow === 0 && md >= '12-26' && md <= '12-31') return 'holy-family';
  if (md === '12-30' && christmas.getDay() === 0) return 'holy-family';

  for (const solemnity of SOLEMNITIES) if (sameDay(date, keptOn(solemnity, year, easter))) return solemnity;

  if (dow === 0) {
    if (LORD_FEASTS.includes(md)) return md;
    if (date.getMonth() === 0 && date.getDate() >= 15 && date.getDate() <= 21) return 'santo-nino';
  } else {
    if (FEASTS.includes(md)) return md;
    if (date.getMonth() === 0 && daysBetween(epiphany, date) > 0 && daysBetween(date, baptism) > 0) return `epi-${dow}`;
    if (DATED.includes(md)) return md;
  }

  // The seasons, by week.
  if (inAdvent) return `adv${weekFrom(advent, date) + 1}-${dow}`;
  if (off > -43 && off < -7) return `lent${weekFrom(plus(easter, -42), date) + 1}-${dow}`;
  if (off > 7 && off < 49) return `east${weekFrom(easter, date) + 1}-${dow}`;
  // Ordinary Time: counted on from the Baptism of the Lord until Lent, and back from Christ the King (week 34) after Pentecost.
  const week = off < 0 ? weekFrom(sundayOf(baptism), date) + 1 : 34 - weekFrom(sundayOf(date), christKing);
  return dow === 0 ? `ot${week}` : `ot${week}-${dow}`;
}

const ORDINAL = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SEASON = { adv: 'of Advent', lent: 'of Lent', east: 'of Easter', ot: 'in Ordinary Time' };

/** The English name of a numbered day ("Saturday of the 32nd Week in Ordinary Time"). Named days carry their name in the Ordo. */
function numberedName(code) {
  const m = /^(adv|lent|east|ot)(\d+)(?:-(\d))?$/.exec(code);
  if (!m) return null;
  const [, season, week, dow] = m;
  if (!dow) return `${ORDINAL(Number(week))} Sunday ${SEASON[season]}`;
  if (season === 'east' && week === '1') return `${WEEKDAY[Number(dow)]} within the Octave of Easter`;
  return `${WEEKDAY[Number(dow)]} of the ${ORDINAL(Number(week))} Week ${SEASON[season]}`;
}

/** Ordo fields, and the reading each fills. */
export const ORDO_FIELDS = { r1: 'First Reading', ps: 'Responsorial Psalm', r2: 'Second Reading', acc: 'Gospel Acclamation', gos: 'Gospel' };

/**
 * The liturgical day of `date` (a Date, or "YYYY-MM-DD") and its citations from `ordo`, the parsed lectionary_ordo.json. A day the Ordo
 * has no entry for returns no citations. The Prayer of the Faithful is never in it: the parish writes its own.
 */
export function ordoDayOf(ordo, date) {
  const day = typeof date === 'string' ? dateOfIso(date) : date;
  const code = dayCodeOf(day);
  const sundayCycle = sundayCycleOf(day);
  const weekdayCycle = weekdayCycleOf(day);
  const entry = ordo?.days?.[code];
  const fields = entry ? { ...entry, ...entry[sundayCycle], ...entry[weekdayCycle] } : {};
  const citations = {};
  for (const [field, readingType] of Object.entries(ORDO_FIELDS)) if (typeof fields[field] === 'string' && fields[field].trim()) citations[readingType] = fields[field];
  return { code, name: entry?.name ?? numberedName(code) ?? code, sundayCycle, weekdayCycle, citations };
}
