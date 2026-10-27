// Tests for church identity, branding, the logo check, the licence match, and the church API's data isolation.
// Run with: node --test shared/church.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChurchApi, createMemoryStore } from './church-api.js';
import {
  DISPLAY_CODE_PATTERN,
  LOGO_MAX_BYTES,
  checkBrandingChange,
  checkLicenceChurch,
  checkLogo,
  displayCodeFrom,
  normaliseDisplayCode,
  sanitiseBranding,
} from './church.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');

/** Two churches with the same name, each with its own data, built through the API. */
function twoChurches() {
  const store = createMemoryStore();
  // Deterministic codes and ids, so each test reads the same way every run.
  let n = 0;
  const api = createChurchApi({
    store,
    newUuid: () => `00000000-0000-4000-8000-00000000000${++n}`,
    newBytes: () => [n * 17 + 3, n * 31 + 5, 7, 9, 11, 13, 15, 17].map((b) => b % 256),
  });
  const a = api.handle({ method: 'POST', path: '/api/churches', body: { name: 'St Mary' } }).body;
  const b = api.handle({ method: 'POST', path: '/api/churches', body: { name: 'St Mary' } }).body;
  store.insert('plans', a.church.id, { id: 'pa', name: 'A plan', liturgical_date: '2026-11-01' });
  store.insert('plans', b.church.id, { id: 'pb', name: 'B plan', liturgical_date: '2026-11-01' });
  store.insert('songs', a.church.id, { id: 'sa', title: 'A song', category: 'Entrance', language: 'EN' });
  store.insert('songs', b.church.id, { id: 'sb', title: 'B song', category: 'Entrance', language: 'EN' });
  store.insert('devices', a.church.id, { id: 'da', name: 'A laptop' });
  store.insert('devices', b.church.id, { id: 'db', name: 'B laptop' });
  return { api, store, a, b };
}

// ---- Identity ----

test('two churches with the same name get different ids and different display codes', () => {
  const { a, b } = twoChurches();
  assert.equal(a.church.name, 'St Mary');
  assert.equal(b.church.name, 'St Mary');
  assert.notEqual(a.church.id, b.church.id);
  assert.notEqual(a.church.displayCode, b.church.displayCode);
  assert.match(a.church.displayCode, DISPLAY_CODE_PATTERN);
  assert.match(b.church.displayCode, DISPLAY_CODE_PATTERN);
});

