// Field encryption for private text kept in the database (Mass intentions). Pure Node crypto, no Electron and no database, so it can be
// tested on its own. electron/db-vault.js holds the key and decides which fields are sealed.
//
// The key comes from the parish passphrase: PBKDF2-HMAC-SHA256 turns it into a 256-bit master key once, when a laptop is unlocked. Each
// sealed value then gets its own 16-byte random salt, and HKDF-SHA256 derives that value's key from the master key and the salt. PBKDF2 is
// the slow step that protects a weak passphrase; running it again for every row would make a list of 200 notes take many seconds, and
// would add no strength, since every row's key still comes from the same passphrase.
//
// A sealed value is the text SEALED_PREFIX + base64url( SALT 16B | IV 12B | AUTH_TAG 16B | CIPHERTEXT ). AES-256-GCM with a 96-bit IV
// and a 128-bit tag: a changed byte anywhere (salt, IV, tag, ciphertext, or the field name bound in as associated data) fails the tag
// check, and opening throws DecryptionError before any text is returned.
import crypto from 'node:crypto';

export const KDF = 'pbkdf2-sha256';
// OWASP's figure for PBKDF2-HMAC-SHA256. The count is stored with each key (db_crypto.iterations), so a passphrase set at an older count still opens.
export const PBKDF2_ITERATIONS = 600_000;
export const KEY_BYTES = 32;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
const HEADER_BYTES = SALT_BYTES + IV_BYTES + TAG_BYTES;

/** Marks a sealed value, so a reader can tell it from plain text. It also names the format version. */
export const SEALED_PREFIX = 'apccmma-enc:v1:';
const HKDF_INFO = Buffer.from('apccmma field key v1');

/** The value was changed, damaged, or sealed with another key. Its text is never returned. */
export class DecryptionError extends Error {
  constructor(message = 'This text could not be decrypted. It was changed or damaged, or it was sealed with another key.') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** A new random salt for the passphrase, or for one value. */
export const randomSalt = () => crypto.randomBytes(SALT_BYTES);

/** The 256-bit master key from the passphrase and its salt. Slow on purpose (PBKDF2, `iterations` rounds). */
export function deriveMasterKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) throw new TypeError('A passphrase is required.');
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_BYTES) throw new TypeError(`The salt must be ${SALT_BYTES} bytes.`);
  if (!Number.isInteger(iterations) || iterations < 1) throw new TypeError('The iteration count must be a positive whole number.');
  return crypto.pbkdf2Sync(passphrase.normalize('NFC'), salt, iterations, KEY_BYTES, 'sha256');
}

const requireKey = (key) => {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new TypeError(`The key must be ${KEY_BYTES} bytes.`);
};

/** One value's key: HKDF-SHA256 of the master key, with the value's own salt. */
const fieldKey = (masterKey, salt) => Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, HKDF_INFO, KEY_BYTES));

/** True when `value` is in the sealed format (it may still fail to open). */
export const isSealed = (value) => typeof value === 'string' && value.startsWith(SEALED_PREFIX);

/**
 * Seals `plaintext` with the master key. `aad` names the field (for example 'notes.body'): it is checked when the value is opened, so a
 * value copied into another field does not open there.
 */
export function seal(plaintext, masterKey, aad) {
  requireKey(masterKey);
  if (typeof plaintext !== 'string') throw new TypeError('Only text can be sealed.');
  const salt = randomSalt();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', fieldKey(masterKey, salt), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(String(aad)));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const packed = Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]);
  return SEALED_PREFIX + packed.toString('base64url');
}

/** The text in a sealed value. Throws DecryptionError when the value is not well formed or its tag does not match. */
export function open(sealed, masterKey, aad) {
  requireKey(masterKey);
  if (!isSealed(sealed)) throw new DecryptionError('This value is not in the sealed format.');
  const body = sealed.slice(SEALED_PREFIX.length);
  // Buffer.from(…, 'base64url') skips characters it does not know and ignores the spare bits of the last one, so a changed character
  // could decode to the same bytes. Only the canonical encoding of the bytes is accepted: any change to the stored text is refused.
  const packed = Buffer.from(body, 'base64url');
  if (packed.length < HEADER_BYTES || packed.toString('base64url') !== body) throw new DecryptionError();
  const salt = packed.subarray(0, SALT_BYTES);
  const iv = packed.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = packed.subarray(SALT_BYTES + IV_BYTES, HEADER_BYTES);
  const ciphertext = packed.subarray(HEADER_BYTES);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', fieldKey(masterKey, salt), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(String(aad)));
    decipher.setAuthTag(tag);
    // final() checks the tag. Nothing from update() is returned unless it passes.
    const text = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return text.toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}
