// The key for sealed fields (electron/db-crypto.js), and the fields it seals. Pure: takes a database handle and a key cache, so it can be
// tested without Electron.
//
// The parish sets one passphrase. Its PBKDF2 salt, the iteration count, a key id and a verifier (a known text sealed with the key) are kept
// in the database, in db_crypto. The passphrase and the key never are. So every laptop that opens this database, on a shared folder or
// from a restored backup, makes the same key from the same passphrase, and a wrong passphrase is caught before anything is written.
//
// After a laptop is unlocked, the key is remembered in `keyCache` (in the app, a file encrypted with Electron's safeStorage, which only this
// Windows user on this computer can read), so the operator types the passphrase once per laptop. When the passphrase changes on one laptop,
// the key id in the database changes too. The other laptops see a key id that is not theirs and lock themselves, rather than writing with
// a key nobody else has.
import crypto from 'node:crypto';
import { DecryptionError, KDF, PBKDF2_ITERATIONS, SEALED_PREFIX, deriveMasterKey, isSealed, open, randomSalt, seal } from './db-crypto.js';

/** One row: the passphrase's salt and iteration count, the key's id, and the verifier that proves a key is the right one. */
export const DB_CRYPTO_MIGRATIONS = [
  `CREATE TABLE db_crypto (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    key_id      TEXT NOT NULL,
    kdf         TEXT NOT NULL,
    iterations  INTEGER NOT NULL CHECK (iterations > 0),
    salt        TEXT NOT NULL,
    verifier    TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
];

export const MIN_PASSPHRASE = 10;
export const MAX_PASSPHRASE = 1024;

const VERIFIER_TEXT = 'APCCMMA parish key check';
const VERIFIER_AAD = 'db_crypto.verifier';

export const VAULT_MESSAGES = {
  locked: 'Holy Mass intentions are locked on this laptop. Enter the parish passphrase in Settings, Backup & restore, to read or edit them.',
  notSetUp: 'Holy Mass intention privacy is not turned on for this database.',
  alreadySetUp: 'Holy Mass intention privacy is already turned on for this database. Unlock it with the parish passphrase.',
  wrongPassphrase: 'That passphrase is not the parish passphrase for this database.',
  shortPassphrase: `The passphrase must be at least ${MIN_PASSPHRASE} characters.`,
  longPassphrase: `The passphrase must be at most ${MAX_PASSPHRASE} characters.`,
  samePassphrase: 'The new passphrase is the same as the current one.',
  unknownKdf: 'This database was protected by a newer version of the app. Update the app to unlock it.',
};

/** Thrown when a sealed field is needed and this laptop does not have the key. */
export class VaultLockedError extends Error {
  constructor(message = VAULT_MESSAGES.locked) {
    super(message);
    this.name = 'VaultLockedError';
  }
}

/**
 * Runs `fn` in a BEGIN IMMEDIATE transaction: the write lock is taken first, so a laptop sharing the database cannot change the key between
 * the check and the write. Plain SQL, so it works with better-sqlite3 (the app) and node:sqlite (the tests).
 */
export function immediateTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  let result;
  try {
    result = fn();
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite already rolled back (some errors end the transaction themselves).
    }
    throw err;
  }
  db.exec('COMMIT');
  return result;
}

const checkPassphrase = (passphrase) => {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new Error(VAULT_MESSAGES.shortPassphrase);
  if (passphrase.length > MAX_PASSPHRASE) throw new Error(VAULT_MESSAGES.longPassphrase);
  return passphrase;
};

/**
 * `fields` are the sealed fields: { table, column, aad, plainWhere }. `plainWhere` is the SQL condition that picks the rows whose value is
 * sealed (for example "category = 'Mass Intention'"); it is written by the app, never by a user. `keyCache` is { get(keyId) → Buffer|null,
 * set(keyId, key), delete(keyId) }, or null to keep the key in memory only.
 */
export function createDbVault(db, { fields = [], keyCache = null } = {}) {
  const readRow = db.prepare('SELECT key_id AS keyId, kdf, iterations, salt, verifier FROM db_crypto WHERE id = 1');
  const insertRow = db.prepare('INSERT INTO db_crypto (id, key_id, kdf, iterations, salt, verifier) VALUES (1, @keyId, @kdf, @iterations, @salt, @verifier)');
  const updateRow = db.prepare(
    "UPDATE db_crypto SET key_id = @keyId, kdf = @kdf, iterations = @iterations, salt = @salt, verifier = @verifier, updated_at = datetime('now') WHERE id = 1",
  );
  const deleteRow = db.prepare('DELETE FROM db_crypto WHERE id = 1');

  // Table and column names come from `fields`, which the app writes. The prefix is compared exactly, not with LIKE.
  const statements = fields.map((f) => ({
    ...f,
    sealedRows: db.prepare(`SELECT rowid AS id, ${f.column} AS value FROM ${f.table} WHERE substr(${f.column}, 1, ${SEALED_PREFIX.length}) = ?`),
    plainRows: db.prepare(
      `SELECT rowid AS id, ${f.column} AS value FROM ${f.table} WHERE (${f.plainWhere}) AND substr(${f.column}, 1, ${SEALED_PREFIX.length}) IS NOT ?`,
    ),
    write: db.prepare(`UPDATE ${f.table} SET ${f.column} = ? WHERE rowid = ?`),
  }));

  /** The key this laptop holds now: { keyId, key }, or null. */
  let session = null;

  const verifies = (key, row) => {
    try {
      return open(row.verifier, key, VERIFIER_AAD) === VERIFIER_TEXT;
    } catch (err) {
      if (err instanceof DecryptionError) return false;
      throw err;
    }
  };

  const remember = (keyId, key) => {
    session = { keyId, key };
    try {
      keyCache?.set(keyId, key);
    } catch (err) {
      // The laptop stays unlocked until the app closes; it asks again next time.
      console.error('[db-vault] The key could not be remembered on this computer:', err);
    }
  };

  const forget = (keyId) => {
    session = null;
    try {
      if (keyId) keyCache?.delete(keyId);
    } catch (err) {
      console.error('[db-vault] The remembered key could not be removed:', err);
    }
  };

  /** The key from a passphrase, checked against the row. Throws when the passphrase is wrong. */
  const keyFromPassphrase = (passphrase, row) => {
    if (row.kdf !== KDF) throw new Error(VAULT_MESSAGES.unknownKdf);
    const key = deriveMasterKey(String(passphrase ?? ''), Buffer.from(row.salt, 'base64'), row.iterations);
    if (!verifies(key, row)) throw new Error(VAULT_MESSAGES.wrongPassphrase);
    return key;
  };

  /** A new key: new salt, new id, new verifier. */
  const newKey = (passphrase) => {
    const salt = randomSalt();
    const key = deriveMasterKey(passphrase, salt, PBKDF2_ITERATIONS);
    const row = { keyId: crypto.randomUUID(), kdf: KDF, iterations: PBKDF2_ITERATIONS, salt: salt.toString('base64'), verifier: seal(VERIFIER_TEXT, key, VERIFIER_AAD) };
    return { key, row };
  };

  /**
   * The key for the database as it is now, or null. Read on every use, so a passphrase changed on another laptop locks this one at once.
   * The row is one primary-key lookup.
   */
  const currentKey = () => {
    const row = readRow.get();
    if (!row) {
      session = null;
      return null;
    }
    if (session?.keyId === row.keyId) return session.key;
    if (session) forget(session.keyId);
    // A key remembered from an earlier start is used only if it still opens this database's verifier.
    let cached = null;
    try {
      cached = keyCache?.get(row.keyId) ?? null;
    } catch {
      cached = null;
    }
    if (cached && verifies(cached, row)) {
      session = { keyId: row.keyId, key: cached };
      return cached;
    }
    return null;
  };

  // A deleted or overwritten row is zeroed in the file, not just marked free, so plain text replaced by a sealed value does not linger.
  const secureDelete = () => db.exec('PRAGMA secure_delete = ON');

  const sealedIds = () => {
    const ids = {};
    for (const f of statements) ids[f.table] = f.sealedRows.all(SEALED_PREFIX).map((r) => r.id);
    return ids;
  };

  if (readRow.get()) secureDelete();

  return {
    /** For the Settings screen. `remembers` says whether an unlocked laptop keeps the key between starts. */
    status() {
      const configured = Boolean(readRow.get());
      return { configured, unlocked: configured && currentKey() !== null, remembers: Boolean(keyCache) };
    },

    configured: () => Boolean(readRow.get()),

    /**
     * Seal and open with the current key, or null when this database has no passphrase. Throws VaultLockedError when it has one and this
     * laptop is locked. Taken once per operation, so a list reads the key row once.
     */
    cipher() {
      if (!readRow.get()) return null;
      const key = currentKey();
      if (!key) throw new VaultLockedError();
      return { seal: (text, aad) => seal(text, key, aad), open: (value, aad) => open(value, key, aad) };
    },

    /** Like cipher(), but null when locked instead of throwing: for reads, which show a locked note rather than fail. */
    readCipher() {
      if (!readRow.get()) return null;
      const key = currentKey();
      return key ? { seal: (text, aad) => seal(text, key, aad), open: (value, aad) => open(value, key, aad) } : null;
    },

    isSealed,

    /** Turns privacy on: sets the passphrase and seals every value that should be sealed. Returns the ids now sealed, by table. */
    setup(passphrase) {
      checkPassphrase(passphrase);
      const { key, row } = newKey(passphrase);
      immediateTransaction(db, () => {
        if (readRow.get()) throw new Error(VAULT_MESSAGES.alreadySetUp);
        insertRow.run(row);
        secureDelete();
        for (const f of statements) {
          for (const r of f.plainRows.all(SEALED_PREFIX)) f.write.run(seal(String(r.value ?? ''), key, f.aad), r.id);
        }
      });
      remember(row.keyId, key);
      return sealedIds();
    },

    /** Unlocks this laptop with the passphrase. Returns the sealed ids, so the windows can read those notes again. */
    unlock(passphrase) {
      const row = readRow.get();
      if (!row) throw new Error(VAULT_MESSAGES.notSetUp);
      const key = keyFromPassphrase(passphrase, row);
      remember(row.keyId, key);
      return sealedIds();
    },

    /** Locks this laptop: the key is dropped and no longer remembered here. Other laptops and the database are not changed. */
    lock() {
      const ids = readRow.get() ? sealedIds() : {};
      forget(session?.keyId ?? readRow.get()?.keyId);
      return ids;
    },

    /**
     * A new passphrase. Every sealed value is opened with the old key and sealed again with a new one, in one transaction. A value that
     * does not open (damaged) is left as it is and counted; it could not be read before either.
     */
    changePassphrase(current, next) {
      checkPassphrase(next);
      if (current === next) throw new Error(VAULT_MESSAGES.samePassphrase);
      const { key, row } = newKey(next);
      let damaged = 0;
      let oldKeyId = null;
      immediateTransaction(db, () => {
        const old = readRow.get();
        if (!old) throw new Error(VAULT_MESSAGES.notSetUp);
        const oldKey = keyFromPassphrase(current, old);
        oldKeyId = old.keyId;
        for (const f of statements) {
          for (const r of f.sealedRows.all(SEALED_PREFIX)) {
            let text;
            try {
              text = open(r.value, oldKey, f.aad);
            } catch (err) {
              if (!(err instanceof DecryptionError)) throw err;
              damaged += 1;
              continue;
            }
            f.write.run(seal(text, key, f.aad), r.id);
          }
        }
        updateRow.run(row);
      });
      // Only after the commit: a failed commit keeps the old key, which still matches the database.
      forget(oldKeyId);
      remember(row.keyId, key);
      return { ids: sealedIds(), damaged };
    },

    /**
     * Turns privacy off: every sealed value is written back as plain text and the key row is removed. Refused while any value does not
     * open, since removing the key would leave that value unreadable for good.
     */
    disable(passphrase) {
      let ids = {};
      let keyId = null;
      immediateTransaction(db, () => {
        const row = readRow.get();
        if (!row) throw new Error(VAULT_MESSAGES.notSetUp);
        const key = keyFromPassphrase(passphrase, row);
        keyId = row.keyId;
        ids = sealedIds();
        let damaged = 0;
        for (const f of statements) {
          for (const r of f.sealedRows.all(SEALED_PREFIX)) {
            try {
              f.write.run(open(r.value, key, f.aad), r.id);
            } catch (err) {
              if (!(err instanceof DecryptionError)) throw err;
              damaged += 1;
            }
          }
        }
        if (damaged) {
          throw new Error(
            `${damaged} sealed note${damaged === 1 ? '' : 's'} could not be decrypted, so privacy was left on. Delete or rewrite ${damaged === 1 ? 'it' : 'them'} first.`,
          );
        }
        deleteRow.run();
      });
      forget(keyId);
      return ids;
    },
  };
}
