// Tests Mass intention privacy end to end through the notes service: turning it on seals existing intentions, reads open them, a laptop
// without the passphrase is locked and cannot write intentions or overwrite sealed ones, a remembered key survives a restart, a passphrase
// change re-seals everything and locks laptops holding the old key, a damaged value is caught without breaking the list, a backup opens on
// another laptop with the passphrase, and turning privacy off writes plain text back.
// Run with: node --test electron/db-vault.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { NOTES_COPY_MIGRATIONS, NOTES_SLOT_MIGRATIONS, NOTE_SEALED_FIELDS, PRAYER_NOTES_MIGRATIONS, PRAYER_NOTES_SPLIT_MIGRATIONS, createNotesService } = await import('./notes.js');
const { DB_CRYPTO_MIGRATIONS, VAULT_MESSAGES, VaultLockedError, createDbVault } = await import('./db-vault.js');
const { SEALED_PREFIX, isSealed } = await import('./db-crypto.js');

const PASS = 'Assumption of Mary 1952';
const MIGRATIONS = [...PRAYER_NOTES_MIGRATIONS, ...PRAYER_NOTES_SPLIT_MIGRATIONS, ...NOTES_SLOT_MIGRATIONS, ...NOTES_COPY_MIGRATIONS, ...DB_CRYPTO_MIGRATIONS];

function notesDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  for (const sqlText of MIGRATIONS) db.exec(sqlText);
  return db;
}

/** A key cache like the app's safeStorage file, in memory. One per "laptop". */
function memoryCache() {
  const keys = new Map();
  return { keys, get: (id) => keys.get(id) ?? null, set: (id, key) => keys.set(id, Buffer.from(key)), delete: (id) => keys.delete(id) };
}

/** One laptop: its own vault (and key cache) and notes service on the shared database. */
function laptop(db, keyCache = memoryCache()) {
  const vault = createDbVault(db, { fields: NOTE_SEALED_FIELDS, keyCache });
  return { vault, notes: createNotesService(db, { vault }), keyCache };
}

const intention = (extra = {}) => ({
  title: 'Mass Intentions, Sunday 9 AM',
  category: 'Mass Intention',
  body: 'For the eternal repose of Lola Remedios Santos\n---\nFor the healing of Tito Ben',
  display: 'full',
  style: null,
  ...extra,
});
const hymnNote = (extra = {}) => ({ title: 'Choir cue', category: 'Community Prayer', body: 'Keep the Gloria short.', display: 'operator', style: null, ...extra });
const rawBody = (db, id) => db.prepare('SELECT body FROM notes WHERE id = ?').get(id).body;

test('turning privacy on seals the existing Mass intentions only, and the file no longer holds their text', () => {
  const db = notesDb();
  const plain = createNotesService(db);
  const a = plain.save(intention());
  const b = plain.save(hymnNote());
  assert.equal(rawBody(db, a.id), intention().body);

  const { vault, notes } = laptop(db);
  assert.deepEqual(vault.status(), { configured: false, unlocked: false, remembers: true });
  const sealed = vault.setup(PASS);
  assert.deepEqual(sealed, { notes: [a.id] });
  assert.ok(isSealed(rawBody(db, a.id)));
  assert.ok(!rawBody(db, a.id).includes('Lola'));
  assert.equal(rawBody(db, b.id), hymnNote().body, 'other categories stay plain');
  assert.deepEqual(vault.status(), { configured: true, unlocked: true, remembers: true });

  // The service reads it back as it was, split and all.
  assert.equal(notes.get(a.id).body, intention().body);
  assert.equal(notes.get(a.id).sealed, null);
  assert.equal(notes.list().find((n) => n.id === a.id).body, intention().body);
  // The key row holds a salt, a count and a verifier: never the passphrase or the key.
  const row = db.prepare('SELECT * FROM db_crypto').get();
  assert.equal(row.iterations, 600_000);
  assert.equal(row.kdf, 'pbkdf2-sha256');
  assert.ok(!JSON.stringify(row).includes(PASS));
});

test('new and edited intentions are sealed on write; a split is kept; moving a note out of the category stores it plain', () => {
  const db = notesDb();
  const { vault, notes } = laptop(db);
  vault.setup(PASS);
  const saved = notes.save(intention({ split: { mode: 'manual', at: [0] } }));
  assert.ok(isSealed(rawBody(db, saved.id)));
  assert.equal(saved.body, intention().body);
  assert.deepEqual(saved.split.at, [0]);

  const edited = notes.save({ ...intention({ body: 'For the parish youth' }), id: saved.id });
  assert.equal(edited.body, 'For the parish youth');
  assert.ok(isSealed(rawBody(db, saved.id)));

  notes.save({ ...intention({ category: 'Community Prayer', body: 'Now public' }), id: saved.id });
  assert.equal(rawBody(db, saved.id), 'Now public');
});

