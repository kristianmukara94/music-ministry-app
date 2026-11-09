// Tests for the license window: how an expiry is read, judged and worded, and what it stops. Run with: node --test electron/license-manager.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLicenseManager, evaluateLicense, formatLicenseDate, isLicenseExpiry, parseLicenseExpiry, startsProjection } from './license-manager.js';

const EXPIRY = '2026-12-15T12:00:00.000Z';
const AT = Date.parse(EXPIRY);
const OFF = { projector: false, lowerThird: false, preview: false };

test('a null expiry is a perpetual license', () => {
  const status = evaluateLicense(null, AT);
  assert.equal(status.state, 'perpetual');
  assert.equal(status.canProject, true);
  assert.equal(status.statusText, '✓ License Status: Perpetual (Active)');
  assert.equal(status.banner, null);
});

test('a license is active until the moment before it expires', () => {
  const status = evaluateLicense(EXPIRY, AT - 1);
  assert.equal(status.state, 'active');
  assert.equal(status.canProject, true);
  assert.equal(status.statusText, '✓ License Status: Active (Expires 15 Dec 2026)');
  assert.equal(status.banner, null);
});

test('a license is expired from the exact moment of its expiry', () => {
  const status = evaluateLicense(EXPIRY, AT);
  assert.equal(status.state, 'expired');
  assert.equal(status.canProject, false);
});

test('an expired license says when, in the wording the operator sees', () => {
  const status = evaluateLicense('2026-11-01T08:00:00.000Z', AT);
  assert.equal(status.statusText, '⚠️ License Status: Expired on 01 Nov 2026');
  assert.equal(status.banner, 'License Expired on 01 Nov 2026. Please renew your church activation key.');
});

test('a laptop with no church linked has no status to show and can project', () => {
  const status = evaluateLicense(undefined, AT);
  assert.equal(status.state, 'unlinked');
  assert.equal(status.canProject, true);
  assert.equal(status.statusText, null);
});

test('the date is the UTC day, wherever the laptop is', () => {
  assert.equal(formatLicenseDate('2026-12-31T23:59:59.000Z'), '31 Dec 2026');
  assert.equal(formatLicenseDate('2027-01-01T00:00:00.000Z'), '01 Jan 2027');
});

test('only a real date is kept from the activation reply', () => {
  assert.equal(parseLicenseExpiry('2026-12-15T12:00:00Z'), EXPIRY);
  for (const value of [null, undefined, '', 'soon', 12345, {}]) assert.equal(parseLicenseExpiry(value), null, String(value));
});

test('turning on the projector or the lower third starts projection', () => {
  assert.equal(startsProjection({ type: 'output/set', output: 'projector', on: true }, OFF), true);
  assert.equal(startsProjection({ type: 'output/toggle', output: 'projector' }, OFF), true);
  assert.equal(startsProjection({ type: 'output/set', output: 'lowerThird', on: true }, OFF), true);
  assert.equal(startsProjection({ type: 'output/set', output: 'projector', on: 1 }, OFF), true, 'the reducer treats any truthy value as on');
});

test('turning an output off, the preview, and other actions do not start projection', () => {
  const on = { ...OFF, projector: true };
  assert.equal(startsProjection({ type: 'output/toggle', output: 'projector' }, on), false);
  assert.equal(startsProjection({ type: 'output/set', output: 'projector', on: false }, on), false);
  assert.equal(startsProjection({ type: 'output/set', output: 'projector', on: true }, on), false, 'already on');
  assert.equal(startsProjection({ type: 'output/toggle', output: 'preview' }, OFF), false);
  assert.equal(startsProjection({ type: 'projector/show', frame: {} }, OFF), false);
  assert.equal(startsProjection(null, OFF), false);
});

test('an expired license refuses only the start of projection', () => {
  const manager = createLicenseManager({ readExpiry: () => EXPIRY, now: () => AT });
  assert.equal(manager.refuses({ type: 'output/set', output: 'projector', on: true }, OFF), true);
  assert.equal(manager.refuses({ type: 'output/set', output: 'projector', on: false }, { ...OFF, projector: true }), false);
  assert.equal(manager.refuses({ type: 'queue/set', items: [] }, OFF), false, 'planning is not touched');
});

test('a license that runs out while the app is open is caught at the next start of projection', () => {
  let clock = AT - 1000;
  const manager = createLicenseManager({ readExpiry: () => EXPIRY, now: () => clock });
  const start = { type: 'output/toggle', output: 'projector' };
  assert.equal(manager.refuses(start, OFF), false);
  clock = AT;
  assert.equal(manager.refuses(start, OFF), true);
});

test('isExpired follows the saved expiry', () => {
  let expiry = EXPIRY;
  const manager = createLicenseManager({ readExpiry: () => expiry, now: () => AT });
  assert.equal(manager.isExpired(), true);
  expiry = null;
  assert.equal(manager.isExpired(), false);
  expiry = undefined;
  assert.equal(manager.isExpired(), false, 'a laptop with no link is not expired');
});

test('reevaluate reports a change once, and stays quiet when nothing changed', () => {
  let expiry = EXPIRY;
  const seen = [];
  const manager = createLicenseManager({ readExpiry: () => expiry, now: () => AT, onChange: (status) => seen.push(status.state) });
  manager.reevaluate();
  manager.reevaluate();
  assert.deepEqual(seen, ['expired']);
  expiry = '2030-01-01T00:00:00.000Z';
  assert.equal(manager.reevaluate().state, 'active');
  expiry = '2031-01-01T00:00:00.000Z';
  manager.reevaluate();
  assert.deepEqual(seen, ['expired', 'active', 'active'], 'a new date in the same state is still a change');
});

test('only null or a real date may replace a saved expiry', () => {
  assert.equal(isLicenseExpiry(null), true);
  assert.equal(isLicenseExpiry(EXPIRY), true);
  for (const value of [undefined, '', 'soon', 5, {}]) assert.equal(isLicenseExpiry(value), false, String(value));
});

test('the expiry is read only when projection would start', () => {
  let reads = 0;
  const manager = createLicenseManager({ readExpiry: () => { reads += 1; return EXPIRY; } });
  manager.refuses({ type: 'projector/next' }, OFF);
  assert.equal(reads, 0, 'slide changes during a service never touch the disk');
});
