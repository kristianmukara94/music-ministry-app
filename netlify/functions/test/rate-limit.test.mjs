// Tests for the shared rate limits (lib/rate-limit.js) and the client address they are keyed by (lib/client-address.js), against a
// real Postgres (PGlite). The sign-in header test goes through the real login handler. Run with:
//   node --test netlify/functions/test/rate-limit.test.mjs
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { hit } from '../lib/rate-limit.js';
import { clientAddress } from '../lib/client-address.js';
import { createApi } from '../lib/handlers.js';
import { tagFromQuery } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
const SECRET = randomBytes(32).toString('hex');

let pg;
let clock;

const sql = tagFromQuery((text, params) => pg.query(text, params));
const at = (seconds) => new Date(Date.parse('2026-10-27T12:00:00Z') + seconds * 1000);

before(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
});

beforeEach(async () => {
  clock = at(0);
  await pg.exec('TRUNCATE rate_limits;');
});

// ---- The shared counter ----

test('allows up to the limit in a window, then refuses the next attempt with a retry time', async () => {
  for (let i = 0; i < 3; i += 1) assert.equal((await hit(sql, 'login:a', 3, 60, clock)).allowed, true, `attempt ${i + 1} allowed`);
  const refused = await hit(sql, 'login:a', 3, 60, at(10));
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 50, 'the window opened at 0 seconds and is 60 long, so 50 seconds are left at 10 seconds');
});

test('the window resets after it has passed, and the count starts again', async () => {
  for (let i = 0; i < 2; i += 1) await hit(sql, 'login:b', 2, 60, clock);
  assert.equal((await hit(sql, 'login:b', 2, 60, at(30))).allowed, false);
  assert.equal((await hit(sql, 'login:b', 2, 60, at(61))).allowed, true, 'after the window the next attempt is allowed');
  assert.equal((await hit(sql, 'login:b', 2, 60, at(62))).allowed, true);
  assert.equal((await hit(sql, 'login:b', 2, 60, at(63))).allowed, false, 'and the limit applies again in the new window');
});

test('buckets are kept apart: one address using up its limit does not limit another', async () => {
  for (let i = 0; i < 3; i += 1) await hit(sql, 'login:one', 3, 60, clock);
  assert.equal((await hit(sql, 'login:one', 3, 60, clock)).allowed, false);
  assert.equal((await hit(sql, 'login:two', 3, 60, clock)).allowed, true);
  assert.equal((await hit(sql, 'redeem:one', 3, 60, clock)).allowed, true, 'a different limit name is a different bucket');
});

test('parallel attempts on one bucket never let more than the limit through', async () => {
  const results = await Promise.all(Array.from({ length: 25 }, () => hit(sql, 'login:race', 10, 60, clock)));
  assert.equal(results.filter((r) => r.allowed).length, 10, 'exactly the limit is allowed');
  assert.equal(results.filter((r) => !r.allowed).length, 15);
  assert.equal((await pg.query(`SELECT hits FROM rate_limits WHERE bucket_key = 'login:race'`)).rows[0].hits, 25, 'every attempt is counted');
});

test('the counts are in the database, so a second instance sees the same bucket', async () => {
  await hit(sql, 'login:shared', 1, 60, clock);
  const otherInstance = tagFromQuery((text, params) => pg.query(text, params));
  assert.equal((await hit(otherInstance, 'login:shared', 1, 60, clock)).allowed, false);
});

// ---- The client address ----

test('the Netlify connection address is used first, when the platform sets it', () => {
  assert.equal(clientAddress({ headers: { 'x-nf-client-connection-ip': '198.51.100.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } }), '198.51.100.9');
});

test('on Vercel the real address is the last entry of x-forwarded-for, not the first', () => {
  assert.equal(clientAddress({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } }), '203.0.113.7');
});

test('x-real-ip is used when it is present', () => {
  assert.equal(clientAddress({ headers: { 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } }), '203.0.113.8');
});

test('the connection address is used only when no header is present, and unknown otherwise', () => {
  assert.equal(clientAddress({ headers: {}, remoteAddress: '192.0.2.4' }), '192.0.2.4');
  assert.equal(clientAddress({ headers: {} }), 'unknown');
});

test('a client that sends its own x-forwarded-for first cannot choose a new bucket', async () => {
  const api = createApi({ sql, secret: SECRET, now: () => clock });
  const attempt = (spoofed) =>
    api.login({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': `${spoofed}, 203.0.113.7` },
      body: JSON.stringify({ username: 'nobody', password: 'x' }),
    });
  for (let i = 0; i < 10; i += 1) {
    assert.notEqual((await attempt(`10.0.0.${i}`)).statusCode, 429, `attempt ${i + 1} with a new first entry is still counted`);
  }
  const limited = await attempt('10.0.1.99');
  assert.equal(limited.statusCode, 429, 'the eleventh attempt is refused, whatever the first entry says');
  assert.equal(limited.headers['Retry-After'], '60');
  const otherClient = await api.login({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.50' },
    body: JSON.stringify({ username: 'nobody', password: 'x' }),
  });
  assert.notEqual(otherClient.statusCode, 429, 'a different real client has its own bucket');
});
