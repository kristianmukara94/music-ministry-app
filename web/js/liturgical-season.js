// The Church's liturgical season for a date, and the theme each season wears. Shared by the main process (title bar)
// and the renderer (theme), so both resolve "Automatic" to the same season.
//
// Dates follow the Roman calendar as kept in the Philippines: Epiphany is the Sunday between 2 and 8 January, and the
// Baptism of the Lord is the Sunday after it (the Monday after, when Epiphany falls on 7 or 8 January).

/** The seasons, in the order they run from Advent. */
export const SEASONS = ['advent', 'christmas', 'ordinary-time', 'lent', 'holy-week', 'easter', 'pentecost'];

/** The [data-theme] each season uses. Must match src/styles.css. */
export const SEASON_THEME = {
  advent: 'advent',
  christmas: 'christmas',
  'ordinary-time': 'ordinary-time',
  lent: 'lent',
  'holy-week': 'holy-week',
  easter: 'easter',
  pentecost: 'pentecost',
};

const DAY = 24 * 60 * 60 * 1000;

/** A date at local midnight, shifted by whole days. Calendar arithmetic, so a daylight-saving change never moves it. */
const at = (year, month, day, plusDays = 0) => new Date(year, month, day + plusDays);

/** Easter Sunday of a year (the Gregorian computus). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return at(year, month, day);
}

/** First Sunday of Advent: the fourth Sunday before Christmas. */
export function firstSundayOfAdvent(year) {
  const christmasDow = at(year, 11, 25).getDay();
  return at(year, 11, 25 - (christmasDow === 0 ? 7 : christmasDow) - 21);
}

/** The last day of the Christmas season: the Baptism of the Lord. */
export function baptismOfTheLord(year) {
  const jan2Dow = at(year, 0, 2).getDay();
  const epiphany = at(year, 0, 2 + ((7 - jan2Dow) % 7));
  return epiphany.getDate() >= 7 ? at(year, 0, epiphany.getDate() + 1) : at(year, 0, epiphany.getDate() + 7);
}

/** Whole days from `from` to `to`, both read as calendar dates. */
const daysBetween = (from, to) => Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / DAY);

/**
 * The season a date falls in.
 *   Advent         First Sunday of Advent to 24 December
 *   Christmas      25 December to the Baptism of the Lord
 *   Lent           Ash Wednesday to the Saturday before Palm Sunday
 *   Holy Week      Palm Sunday to Holy Saturday
 *   Easter         Easter Sunday to the Saturday before Pentecost
 *   Pentecost      Pentecost Sunday only
 *   Ordinary Time  everything else
 */
export function seasonOf(date = new Date()) {
  const year = date.getFullYear();
  if (daysBetween(firstSundayOfAdvent(year), date) >= 0) return date.getMonth() === 11 && date.getDate() >= 25 ? 'christmas' : 'advent';
  if (date.getMonth() === 0 && daysBetween(baptismOfTheLord(year), date) <= 0) return 'christmas';

  const easter = daysBetween(easterSunday(year), date);
  if (easter >= -46 && easter <= -8) return 'lent';
  if (easter >= -7 && easter <= -1) return 'holy-week';
  if (easter >= 0 && easter <= 48) return 'easter';
  if (easter === 49) return 'pentecost';
  return 'ordinary-time';
}

/** The theme Automatic paints on the two rose Sundays: Gaudete (3rd Sunday of Advent) and Laetare (4th Sunday of Lent). */
export const ROSE_THEME = 'rose';

/**
 * Whether a date is Gaudete or Laetare Sunday, the two days the Church may wear rose. A colour of the day, not a season: seasonOf still
 * says Advent or Lent, so the Lectionary and the Planner are unaffected.
 */
export function isRoseSunday(date = new Date()) {
  const year = date.getFullYear();
  return daysBetween(firstSundayOfAdvent(year), date) === 14 || daysBetween(easterSunday(year), date) === -21;
}

/** The theme for a date: rose on Gaudete and Laetare Sundays, else the season's own. */
export const seasonThemeOf = (date = new Date()) => (isRoseSunday(date) ? ROSE_THEME : SEASON_THEME[seasonOf(date)]);

/**
 * The next day Automatic changes colour after the given date, and the theme it changes to. Looks a year ahead at most; dates are local midnights.
 */
export function nextThemeChange(date = new Date()) {
  const today = seasonThemeOf(date);
  for (let i = 1; i <= 366; i++) {
    const day = at(date.getFullYear(), date.getMonth(), date.getDate(), i);
    const theme = seasonThemeOf(day);
    if (theme !== today) return { date: day, theme };
  }
  return null;
}

/** The id that means "follow the Church calendar" rather than one fixed theme. */
export const AUTO_SEASON_THEME = 'season-auto';

/** A theme id as a real [data-theme]: "Automatic" becomes today's season, every other id is unchanged. */
export const resolveTheme = (id, date = new Date()) => (id === AUTO_SEASON_THEME ? seasonThemeOf(date) : id);
