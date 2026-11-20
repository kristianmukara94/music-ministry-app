// Holy Mass schedules: the time and the language of each Holy Mass plan, so several Holy Masses on one day (6:00 AM English, 8:00 AM Cebuano,
// 9:30 AM Tagalog) can be told apart and listed in the order they are celebrated. Pure, so the database, the planner, Go Live and the tests
// share it. Praise & Worship sessions have no schedule.
//
// `massTime` is what the operator typed ("6:00 AM", "06:00", "17:30"): it is kept as typed and only parsed for sorting. `massLanguage` is
// 'English', 'Cebuano', 'Tagalog' or the operator's own text. A plan made before schedules has both blank and reads as it always did.

/** The schedule languages offered as pills, in the order shown. Stored by these names; shown in the app language. */
export const SCHEDULE_LANGUAGES = Object.freeze(['English', 'Cebuano', 'Tagalog']);

/** One-tap times on the create and edit forms. Any other time can still be typed. */
export const TIME_PRESETS = Object.freeze(['6:00 AM', '8:00 AM', '9:30 AM', '5:00 PM']);

export const MAX_MASS_TIME = 20;
export const MAX_MASS_LANGUAGE = 30;

/** Each schedule language's short code on a calendar badge, and the plan language (shared/mass-language.js) its texts are drafted in. */
const LANGUAGE_CODE = Object.freeze({ English: 'EN', Cebuano: 'CEB', Tagalog: 'TL' });
// Other spellings an operator or an older file may use for the same three.
const LANGUAGE_ALIASES = Object.freeze({ en: 'English', eng: 'English', english: 'English', ceb: 'Cebuano', cebuano: 'Cebuano', bisaya: 'Cebuano', visayan: 'Cebuano', tl: 'Tagalog', tgl: 'Tagalog', tagalog: 'Tagalog', filipino: 'Tagalog' });
const PLAN_LANGUAGE_LABEL = Object.freeze({ EN: 'English', CEB: 'Cebuano', TL: 'Tagalog' });

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** A typed time, tidied: spaces folded, and cut to MAX_MASS_TIME. Blank stays blank. */
export const normalizeMassTime = (value) => squash(value).slice(0, MAX_MASS_TIME);

/** A schedule language: one of SCHEDULE_LANGUAGES when it names one ("cebuano", "CEB"), else the operator's own text, tidied. */
export function normalizeMassLanguage(value) {
  const text = squash(value).slice(0, MAX_MASS_LANGUAGE);
  return LANGUAGE_ALIASES[text.toLowerCase()] ?? text;
}

/** Whether a schedule language is one of the three offered as pills. */
export const isScheduleLanguage = (value) => SCHEDULE_LANGUAGES.includes(value);

/**
 * Minutes after midnight for a typed time, or null when it cannot be read. Reads "6:00 AM", "6 am", "6:00 a.m.", "9.30 PM", "06:00",
 * "17:30", "1730", "noon" and "midnight". "12:xx AM" is just after midnight and "12:xx PM" just after noon.
 */
