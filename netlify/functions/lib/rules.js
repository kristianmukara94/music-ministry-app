// The sign-in rules, as plain functions so they can be tested without a database.

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 10;
export const LOGIN_LIMIT = { requests: 10, windowMs: 60 * 1000 };
export const ROLES = ['admin', 'planner', 'viewer'];
/** Roles that may change a church's plans. Viewers read only. */
export const EDITING_ROLES = ['admin', 'planner'];

export const isLocked = (user, now) => Boolean(user.locked_until) && new Date(user.locked_until) > now;

/** What a failed sign-in does to the account: the count goes up, and at the limit the account locks for 15 minutes. */
export function afterFailedAttempt(user, now) {
  const failed = Number(user.failed_attempts ?? 0) + 1;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    return { failed_attempts: 0, locked_until: new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) };
  }
  return { failed_attempts: failed, locked_until: null };
}

/** A new password must be at least 10 characters. Nothing else is required, so a passphrase is allowed. */
export function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`;
  }
  return null;
}

/** A fixed-window limit per key (the client's IP). Returns false once the key uses up its requests in the window. */
export function createRateLimiter({ requests, windowMs }) {
  const hits = new Map();
  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= requests) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}

/** Whole minutes left on a lock, rounded up, and never less than one while the lock lasts. */
export function lockMinutesLeft(lockedUntil, now) {
  return Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - now.getTime()) / 60000));
}

/** The message for a locked account. Only this message names the lock, so it is never shown for a wrong password. */
export const lockMessage = (minutes) =>
  `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask your church admin.`;

/** The roles that may manage users. Only admins. */
export const ADMIN_ROLES = ['admin'];
