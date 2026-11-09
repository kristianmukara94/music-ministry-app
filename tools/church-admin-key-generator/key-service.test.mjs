// The generator's own rules are tested in shared/church-key-generator.test.js. These cover what this app adds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createChurchSetupApi, KEY_MESSAGE } from '../../server/lib/church-setup.js';
import { tagFromQuery } from '../../server/lib/db.js';
import { CHECK_FAILED, NOT_CONNECTED, NOT_SAVED, handleGenerate, hashSetupKey, validateChurchCode, validateSetupKey } from './key-service.mjs';

const SECRET = randomBytes(32).toString('hex');
const DATABASE_URL = 'postgresql://user:hunter2@db.example.test/neondb';
const env = { DATABASE_URL, TOKEN_SECRET: SECRET };

const stubKeys = (overrides) => ({
  generateSetupKey: () => 'AAAA-AAAA-AAAA',
  generateChurchCode: () => 'BBBB-BBBB',
  validateSetupKey: () => true,
  validateChurchCode: () => true,
  ...overrides,
});

/** Stands in for the Neon driver and records each insert. */
function fakeDatabase() {
  const inserts = [];
  const urls = [];
  const connect = (url) => {
    urls.push(url);
    return async (strings, ...values) => {
      inserts.push({ text: strings.join('?'), values });
      return [];
    };
  };
  return { connect, inserts, urls };
}

test('Generate returns keys that pass their checks, and saves only the keyed hash of each setup key', async () => {
  const db = fakeDatabase();
  for (let i = 0; i < 200; i += 1) {
    const { setupKey, churchCode, error } = await handleGenerate('PTGS', { env, connect: db.connect });
    assert.equal(error, undefined);
    assert.equal(validateSetupKey(setupKey), true);
    assert.equal(validateChurchCode(churchCode), true);
    assert.ok(churchCode.startsWith('PTGS-'));
    assert.deepEqual(db.inserts[i].values, [hashSetupKey(setupKey, SECRET)]);
    assert.match(db.inserts[i].text, /INSERT INTO setup_keys \(key_hash, expires_at\).*now\(\) \+ interval '7 days'/);
  }
  assert.equal(new Set(db.urls).size, 1);
  assert.equal(db.urls[0], DATABASE_URL);
});

test('a blank prefix gives a random church code', async () => {
  const { churchCode } = await handleGenerate('', { env, connect: fakeDatabase().connect });
  assert.equal(validateChurchCode(churchCode), true);
});

for (const failing of ['validateSetupKey', 'validateChurchCode']) {
  test(`the guard withholds both values and saves nothing when ${failing} fails`, async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    const db = fakeDatabase();
    const result = await handleGenerate('', { keys: stubKeys({ [failing]: () => false }), env, connect: db.connect });
    assert.deepEqual(result, { error: CHECK_FAILED });
    assert.equal(logged.mock.callCount(), 1);
    assert.equal(db.inserts.length, 0);
  });
}

test('a prefix that cannot appear in a code comes back as a message and saves nothing', async () => {
  const db = fakeDatabase();
  assert.match((await handleGenerate('OLPH', { env, connect: db.connect })).error, /parish prefix/);
  assert.equal(db.inserts.length, 0);
});

const unusableSettings = {
  'no DATABASE_URL': { TOKEN_SECRET: SECRET },
  'no TOKEN_SECRET': { DATABASE_URL },
  'a TOKEN_SECRET too short for the server to accept': { DATABASE_URL, TOKEN_SECRET: 'short' },
};

for (const [name, settings] of Object.entries(unusableSettings)) {
  test(`with ${name}, no key is shown and the database is not contacted`, async () => {
    const db = fakeDatabase();
    assert.deepEqual(await handleGenerate('', { env: settings, connect: db.connect }), { error: NOT_CONNECTED });
    assert.equal(db.urls.length, 0);
  });
}

const failures = {
  'the insert fails': () => async () => {
    throw new Error(`could not reach ${DATABASE_URL}`);
  },
  'the connection string is refused': () => {
    throw new Error(`bad connection string ${DATABASE_URL}`);
  },
};

for (const [name, connect] of Object.entries(failures)) {
  test(`when ${name}, no key is shown and neither the screen nor the log carries the error text`, async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    assert.deepEqual(await handleGenerate('', { env, connect }), { error: NOT_SAVED });
    assert.deepEqual(logged.mock.calls[0].arguments, ['[key-generator] Error']);
  });
}

test('a key from this app creates a church on the real server code, once, for 7 days', async () => {
  const pg = new PGlite();
  const schema = fs.readFileSync(new URL('../../server/db/schema.sql', import.meta.url), 'utf8');
  await pg.exec(schema);
  const sql = tagFromQuery((text, params) => pg.query(text, params));
  const transaction = (work) => pg.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
  const api = createChurchSetupApi({ sql, transaction, secret: SECRET });
  const redeem = (setupKey) =>
    api({
      httpMethod: 'POST',
      headers: { 'x-real-ip': '203.0.113.9' },
      body: JSON.stringify({ setupKey, churchName: 'St Mary Parish', username: 'parishadmin', displayName: 'Parish Admin', deviceLabel: 'Office laptop' }),
    });

  const { setupKey } = await handleGenerate('', { env, connect: () => sql });

  const stored = (await pg.query(`SELECT key_hash, used_at, church_id, expires_at - created_at = interval '7 days' AS seven_days FROM setup_keys`)).rows;
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].key_hash, setupKey);
  assert.equal(stored[0].used_at, null);
  assert.equal(stored[0].seven_days, true);

  // Lower case and no dashes: the desktop form tidies a key, but the server must find it even if it does not.
  const first = await redeem(setupKey.toLowerCase().replaceAll('-', ''));
  assert.equal(first.statusCode, 201);
  assert.equal(JSON.parse(first.body).username, 'parishadmin');

  const [used] = (await pg.query('SELECT used_at, church_id FROM setup_keys')).rows;
  assert.ok(used.used_at);
  assert.ok(used.church_id);

  const second = await redeem(setupKey);
  assert.equal(second.statusCode, 400);
  assert.equal(JSON.parse(second.body).error, KEY_MESSAGE);
  await pg.close();
});
