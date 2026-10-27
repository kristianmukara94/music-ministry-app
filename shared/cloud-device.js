// Cloud sync for a linked laptop: what the Settings screen shows, and how a typed link code is tidied. Pure: no imports, so it
// runs in Electron, the browser and Node alike. The device token itself never appears here, and never reaches the screen.

export const LINK_CODE_LENGTH = 8;

/** A link code as the operator types it: letters only, upper case, with a dash after four characters. */
export function formatLinkCode(input) {
  const compact = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LINK_CODE_LENGTH);
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

/** True when the typed code has all eight characters. */
export const isCompleteLinkCode = (input) => formatLinkCode(input).replace('-', '').length === LINK_CODE_LENGTH;

/** How a time reads on the screen. Null when there is none. */
export function lastSyncedText(iso, now = Date.now()) {
  if (!iso) return 'Not yet';
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The screen state for the Cloud sync section. `link` is what the main process reports: { linked, church, admin, label,
 * lastSeenAt, offline, error }. The result has only what the screen shows, so no token can reach it.
 */
export function cloudViewState(link) {
  if (!link || !link.linked) {
    return { kind: 'unlinked', error: link?.error ?? null };
  }
  return {
    kind: 'linked',
    churchName: link.church ?? '',
    adminName: link.admin ?? 'Not known',
    deviceLabel: link.label ?? '',
    lastSynced: lastSyncedText(link.lastSeenAt),
    offline: Boolean(link.offline),
    error: link.error ?? null,
  };
}

/** The roles a web user can have. The same list the server accepts. */
export const WEB_USER_ROLES = ['admin', 'planner', 'viewer'];

/**
 * Checks a new web user before anything is sent, with the same rules the server applies: a username of up to 80 characters with
 * no spaces, a name of up to 120, and one of the three roles. Returns the plain message for the first problem, or null.
 */
export function checkWebUser({ username, displayName, role } = {}) {
  const name = String(username ?? '').trim();
  const shown = String(displayName ?? '').trim();
  if (!name || name.length > 80 || /\s/.test(name)) return 'Enter a username of up to 80 characters, with no spaces.';
  if (!shown || shown.length > 120) return 'Enter a name of up to 120 characters.';
  if (!WEB_USER_ROLES.includes(role)) return 'Choose a role: admin, planner or viewer.';
  return null;
}

export const SETUP_KEY_LENGTH = 12;

/** A setup key as the operator types it: upper case, with a dash after every four characters. */
export function formatSetupKey(input) {
  const compact = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SETUP_KEY_LENGTH);
  return [compact.slice(0, 4), compact.slice(4, 8), compact.slice(8)].filter(Boolean).join('-');
}

/** True when the typed setup key has all twelve characters. */
export const isCompleteSetupKey = (input) => formatSetupKey(input).replace(/-/g, '').length === SETUP_KEY_LENGTH;

/**
 * Checks the Create church admin form before anything is sent: the setup key, the church name, the admin's username and name
 * (the same rules as a web user), and the laptop's name. Returns the plain message for the first problem, or null.
 */
export function checkChurchSetup({ setupKey, churchName, username, displayName, deviceLabel } = {}) {
  if (!isCompleteSetupKey(setupKey)) return 'Type the whole setup key, in the form ABCD-EFGH-JKLM.';
  const church = String(churchName ?? '').trim();
  if (!church || church.length > 120) return 'Enter a church name of up to 120 characters.';
  const admin = checkWebUser({ username, displayName, role: 'admin' });
  if (admin) return admin;
  const laptop = String(deviceLabel ?? '').trim();
  if (!laptop || laptop.length > 80) return 'Name this laptop, in up to 80 characters.';
  return null;
}
