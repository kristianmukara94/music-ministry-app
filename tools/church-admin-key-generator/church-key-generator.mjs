// Setup keys (XXXX-XXXX-XXXX) and church codes (XXXX-XXXX), each ending in a check character. Runs in Node and Electron's main
// process only, because it needs node:crypto. The Settings screen cannot import it; the main process does the check for it.
//
// The check character catches typing mistakes before a request is sent. It is not proof that a key is genuine, so the salt below is
// deliberately public: the desktop app has to hold it, and one character could not resist forgery anyway. About 1 mistyped key in 31
// still passes. A setup key is only ever proven by its keyed hash in the setup_keys table, on the server.
//
// tools/church-admin-key-generator/church-key-generator.mjs is an exact copy that the tool's npm scripts make. Edit only this file:
// changing the salt, the character set or the calculation here makes every key already issued fail its check.
import { createHmac, randomInt } from 'node:crypto';

/** No 0, O, 1, I or L. Thirty-one characters, so the check character is taken modulo 31 and every character can appear. */
export const KEY_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const PUBLIC_SALT = 'apccmma-sanctuary-master-salt-2026';
const SETUP_KEY_CHARS = 12;
const CHURCH_CODE_CHARS = 8;

const inCharset = (chars) => [...chars].every((c) => KEY_CHARSET.includes(c));
const compact = (input) => (typeof input === 'string' ? input.toUpperCase().replace(/[\s-]/g, '') : '');
const inGroupsOfFour = (chars) => chars.match(/.{4}/g).join('-');
const randomChars = (count) => Array.from({ length: count }, () => KEY_CHARSET[randomInt(KEY_CHARSET.length)]).join('');

/** The check character for a payload: HMAC-SHA256 of the payload, read as a 32-bit number, modulo 31. */
function checkChar(payload) {
  const digest = createHmac('sha256', PUBLIC_SALT).update(payload).digest();
  return KEY_CHARSET[digest.readUInt32BE(0) % KEY_CHARSET.length];
}

function hasValidCheck(input, length) {
  const chars = compact(input);
  if (chars.length !== length || !inCharset(chars)) return false;
  return chars.at(-1) === checkChar(chars.slice(0, -1));
}

/** The parish prefix tidied to uppercase, or '' when there is none. Throws when it cannot appear in a code. */
function parishPrefix(prefix) {
  if (prefix == null || prefix === '') return '';
  const clean = compact(prefix);
  if (!/^[A-Z]{1,4}$/.test(clean) || !inCharset(clean)) throw new Error('A parish prefix must be up to 4 letters, with no O, I or L.');
  return clean;
}

/** A new setup key, for example A2K9-7M4P-QX3E: eleven random characters and the check character. */
export function generateSetupKey() {
  const payload = randomChars(SETUP_KEY_CHARS - 1);
  return inGroupsOfFour(payload + checkChar(payload));
}

/** True when the key has the right form and check character. Case, spaces and dashes are ignored. */
export const validateSetupKey = (key) => hasValidCheck(key, SETUP_KEY_CHARS);

/**
 * A new church code, for example PTGS-X2D9: an optional parish prefix of up to four letters, random characters up to seven, and the
 * check character. Throws when the prefix cannot appear in a code.
 */
export function generateChurchCode(prefix) {
  const start = parishPrefix(prefix);
  const payload = start + randomChars(CHURCH_CODE_CHARS - 1 - start.length);
  return inGroupsOfFour(payload + checkChar(payload));
}

/**
 * True when the code has the right form and check character. Case, spaces and dashes are ignored. Churches created before check
 * characters existed have codes that fail this, and those codes stay valid, so it must not be used to refuse a sign-in.
 */
export const validateChurchCode = (code) => hasValidCheck(code, CHURCH_CODE_CHARS);
