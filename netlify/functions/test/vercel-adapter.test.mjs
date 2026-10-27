// Tests for the Vercel adapter (lib/vercel-adapter.js): a valid name reaches its handler, an unknown name gets 404, a POST body
// arrives as text, and the result comes back as a Vercel response. Run with: node --test netlify/functions/test/vercel-adapter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LOADERS, bodyText, createVercelHandler, toEvent } from '../lib/vercel-adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = path.join(here, '..');

// The real handlers need these only when they are called; the GET used below is refused before any database call.
process.env.DATABASE_URL = 'postgres://user:pass@example.invalid/db';
process.env.TOKEN_SECRET = randomBytes(32).toString('hex');

/** A Vercel-style request and response, enough for the adapter. */
function fakeReq({ method = 'GET', name, headers = {}, body, query, remote = '192.0.2.10' } = {}) {
  return { method, headers, body, query: { name, ...(query ?? {}) }, socket: { remoteAddress: remote } };
}
function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(text) {
      this.body = text;
    },
  };
}

test('a valid name reaches its own handler, and the handler gets the Netlify-style event', async () => {
  let seen;
  const handler = createVercelHandler({
    login: async () => ({
      handler: async (event) => {
        seen = event;
        return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'reached' };
      },
    }),
  });
  const res = fakeRes();
  await handler(fakeReq({ method: 'POST', name: 'login', body: { username: 'a' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'reached');
  assert.equal(seen.httpMethod, 'POST');
  assert.equal(seen.remoteAddress, '192.0.2.10');
});

test('a real function is reached: a GET to login is refused by the handler itself, with its own message', async () => {
  const handler = createVercelHandler(LOADERS);
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET', name: 'login' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).error, 'Use POST.');
});

test('an unknown name gets 404 and no handler runs', async () => {
  let ran = false;
  const handler = createVercelHandler({ login: async () => (ran = true) });
  for (const name of ['nope', 'constructor', '__proto__', undefined, '../login']) {
    const res = fakeRes();
    await handler(fakeReq({ method: 'POST', name }), res);
    assert.equal(res.statusCode, 404, `${String(name)} is refused`);
    assert.equal(JSON.parse(res.body).error, 'Not found.');
  }
  assert.equal(ran, false);
});

test('a POST body arrives as the text the handlers parse, whether Vercel parsed it or not', () => {
  assert.equal(bodyText({ username: 'a', password: 'b' }), '{"username":"a","password":"b"}');
  assert.equal(bodyText('{"x":1}'), '{"x":1}');
  assert.equal(bodyText(Buffer.from('raw')), 'raw');
  assert.equal(bodyText(undefined), undefined);
  assert.equal(toEvent(fakeReq({ method: 'POST', body: { a: 1 } })).body, '{"a":1}');
});

test('the client cannot set the platform address header, so it is removed before the handler sees it', () => {
  const event = toEvent(fakeReq({ headers: { 'X-NF-Client-Connection-IP': '6.6.6.6', 'X-Forwarded-For': '203.0.113.7' } }));
  assert.equal(event.headers['x-nf-client-connection-ip'], undefined);
  assert.equal(event.headers['x-forwarded-for'], '203.0.113.7', 'other headers pass through, in lower case');
});

test('the query string reaches the handler without the function name', () => {
  assert.deepEqual(toEvent(fakeReq({ name: 'plan-get', query: { id: 'abc' } })).queryStringParameters, { id: 'abc' });
  assert.equal(toEvent(fakeReq({ name: 'me' })).queryStringParameters, null);
});

test('a handler that fails gives a plain 500 and no detail', async () => {
  const handler = createVercelHandler({
    login: async () => ({
      handler: async () => {
        throw new Error('secret detail that must not leak');
      },
    }),
  });
  const res = fakeRes();
  await handler(fakeReq({ method: 'POST', name: 'login' }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error, 'Something went wrong. Try again.');
  assert.equal(res.body.includes('secret detail'), false);
});

test('every function file in netlify/functions is served by the adapter, and nothing else is', () => {
  const files = fs
    .readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name.replace(/\.js$/, ''))
    .sort();
  assert.deepEqual(Object.keys(LOADERS).sort(), files);
});