export function parseMassTime(value) {
  const text = squash(value)
    .toLowerCase()
    .replace(/([ap])\.?\s*m\.?$/, '$1m') // "a.m." and "p. m." read as "am" and "pm"
    .replace(/(\d)\.(\d)/, '$1:$2'); // "9.30" reads as "9:30"
  if (!text) return null;
  if (/^(12\s*)?(noon|nn)$/.test(text)) return 12 * 60;
  if (/^(12\s*)?(midnight|mn)$/.test(text)) return 0;
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m?$/.exec(text);
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = Number(twelve[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return ((hour % 12) + (twelve[3] === 'p' ? 12 : 0)) * 60 + minute;
  }
  // A 24-hour time needs its minutes ("06:00", "17:30", "1730"): a bare "6" could be morning or evening, so it is not read.
  const day = /^(\d{1,2}):(\d{2})$/.exec(text) ?? /^(\d{2})(\d{2})$/.exec(text);
  if (!day) return null;
  const hour = Number(day[1]);
  const minute = Number(day[2]);
  return hour > 23 || minute > 59 ? null : hour * 60 + minute;
}

/**
 * Orders two plans on the same day: read times first, earliest first; then times that could not be read, alphabetically; then plans with no
 * time. Ties keep the order they were made in (lower id first).
 */
export function compareMassSchedules(a, b) {
  const rank = (plan) => {
    const time = normalizeMassTime(plan?.massTime);
    if (!time) return [2, 0, ''];
    const minutes = parseMassTime(time);
    return minutes == null ? [1, 0, time.toLowerCase()] : [0, minutes, ''];
  };
  const [ra, ma, ta] = rank(a);
  const [rb, mb, tb] = rank(b);
  return ra - rb || ma - mb || ta.localeCompare(tb) || (Number(a?.id) || 0) - (Number(b?.id) || 0);
}

/** A copy of `plans`, each day's plans in the order they are celebrated. Days keep `dateOrder` ('desc', newest first, or 'asc'). */
export function sortMassSchedules(plans, dateOrder = 'desc') {
  const sign = dateOrder === 'asc' ? 1 : -1;
  return [...plans].sort((a, b) => sign * String(a.liturgicalDate).localeCompare(String(b.liturgicalDate)) || compareMassSchedules(a, b));
}

/** The Holy Mass plans on one day, in the order they are celebrated. */
export const schedulesOn = (plans, iso) => sortMassSchedules((plans ?? []).filter((p) => p.liturgicalDate === iso), 'asc');

/** A schedule language's short code for a badge: EN, CEB, TL, or the first letters of the operator's own language. */
export function scheduleLanguageCode(value) {
  const language = normalizeMassLanguage(value);
  if (!language) return '';
  return LANGUAGE_CODE[language] ?? language.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase();
}

/** The plan language (EN, TL, CEB in shared/mass-language.js) a schedule language drafts its texts in, or null for another language. */
export const planLanguageForSchedule = (value) => LANGUAGE_CODE[normalizeMassLanguage(value)] ?? null;

/** The schedule language that matches a plan language: 'EN' is English. */
export const scheduleLanguageForPlan = (code) => PLAN_LANGUAGE_LABEL[String(code ?? '').toUpperCase()] ?? '';

/** Whether a plan has a time or a language set. */
export const hasSchedule = (plan) => Boolean(normalizeMassTime(plan?.massTime) || normalizeMassLanguage(plan?.massLanguage));

/**
 * A plan's schedule as one line: "6:00 AM · English", or "6:00 AM · EN" with `short`. Only the parts set are shown; a plan with neither is ''.
 * `languageLabel` names a schedule language in the app language (the planner's lang_English, ...); it is given the stored name.
 */
export function scheduleLabel(plan, { short = false, languageLabel = (name) => name } = {}) {
  const time = normalizeMassTime(plan?.massTime);
  const language = normalizeMassLanguage(plan?.massLanguage);
  const lang = !language ? '' : short ? scheduleLanguageCode(language) : isScheduleLanguage(language) ? languageLabel(language) : language;
  return [time, lang].filter(Boolean).join(' · ');
}

/** Two schedules are the same Holy Mass when both have a time and a language and they match (the time as read, else as typed). */
export function sameSchedule(a, b) {
  const ta = normalizeMassTime(a?.massTime);
  const tb = normalizeMassTime(b?.massTime);
  const la = normalizeMassLanguage(a?.massLanguage);
  const lb = normalizeMassLanguage(b?.massLanguage);
  if (!ta || !tb || !la || !lb || la.toLowerCase() !== lb.toLowerCase()) return false;
  const ma = parseMassTime(ta);
  const mb = parseMassTime(tb);
  return ma != null && mb != null ? ma === mb : ta.toLowerCase() === tb.toLowerCase();
}

/**
 * What a click on a day of the Liturgical Calendar does: 'create' opens the new Holy Mass form (time and language ready) on an empty day, and
 * 'pick' lists the day's saved schedules, with Add Another Holy Mass Schedule, once the day has any.
 */
export const massDayAction = (plansOnDay) => ((plansOnDay?.length ?? 0) === 0 ? 'create' : 'pick');

/** The badges a calendar cell shows for its Holy Mass plans: all of them up to two, else the first two and "+N more". */
export function cellScheduleBadges(plansOnDay, max = 2) {
  const list = plansOnDay ?? [];
  if (list.length <= max) return { shown: list, more: 0 };
  return { shown: list.slice(0, max), more: list.length - max };
}

/**
 * A typed time in one canonical form for comparing: "6:00 AM", "6 am", "06:00" and "6:00a.m." all read "6:00 AM". A time that cannot be
 * read is kept as typed (tidied, lower case), so two identical unusual times still match. Blank stays blank.
 */
export function canonicalMassTime(value) {
  const time = normalizeMassTime(value);
  if (!time) return '';
  const minutes = parseMassTime(time);
  if (minutes == null) return time.toLowerCase();
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Whether two typed times are the same time of day ("6:00 AM" and "06:00" are). A blank time never matches anything. */
export const sameMassTime = (a, b) => {
  const ca = canonicalMassTime(a);
  return ca !== '' && ca === canonicalMassTime(b);
};

/** A plan's date, whichever side it comes from: the laptop's `liturgicalDate`, or the website's `date` / `liturgical_date`. */
const dateOfPlan = (plan) => String(plan?.liturgicalDate ?? plan?.date ?? plan?.liturgical_date ?? '');

/**
 * The Holy Mass that already uses a time on a date, or null. Two Holy Masses on one day cannot share a time, whatever their languages, so a
 * planner never confuses two lineups. `plans` is any list of Holy Mass plans (laptop or website shape); `candidate` is `{ date, massTime }`;
 * `exceptId` is the plan being edited, which never clashes with itself. A blank time never clashes (plans from before schedules).
 * Returns `{ id, name, massTime, massLanguage, date }` of the plan already there, so the planner can offer to open it.
 */
export function findTimeConflict(plans, candidate, exceptId = null) {
  const date = String(candidate?.date ?? candidate?.liturgicalDate ?? '');
  if (!date || !canonicalMassTime(candidate?.massTime)) return null;
  const clash = sortMassSchedules((plans ?? []).filter((p) => p && dateOfPlan(p) === date), 'asc')
    .find((p) => (exceptId == null || String(p.id) !== String(exceptId)) && sameMassTime(p.massTime, candidate.massTime));
  if (!clash) return null;
  return { id: clash.id, name: String(clash.name ?? ''), massTime: normalizeMassTime(clash.massTime), massLanguage: normalizeMassLanguage(clash.massLanguage), date };
}

/**
 * The English line shown when a time is taken: "A Holy Mass at 6:00 AM (English) already exists on this date." The planners show it in
 * the app language from their own strings (scheduleTimeTaken); this is the server's and the desktop service's wording.
 */
export function timeConflictText(conflict) {
  if (!conflict) return '';
  const language = normalizeMassLanguage(conflict.massLanguage);
  return `A Holy Mass at ${normalizeMassTime(conflict.massTime)}${language ? ` (${language})` : ''} already exists on this date.`;
}