test('a laptop without the passphrase is locked: intentions read empty, and no write can expose or overwrite them', () => {
  const db = notesDb();
  const first = laptop(db);
  first.vault.setup(PASS);
  const saved = first.notes.save(intention());
  const before = rawBody(db, saved.id);

  const other = laptop(db);
  assert.deepEqual(other.vault.status(), { configured: true, unlocked: false, remembers: true });
  const shown = other.notes.get(saved.id);
  assert.equal(shown.body, '');
  assert.equal(shown.sealed, 'locked');
  assert.equal(shown.split, null);
  assert.equal(other.notes.list()[0].sealed, 'locked');

  // A new intention would be written in the clear: refused.
  assert.throws(() => other.notes.save(intention()), VaultLockedError);
  // Saving the locked note (the screen has only an empty body) would destroy it: refused, even when the category changes.
  assert.throws(() => other.notes.save({ ...intention({ body: '' }), id: saved.id }), VaultLockedError);
  assert.throws(() => other.notes.save({ ...hymnNote({ body: '' }), id: saved.id }), VaultLockedError);
  assert.equal(rawBody(db, saved.id), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1, 'the refused insert left nothing');

  // Other notes work as before, and a locked note can still be deleted.
  assert.equal(other.notes.save(hymnNote()).body, hymnNote().body);
  assert.equal(other.notes.remove(saved.id), true);
});

test('a wrong passphrase is refused; the right one unlocks, and the key is remembered across a restart', () => {
  const db = notesDb();
  laptop(db).vault.setup(PASS);
  const saved = createNotesService(db, { vault: laptop(db).vault });
  assert.throws(() => saved.save(intention()), VaultLockedError);

  const cache = memoryCache();
  const second = laptop(db, cache);
  assert.throws(() => second.vault.unlock('Assumption of Mary 1953'), { message: VAULT_MESSAGES.wrongPassphrase });
  assert.equal(cache.keys.size, 0);
  second.vault.unlock(PASS);
  const note = second.notes.save(intention());
  assert.equal(cache.keys.size, 1);

  // The app starts again on the same laptop: the remembered key opens the notes with no passphrase.
  const restarted = laptop(db, cache);
  assert.equal(restarted.vault.status().unlocked, true);
  assert.equal(restarted.notes.get(note.id).body, intention().body);

  // Locking forgets the key on this laptop only.
  restarted.vault.lock();
  assert.equal(cache.keys.size, 0);
  assert.equal(laptop(db, cache).vault.status().unlocked, false);
});

test('a remembered key that does not match the database is not used', () => {
  const db = notesDb();
  const cache = memoryCache();
  const { vault } = laptop(db, cache);
  vault.setup(PASS);
  const [keyId] = cache.keys.keys();
  cache.keys.set(keyId, Buffer.alloc(32, 7));
  assert.equal(laptop(db, cache).vault.status().unlocked, false);
});

test('a passphrase change re-seals every intention, the old passphrase stops working, and laptops holding the old key lock', () => {
  const db = notesDb();
  const a = laptop(db);
  a.vault.setup(PASS);
  const ids = [a.notes.save(intention()).id, a.notes.save(intention({ title: 'Weekday', body: 'For the sick' })).id];
  const b = laptop(db);
  b.vault.unlock(PASS);
  const before = ids.map((id) => rawBody(db, id));

  const result = a.vault.changePassphrase(PASS, 'Our Lady of the Assumption');
  assert.equal(result.damaged, 0);
  assert.deepEqual(result.ids.notes.sort(), [...ids].sort());
  ids.forEach((id, i) => assert.notEqual(rawBody(db, id), before[i]));
  assert.equal(a.notes.get(ids[1]).body, 'For the sick');

  // Laptop B still holds the old key: it sees the new key id and locks itself instead of writing with the old key.
  assert.equal(b.vault.status().unlocked, false);
  assert.equal(b.notes.get(ids[0]).sealed, 'locked');
  assert.throws(() => b.notes.save(intention()), VaultLockedError);
  assert.throws(() => b.vault.unlock(PASS), { message: VAULT_MESSAGES.wrongPassphrase });
  b.vault.unlock('Our Lady of the Assumption');
  assert.equal(b.notes.get(ids[0]).body, intention().body);

  assert.throws(() => a.vault.changePassphrase('not the passphrase', 'Another long one'), { message: VAULT_MESSAGES.wrongPassphrase });
  assert.throws(() => a.vault.changePassphrase('Our Lady of the Assumption', 'short'), { message: VAULT_MESSAGES.shortPassphrase });
});