test('a display code never uses 0, O, 1 or I, and a typed code is tidied', () => {
  const code = displayCodeFrom([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.match(code, DISPLAY_CODE_PATTERN);
  assert.doesNotMatch(code, /[01OI]/);
  assert.equal(normaliseDisplayCode(' k7qm 4xd2 '), 'K7QM-4XD2');
  assert.equal(normaliseDisplayCode('K7QM4XD2'), 'K7QM-4XD2');
  assert.equal(normaliseDisplayCode('K7Q0-4XD2'), null, 'a 0 is not a valid code character');
});

test('a church name cannot be empty, and the name is only text, not a key', () => {
  assert.throws(() => checkBrandingChange({ name: '   ' }), /church name/);
  assert.throws(() => checkBrandingChange({ name: 'x'.repeat(121) }), /120/);
});

// ---- Isolation: a church's token only ever reaches its own data ----

test('church A\'s token cannot read church B\'s plans, songs, devices or branding', () => {
  const { api, a, b } = twoChurches();
  const plans = api.handle({ method: 'GET', path: '/api/plans', token: a.token });
  assert.deepEqual(plans.body.map((p) => p.id), ['pa']);
  assert.deepEqual(api.handle({ method: 'GET', path: '/api/songs', token: a.token }).body.map((s) => s.id), ['sa']);
  assert.deepEqual(api.handle({ method: 'GET', path: '/api/devices', token: a.token }).body.map((d) => d.id), ['da']);
  const branding = api.handle({ method: 'GET', path: '/api/branding', token: a.token }).body;
  assert.equal(branding.displayCode, a.church.displayCode);
  assert.notEqual(branding.displayCode, b.church.displayCode);
});

test('a request that names another church in the body or the query is ignored', () => {
  const { api, a, b } = twoChurches();
  const viaQuery = api.handle({ method: 'GET', path: '/api/plans?church_id=' + b.church.id, token: a.token });
  assert.deepEqual(viaQuery.body.map((p) => p.id), ['pa'], 'the query cannot choose the church');

  const write = api.handle({ method: 'PUT', path: '/api/branding', token: a.token, body: { church_id: b.church.id, accentGold: '#123456' } });
  assert.equal(write.status, 200);
  assert.equal(write.body.accentGold, '#123456', 'A\'s branding changed, as its token asked');
  assert.equal(api.handle({ method: 'GET', path: '/api/branding', token: b.token }).body.accentGold, '#ecc98a', 'B\'s branding did not change');
});

test('a token that belongs to no church gets 401 and no data', () => {
  const { api } = twoChurches();
  assert.equal(api.handle({ method: 'GET', path: '/api/plans', token: 'made-up' }).status, 401);
  assert.equal(api.handle({ method: 'GET', path: '/api/plans' }).status, 401);
});

test('church B\'s logo is not visible to church A\'s token', () => {
  const { api, a, b } = twoChurches();
  assert.equal(api.handle({ method: 'PUT', path: '/api/logo', token: b.token, body: { bytes: PNG } }).status, 200);
  assert.equal(api.handle({ method: 'GET', path: '/api/logo', token: a.token }).status, 404, 'A has no logo of its own');
  assert.equal(api.handle({ method: 'GET', path: '/api/logo', token: b.token }).body.type, 'image/png');
});

// ---- Branding ----

test('branding takes the bundled fonts only and a gold colour, and falls back to the defaults otherwise', () => {
  assert.equal(sanitiseBranding({ fontChoice: 'Comic Sans' }).fontChoice, 'Archivo');
  assert.equal(sanitiseBranding({ fontChoice: 'Cormorant Garamond' }).fontChoice, 'Cormorant Garamond');
  assert.equal(sanitiseBranding({ accentGold: 'javascript:alert(1)' }).accentGold, '#ecc98a');
  assert.equal(sanitiseBranding({ accentGold: '#ABCDEF' }).accentGold, '#abcdef');
  assert.throws(() => checkBrandingChange({ fontChoice: 'Roboto' }), /bundled fonts/);
});

test('a branding change is stored and returned by the API', () => {
  const { api, a } = twoChurches();
  const put = api.handle({ method: 'PUT', path: '/api/branding', token: a.token, body: { name: 'St Mary Parish', fontChoice: 'JetBrains Mono' } });
  assert.equal(put.status, 200);
  assert.equal(put.body.name, 'St Mary Parish');
  const get = api.handle({ method: 'GET', path: '/api/branding', token: a.token }).body;
  assert.equal(get.name, 'St Mary Parish');
  assert.equal(get.fontChoice, 'JetBrains Mono');
  assert.equal(get.displayCode, a.church.displayCode, 'the display code does not change with the name');
});

// ---- Logo: checked by its bytes, and size ----

test('a PNG and a plain SVG are accepted', () => {
  assert.deepEqual(checkLogo(PNG), { ok: true, type: 'image/png' });
  assert.deepEqual(checkLogo(SVG), { ok: true, type: 'image/svg+xml' });
});

test('a file with a PNG name but no PNG bytes is refused', () => {
  const fake = Buffer.from('this is a text file, not an image');
  assert.equal(checkLogo(fake).ok, false);
  assert.match(checkLogo(fake).error, /PNG or SVG/);
});

test('a logo over 500 KB is refused', () => {
  const big = Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)]);
  assert.match(checkLogo(big).error, /500 KB/);
  assert.equal(checkLogo(Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES - PNG.length)])).ok, true, 'exactly 500 KB is allowed');
});

test('an SVG with script, an event handler, or an outside link is refused', () => {
  assert.match(checkLogo(Buffer.from('<svg><script>alert(1)</script></svg>')).error, /script/);
  assert.match(checkLogo(Buffer.from('<svg onload="x()"><rect/></svg>')).error, /script/);
  assert.match(checkLogo(Buffer.from('<svg><image href="https://evil.example/x.png"/></svg>')).error, /links/);
});

test('the API refuses an invalid logo and stores nothing', () => {
  const { api, a } = twoChurches();
  const bad = api.handle({ method: 'PUT', path: '/api/logo', token: a.token, body: { bytes: Buffer.from('nope') } });
  assert.equal(bad.status, 400);
  assert.equal(api.handle({ method: 'GET', path: '/api/logo', token: a.token }).status, 404);
});

// ---- Licence tie ----

test('the app syncs only when the licence names the church this laptop is linked to', () => {
  assert.equal(checkLicenceChurch('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001').ok, true);
  const other = checkLicenceChurch('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001');
  assert.equal(other.ok, false);
  assert.match(other.message, /does not match its licence/);
  assert.equal(checkLicenceChurch('00000000-0000-4000-8000-000000000001', null).ok, false, 'an unlinked laptop does not sync');
});
