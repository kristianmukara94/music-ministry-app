// This laptop's license window, set when a church is activated with a setup key. Runs in the main process, which decides whether projection may
// start, and hands the screen ready-made text. Planning and the song library never depend on it.
//
// Anything that cannot be read counts as not expired: a damaged file must never take the projector away during a service.

/** The outputs the congregation sees. The preview is the operator's own monitor, so it stays available for preparation. */
export const PROJECTION_OUTPUTS = ['projector', 'lowerThird'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A timestamp as 15 Dec 2026, in UTC, the clock the expiry is measured on. */
export function formatLicenseDate(iso) {
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The expiry to store from the activation reply: an ISO string, or null for a perpetual license or a value that is not a date. */
export function parseLicenseExpiry(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** True when a heartbeat's value can replace the saved one. Only null or a real date counts, so an older server or a bad value changes nothing. */
export const isLicenseExpiry = (value) => value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));

/** What the laptop may do and what the screen says. `expiresAt` undefined means no church is linked, null means perpetual. */
export function evaluateLicense(expiresAt, nowMs) {
  if (expiresAt === undefined) return { state: 'unlinked', expiresAt: null, canProject: true, statusText: null, banner: null };
  if (expiresAt === null) {
    return { state: 'perpetual', expiresAt: null, canProject: true, statusText: '✓ License Status: Perpetual (Active)', banner: null };
  }
  const date = formatLicenseDate(expiresAt);
  if (nowMs < Date.parse(expiresAt)) {
    return { state: 'active', expiresAt, canProject: true, statusText: `✓ License Status: Active (Expires ${date})`, banner: null };
  }
  return {
    state: 'expired',
    expiresAt,
    canProject: false,
    statusText: `⚠️ License Status: Expired on ${date}`,
    banner: `License Expired on ${date}. Please renew your church activation key.`,
  };
}

/** True for a live action that would turn on an output the congregation sees. Turning one off is always allowed. */
export function startsProjection(action, outputs) {
  const turnsOn = action?.type === 'output/toggle' || (action?.type === 'output/set' && Boolean(action.on));
  return turnsOn && PROJECTION_OUTPUTS.includes(action.output) && !outputs[action.output];
}

export function createLicenseManager({ readExpiry, now = () => Date.now(), onChange = () => {} }) {
  const status = () => evaluateLicense(readExpiry(), now());
  let known = null;
  return {
    status,
    isExpired: () => !status().canProject,
    /** Reads the license again after something changed it, and tells `onChange` when the result differs from the last one seen. */
    reevaluate() {
      const next = status();
      const seen = `${next.state}|${next.expiresAt}`;
      if (seen !== known) {
        known = seen;
        onChange(next);
      }
      return next;
    },
    /** Checked each time projection would start, so a license that ran out while the app was open is caught. A session already on air carries on. */
    refuses: (action, outputs) => startsProjection(action, outputs) && !status().canProject,
  };
}
