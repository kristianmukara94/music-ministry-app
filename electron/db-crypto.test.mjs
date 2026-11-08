// Tests the field cipher: PBKDF2 key derivation, the packed SALT | IV | TAG | CIPHERTEXT layout, round trips, and that any change to a
// sealed value (every byte, every character, truncation, another key, another field) is refused without returning text.
// Run with: node --test electron/db-crypto.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  DecryptionError,
  IV_BYTES,
  KEY_BYTES,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  SEALED_PREFIX,
  TAG_BYTES,
  deriveMasterKey,
  isSealed,
  open,
  randomSalt,
  seal,
} from './db-crypto.js';

const AAD = 'notes.body';
const key = crypto.randomBytes(KEY_BYTES);
const TEXT = 'For the eternal repose of the soul of Lola Remedios, requested by the Santos family. Para sa kaluluwa ni Lola. 🙏';
const packedOf = (sealed) => Buffer.from(sealed.slice(SEALED_PREFIX.length), 'base64url');
const encode = (bytes) => SEALED_PREFIX + bytes.toString('base64url');

test('the master key is PBKDF2-HMAC-SHA256, 100,000 rounds, 256 bits, from a 16-byte salt', () => {
  assert.equal(PBKDF2_ITERATIONS, 100_000);
  const salt = randomSalt();
  assert.equal(salt.length, 16);
  const derived = deriveMasterKey('Assumption parish 1952', salt);
  assert.equal(derived.length, 32);
  assert.deepEqual(derived, crypto.pbkdf2Sync('Assumption parish 1952', salt, 100_000, 32, 'sha256'));
  // Same passphrase and salt: same key, on any laptop. Another salt or passphrase: another key.
  assert.deepEqual(deriveMasterKey('Assumption parish 1952', salt), derived);
  assert.notDeepEqual(deriveMasterKey('Assumption parish 1952', randomSalt()), derived);
  assert.notDeepEqual(deriveMasterKey('Assumption parish 1953', salt), derived);
});

test('a passphrase typed in another Unicode form makes the same key', () => {
  const salt = randomSalt();
  assert.deepEqual(deriveMasterKey('Niño Jesús parish', salt), deriveMasterKey('Niño Jesús parish', salt));
});

test('bad inputs to derivation and sealing are refused', () => {
  assert.throws(() => deriveMasterKey('', randomSalt()), TypeError);
  assert.throws(() => deriveMasterKey('passphrase', Buffer.alloc(8)), TypeError);
  assert.throws(() => deriveMasterKey('passphrase', randomSalt(), 0), TypeError);
  assert.throws(() => seal('x', Buffer.alloc(16), AAD), TypeError);
  assert.throws(() => open(seal('x', key, AAD), Buffer.alloc(31), AAD), TypeError);
  assert.throws(() => seal(42, key, AAD), TypeError);
});

test('text round-trips, including empty, multi-line, non-Latin and long text', () => {
  for (const text of ['', TEXT, 'Line one\nLine two\r\n---\nLine three', 'ᜃᜎᜓᜎᜓᜏ ᜈᜒ', 'x'.repeat(200_000)]) {
    const sealed = seal(text, key, AAD);
    assert.ok(isSealed(sealed));
    assert.equal(open(sealed, key, AAD), text);
  }
});

test('the payload is prefix + URL-safe base64 of SALT(16) | IV(12) | TAG(16) | CIPHERTEXT', () => {
  assert.equal(SALT_BYTES + IV_BYTES + TAG_BYTES, 44);
  const sealed = seal(TEXT, key, AAD);
  assert.ok(sealed.startsWith(SEALED_PREFIX));
  assert.match(sealed.slice(SEALED_PREFIX.length), /^[A-Za-z0-9_-]+$/, 'URL-safe alphabet, no padding');
  const packed = packedOf(sealed);
  assert.equal(packed.length, 16 + 12 + 16 + Buffer.byteLength(TEXT, 'utf8'));
  // The ciphertext is not the text.
  assert.ok(!packed.includes(Buffer.from('Lola Remedios')));
  assert.ok(!sealed.includes('Lola'));
});

test('every seal uses a fresh salt and IV, so the same text never seals the same way twice', () => {
  const a = packedOf(seal(TEXT, key, AAD));
  const b = packedOf(seal(TEXT, key, AAD));
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16), 'salt');
  assert.notDeepEqual(a.subarray(16, 28), b.subarray(16, 28), 'IV');
  assert.notDeepEqual(a.subarray(44), b.subarray(44), 'ciphertext');
});

test('flipping any bit of any byte (salt, IV, tag or ciphertext) fails the tag check', () => {
  const packed = packedOf(seal('Pro populo', key, AAD));
  for (let i = 0; i < packed.length; i += 1) {
    for (const bit of [0x01, 0x80]) {
      const changed = Buffer.from(packed);
      changed[i] ^= bit;
      assert.throws(() => open(encode(changed), key, AAD), DecryptionError, `byte ${i}, bit ${bit}`);
    }
  }
});

test('changing any character of the stored text is refused, including the spare bits of the last one', () => {
  const sealed = seal('Pro populo', key, AAD);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = SEALED_PREFIX.length; i < sealed.length; i += 1) {
    const other = alphabet[(alphabet.indexOf(sealed[i]) + 1) % alphabet.length];
    const changed = sealed.slice(0, i) + other + sealed.slice(i + 1);
    assert.throws(() => open(changed, key, AAD), DecryptionError, `character ${i}`);
  }
  // Characters outside the alphabet are refused, not skipped.
  assert.throws(() => open(`${sealed.slice(0, -2)}=${sealed.slice(-2)}`, key, AAD), DecryptionError);
  assert.throws(() => open(`${sealed} `, key, AAD), DecryptionError);
});

test('truncated, extended, empty and foreign values are refused', () => {
  const sealed = seal(TEXT, key, AAD);
  const packed = packedOf(sealed);
  assert.throws(() => open(encode(packed.subarray(0, packed.length - 1)), key, AAD), DecryptionError);
  assert.throws(() => open(encode(Buffer.concat([packed, Buffer.from([0])])), key, AAD), DecryptionError);
  assert.throws(() => open(encode(packed.subarray(0, 43)), key, AAD), DecryptionError, 'shorter than the header');
  assert.throws(() => open(encode(packed.subarray(0, 44)), key, AAD), DecryptionError, 'header with the ciphertext cut off');
  assert.throws(() => open(SEALED_PREFIX, key, AAD), DecryptionError);
  assert.throws(() => open('plain text', key, AAD), DecryptionError);
  assert.throws(() => open(null, key, AAD), DecryptionError);
});

test('another key, or the value moved to another field, does not open, and the error carries no text', () => {
  const sealed = seal(TEXT, key, AAD);
  assert.throws(() => open(sealed, key, 'notes.title'), DecryptionError);
  assert.throws(
    () => open(sealed, crypto.randomBytes(32), AAD),
    (e) => e instanceof DecryptionError && !String(e.stack).includes('Lola'),
  );
});

test('isSealed tells a sealed value from plain text', () => {
  assert.equal(isSealed(seal('x', key, AAD)), true);
  assert.equal(isSealed('For the sick of the parish'), false);
  assert.equal(isSealed(''), false);
  assert.equal(isSealed(null), false);
});
