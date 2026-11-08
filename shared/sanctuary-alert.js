// The Sanctuary Alert: a short hospitality or emergency notice (a car blocking the driveway, a nursery tag) shown as a banner along the
// bottom of the projector, over whatever is on air. It is its own layer in the live state, so the slides underneath keep their place.

/** The longest notice the banner shows. Longer text is cut. */
export const ALERT_TEXT_MAX = 120;

export const ALERT_SEVERITIES = ['info', 'warning', 'urgent'];

/** How long a notice stays up, in seconds. Null keeps it up until the operator clears it. */
export const ALERT_DURATIONS = [10, 20, 30, null];

export const DEFAULT_ALERT_DURATION = 20;

/** The quick presets. `field` is the one thing the operator types; `compose` turns it into the notice. */
export const ALERT_PRESETS = [
  {
    id: 'car',
    icon: '🚗',
    label: 'Car Blocking Driveway',
    field: { label: 'Plate number', placeholder: 'ABC 1234' },
    severity: 'warning',
    durationSeconds: 30,
  },
  {
    id: 'nursery',
    icon: '👶',
    label: 'Child Care / Nursery Tag',
    field: { label: 'Tag number', placeholder: '12' },
    severity: 'urgent',
    durationSeconds: 30,
  },
  {
    id: 'booth',
    icon: '⚠️',
    label: 'Urgent Booth Announcement',
    field: null,
    severity: 'urgent',
    durationSeconds: 20,
  },
];

/** A plate as it is painted: upper case letters and digits, single spaces, at most 10 characters. "abc-1234" stays "ABC-1234". */
export function formatPlate(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ -]+/, '')
    .slice(0, 10);
}

/** A nursery tag: upper case letters and digits only, at most 6. "#a-12" becomes "A12". */
export function formatTag(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/** The value typed into a preset's field, formatted for that preset. */
export function formatPresetField(presetId, raw) {
  if (presetId === 'car') return formatPlate(raw);
  if (presetId === 'nursery') return formatTag(raw);
  return String(raw ?? '');
}

/** The notice a preset shows, or '' when its field is still empty. */
export function presetText(presetId, raw) {
  const value = formatPresetField(presetId, raw).trim();
  switch (presetId) {
    case 'car':
      return value ? `Vehicle ${value} is blocking the driveway. Kindly move your vehicle.` : '';
    case 'nursery':
      return value ? `Parent of Nursery Tag #${value}, please proceed to the Child Care room.` : '';
    case 'booth':
      return 'Urgent: please proceed to the Media Booth.';
    default:
      return '';
  }
}

/** Notice text as the banner shows it: one line, trimmed, at most ALERT_TEXT_MAX characters. */
export function cleanAlertText(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ALERT_TEXT_MAX)
    .trim();
}

function cleanDuration(value) {
  if (value === null) return null;
  const n = Number(value);
  return ALERT_DURATIONS.includes(n) ? n : DEFAULT_ALERT_DURATION;
}

/**
 * The alert the projector shows, from what the operator console sent. `now` is the time it went live, in ms. Returns null when there is no
 * text to show. `expiresAt` is null for a notice that stays until dismissed.
 */
export function sanitizeAlert(value, now) {
  const text = cleanAlertText(value?.text);
  if (!text) return null;
  const durationSeconds = cleanDuration(value?.durationSeconds === undefined ? DEFAULT_ALERT_DURATION : value.durationSeconds);
  const severity = ALERT_SEVERITIES.includes(value?.severity) ? value.severity : 'warning';
  const shownAt = Number.isFinite(now) ? now : 0;
  const id = typeof value?.id === 'string' && value.id ? value.id.slice(0, 64) : `alert-${shownAt}`;
  return { id, text, severity, durationSeconds, shownAt, expiresAt: durationSeconds === null ? null : shownAt + durationSeconds * 1000 };
}

/** Whether a timed alert has run out at `now`. One that stays until dismissed never does. */
export function alertExpired(alert, now) {
  return Boolean(alert && alert.expiresAt !== null && now >= alert.expiresAt);
}

/** A fresh id for a notice, so a late timer for an earlier one never clears it. */
export function newAlertId(now = Date.now()) {
  return `alert-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
