// Passwords, session tokens and cookies. Uses only Node's built-in crypto, so there is no native module to build on Netlify.
import { randomBytes, scrypt, createHmac, timingSafeEqual } from 'node:crypto';

// scrypt cost settings. Stored with each hash, so they can be raised later without breaking existing passwords.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const COOKIE_NAME = 'apccmma_session';
export const SESSION_HOURS = 12;

const derive = (password, salt, { N, r, p, keylen }) =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** A hash that stores its own settings and salt: scrypt$N$r$p$salt$hash. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** True when the password matches the stored hash. A malformed hash never matches. */
export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), keylen: 32 };
  const expected = Buffer.from(parts[5], 'base64');
  const actual = await derive(password, Buffer.from(parts[4], 'base64'), params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A random session token, shown to the browser once. The server keeps only its hash. */
export const newToken = () => randomBytes(32).toString('base64url');

/**
 * The stored form of a token: an HMAC keyed with TOKEN_SECRET, so a copy of the database alone cannot be turned into
 * working sessions. Refuses to run without a secret.
 */
export function hashToken(token, secret) {
  if (!secret || secret.length < 32) throw new Error('TOKEN_SECRET is missing or too short.');
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** The value of one named cookie from a Cookie header, or null. */
export function readCookie(header, name = COOKIE_NAME) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

/** The session cookie. HttpOnly keeps scripts from reading it, Secure keeps it to HTTPS, and Strict stops cross-site use. */
export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

export const clearedCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** Header names in lower case, so a request's cookie is found whatever case the platform used. */
export const lowerHeaders = (headers = {}) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/**
 * A temporary password for a new or reset account, shown once to the admin. Twelve characters with no look-alikes (0, O, 1,
 * l, i), grouped for reading aloud. The alphabet has 32 characters, so every byte maps evenly: no bias.
 */
export function temporaryPassword() {
  const chars = [...randomBytes(12)].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

const LINK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** A one-time link code in the display-code form, for example K7QM-4XD2. No 0, O, 1 or I. The alphabet has 32 characters,
 *  so every byte maps evenly. */
export function linkCode() {
  const chars = [...randomBytes(8)].map((b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** A church's display code, for example K7QM-4XD2. Made the same way as a link code. */
export function displayCode() {
  const chars = [...randomBytes(8)].map((b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/**
 * A setup key for creating a church's first admin from a laptop. The developer makes it with scripts/create-setup-key.mjs and
 * gives it out once. Twelve characters in three groups of four, for example ABCD-EFGH-JKLM. No 0, O, 1 or I.
 */
export function setupKey() {
  const chars = [...randomBytes(12)].map((b) => LINK_ALPHABET[b % LINK_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** A typed setup key, tidied: case, spaces and dashes are ignored. Null when it cannot be a setup key. */
export function normaliseSetupKey(input) {
  const compact = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
}

/** The device token from an Authorization header (Bearer <token>), or null. */
export function bearerToken(headers) {
  const match = /^Bearer\s+(\S+)$/.exec(String(lowerHeaders(headers).authorization ?? ''));
  return match ? match[1] : null;
}

/** A device token: shown to the laptop once, and stored on the server only as a keyed hash. */

export const deviceToken = () => randomBytes(32).toString('base64url');

/** A typed link code, tidied: case, spaces and dashes are ignored. Null when it cannot be a link code. */
export function normaliseLinkCode(input) {
  const compact = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
