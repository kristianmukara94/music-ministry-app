// The parish profile's extra fields: where the parish is, how the logo sits in its frames, and the clergy and liturgical team roster that the
// Lower Third drawer offers as one-click nameplates. Pure, so config.js (main) and the Settings form (renderer) check values the same way.

/** The longest diocese or city the profile accepts. */
export const DIOCESE_MAX = 100;
export const LOCATION_MAX = 100;

/** The logo's size inside its round and square frames, in percent. Below 100 adds padding so a crest's edges are never clipped. */
export const LOGO_SCALE_MIN = 75;
export const LOGO_SCALE_MAX = 120;
export const LOGO_SCALE_DEFAULT = 100;

/** The roster's limits: enough for a large parish's clergy, readers and music team. */
export const ROSTER_MAX = 30;
export const ROSTER_NAME_MAX = 80;
export const ROSTER_ROLE_MAX = 80;

/** Suggested roles for the roster's role field. The operator can type any other. */
export const ROSTER_ROLE_SUGGESTIONS = [
  'Parish Priest',
  'Parochial Vicar',
  'Guest Priest',
  'Deacon',
  'Music Director',
  'Choir Director',
  'Commentator',
  'Lector',
];

const tidy = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');

/** An optional one-line text: trimmed, spaces collapsed, cut to `max`; null when blank. For a saved config, which must never fail to load. */
export function sanitizeOptionalLine(value, max) {
  const text = tidy(value);
  return text ? text.slice(0, max) : null;
}

/** The logo scale as a whole percent within range. Anything else is the default. */
export function sanitizeLogoScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return LOGO_SCALE_DEFAULT;
  return Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, Math.round(n)));
}

const newId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The roster as saved: entries with a name, each `{ id, name, role }`, without repeats of the same name and role, at most ROSTER_MAX.
 * A damaged saved roster is repaired rather than refused, so the app always starts.
 */
export function sanitizeRoster(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seenIds = new Set();
  const seenPeople = new Set();
  for (const entry of list) {
    const name = tidy(entry?.name).slice(0, ROSTER_NAME_MAX);
    if (!name) continue;
    const role = tidy(entry?.role).slice(0, ROSTER_ROLE_MAX);
    const person = `${name.toLowerCase()}|${role.toLowerCase()}`;
    if (seenPeople.has(person)) continue;
    let id = typeof entry?.id === 'string' && ID.test(entry.id) ? entry.id : newId();
    while (seenIds.has(id)) id = newId();
    seenPeople.add(person);
    seenIds.add(id);
    out.push({ id, name, role });
    if (out.length >= ROSTER_MAX) break;
  }
  return out;
}

/** Checks a roster the operator is saving. Throws with a message the form can show; otherwise returns the clean roster. */
export function checkRoster(list) {
  if (!Array.isArray(list)) throw new Error('The team roster could not be read.');
  if (list.length > ROSTER_MAX) throw new Error(`The team roster holds up to ${ROSTER_MAX} people.`);
  for (const entry of list) {
    const name = tidy(entry?.name);
    const role = tidy(entry?.role);
    if (!name && role) throw new Error(`Enter a name for the ${role} in the team roster.`);
    if (name.length > ROSTER_NAME_MAX) throw new Error(`Names in the team roster must be ${ROSTER_NAME_MAX} characters or fewer.`);
    if (role.length > ROSTER_ROLE_MAX) throw new Error(`Roles in the team roster must be ${ROSTER_ROLE_MAX} characters or fewer.`);
  }
  return sanitizeRoster(list);
}

/** Checks an optional line the operator typed. Blank clears it (null). Throws when it is too long. */
export function checkOptionalLine(value, max, label) {
  const text = tidy(value);
  if (text.length > max) throw new Error(`The ${label} must be ${max} characters or fewer.`);
  return text || null;
}

/** The second line under the parish name on letterheads and nameplates: the ministry and, when set, the diocese. */
export function parishSubtitle({ ministryName, diocese }) {
  return [ministryName, diocese].map(tidy).filter(Boolean).join(' · ');
}