test('a tampered or bit-rotted intention is caught: it reads as damaged, the list still loads, and its text is never returned', () => {
  const db = notesDb();
  const { vault, notes } = laptop(db);
  vault.setup(PASS);
  const good = notes.save(intention({ title: 'Good' }));
  const bad = notes.save(intention({ title: 'Bad' }));
  const stored = rawBody(db, bad.id);
  // One character in the middle of the payload changed, as a bad sector or a hand edit would.
  const i = SEALED_PREFIX.length + 30;
  const flipped = stored.slice(0, i) + (stored[i] === 'A' ? 'B' : 'A') + stored.slice(i + 1);
  db.prepare('UPDATE notes SET body = ? WHERE id = ?').run(flipped, bad.id);

  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const list = notes.list();
    assert.equal(list.find((n) => n.id === good.id).body, intention().body);
    const damaged = list.find((n) => n.id === bad.id);
    assert.equal(damaged.sealed, 'damaged');
    assert.equal(damaged.body, '');
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((line) => line.includes(`Note ${bad.id}`)));

  // Unlocked, the operator can rewrite the damaged note.
  assert.equal(notes.save({ ...intention({ body: 'Rewritten' }), id: bad.id }).body, 'Rewritten');

  // A passphrase change skips a damaged value and says so; turning privacy off refuses while one is there.
  db.prepare('UPDATE notes SET body = ? WHERE id = ?').run(flipped, bad.id);
  assert.equal(vault.changePassphrase(PASS, 'Second parish passphrase').damaged, 1);
  assert.throws(() => vault.disable('Second parish passphrase'), /could not be decrypted, so privacy was left on/);
  assert.equal(vault.status().configured, true);
  assert.equal(notes.get(good.id).body, intention().body, 'the refused turn-off changed nothing');
});

test('a backup copied to another laptop opens with the passphrase, and only with it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-vault-'));
  try {
    const file = path.join(dir, 'apccmma.db');
    const db = notesDb(file);
    let id;
    try {
      // Written in the clear first, then sealed when privacy is turned on: the old text must not linger in a free part of the file. A long
      // list grows past its page once sealed, and SQLite frees the old space with its bytes intact unless secure_delete is on.
      createNotesService(db).save(intention({ body: 'For the eternal repose of Lola Remedios Santos.\n'.repeat(70) }));
      id = createNotesService(db).save(intention()).id;
      laptop(db).vault.setup(PASS);
    } finally {
      db.close();
    }
    assert.ok(!fs.readFileSync(file).includes(Buffer.from('Lola Remedios')), 'no intention text anywhere in the file');

    const copy = path.join(dir, 'restored.db');
    fs.copyFileSync(file, copy);
    const restored = new DatabaseSync(copy);
    try {
      const elsewhere = laptop(restored);
      assert.equal(elsewhere.notes.get(id).sealed, 'locked');
      elsewhere.vault.unlock(PASS);
      assert.equal(elsewhere.notes.get(id).body, intention().body);
    } finally {
      restored.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('turning privacy off writes the intentions back as plain text and removes the key', () => {
  const db = notesDb();
  const cache = memoryCache();
  const { vault, notes } = laptop(db, cache);
  vault.setup(PASS);
  const id = notes.save(intention()).id;
  assert.throws(() => vault.disable('wrong passphrase!'), { message: VAULT_MESSAGES.wrongPassphrase });
  assert.deepEqual(vault.disable(PASS), { notes: [id] });
  assert.equal(rawBody(db, id), intention().body);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM db_crypto').get().n, 0);
  assert.equal(cache.keys.size, 0);
  assert.deepEqual(vault.status(), { configured: false, unlocked: false, remembers: true });
  assert.equal(notes.save(intention()).body, intention().body);
});

test('setup refuses a short passphrase and a second setup, and unlock refuses when privacy is off', () => {
  const db = notesDb();
  const { vault } = laptop(db);
  assert.throws(() => vault.unlock(PASS), { message: VAULT_MESSAGES.notSetUp });
  assert.throws(() => vault.setup('too short'), { message: VAULT_MESSAGES.shortPassphrase });
  assert.equal(vault.status().configured, false);
  vault.setup(PASS);
  assert.throws(() => laptop(db).vault.setup('Another long passphrase'), { message: VAULT_MESSAGES.alreadySetUp });
});

test('without a key cache the key is kept in memory only', () => {
  const db = notesDb();
  const vault = createDbVault(db, { fields: NOTE_SEALED_FIELDS, keyCache: null });
  vault.setup(PASS);
  assert.deepEqual(vault.status(), { configured: true, unlocked: true, remembers: false });
  assert.equal(createDbVault(db, { fields: NOTE_SEALED_FIELDS }).status().unlocked, false);
});

test('a database with privacy off behaves as before, with or without a vault', () => {
  const db = notesDb();
  const { notes } = laptop(db);
  const saved = notes.save(intention());
  assert.equal(rawBody(db, saved.id), intention().body);
  assert.equal(saved.sealed, null);
  assert.equal(createNotesService(db).get(saved.id).body, intention().body);
});
