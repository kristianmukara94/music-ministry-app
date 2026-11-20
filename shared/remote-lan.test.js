// The Remote Control drawer's two LAN rows: Phone / Stage Mirror IP and, under it, TV IP. Both must show the whole address (no truncate /
// ellipsis) and the TV row must copy the Secondary viewer's /tv address. The repo has no DOM test environment, so the layout checks read the
// component's source, like the other UI suites here. RFC 5737 documentation addresses only.
// Run with: node --test shared/remote-lan.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LAN_KEYS, LAN_LANGS, lanAddresses, lanT, tvUrlFrom } from './remote-lan.js';

const DRAWER = readFileSync(fileURLToPath(new URL('../src/remote/RemoteDrawer.tsx', import.meta.url)), 'utf8')
  .split(String.fromCharCode(13))
  .join('');

const viewer = (url, running = true) => ({ running, url });
const status = (primary, secondary) => ({ primary, secondary });

test('every label is translated in English, Tagalog and Cebuano', () => {
  assert.deepEqual(LAN_LANGS.sort(), ['ceb', 'en', 'tl']);
  for (const lang of LAN_LANGS) {
    for (const key of LAN_KEYS) assert.ok(lanT(lang, key).trim(), `${lang}.${key}`);
  }
  assert.equal(lanT('en', 'phoneLabel'), 'Phone / Stage Mirror IP');
  assert.match(lanT('en', 'tvLabel'), /^TV IP/);
  assert.equal(lanT('en', 'copy'), 'Copy');
  assert.equal(lanT('en', 'copied'), 'Copied');
  assert.notEqual(lanT('tl', 'copy'), lanT('en', 'copy'));
  assert.notEqual(lanT('ceb', 'copy'), lanT('en', 'copy'));
  assert.equal(lanT('xx', 'phoneLabel'), 'Phone / Stage Mirror IP', 'unknown language falls back to English');
});

test('the TV address is the Secondary address with /tv, keeping every octet and the port', () => {
  assert.equal(tvUrlFrom('http://192.0.2.10:8091'), 'http://192.0.2.10:8091/tv');
  assert.equal(tvUrlFrom('http://198.51.100.25:65535/'), 'http://198.51.100.25:65535/tv');
  assert.equal(tvUrlFrom(null), null);
  assert.equal(tvUrlFrom('not a url'), null);
});

test('the phone row follows the open viewer tab; the TV row always uses the Secondary viewer', () => {
  const s = status(viewer('http://192.0.2.10:8090'), viewer('http://192.0.2.10:8091'));
  assert.deepEqual(lanAddresses(s, 'primary'), { phone: 'http://192.0.2.10:8090', tv: 'http://192.0.2.10:8091/tv' });
  assert.deepEqual(lanAddresses(s, 'secondary'), { phone: 'http://192.0.2.10:8091', tv: 'http://192.0.2.10:8091/tv' });
});

test('a change of network adapter moves both rows together', () => {
  const wifi = status(viewer('http://192.0.2.10:8090'), viewer('http://192.0.2.10:8091'));
  const cable = status(viewer('http://198.51.100.25:8090'), viewer('http://198.51.100.25:8091'));
  assert.deepEqual(lanAddresses(wifi, 'primary'), { phone: 'http://192.0.2.10:8090', tv: 'http://192.0.2.10:8091/tv' });
  assert.deepEqual(lanAddresses(cable, 'primary'), { phone: 'http://198.51.100.25:8090', tv: 'http://198.51.100.25:8091/tv' });
});

test('a viewer that is off has no row address', () => {
  const s = status(viewer('http://192.0.2.10:8090'), viewer(null, false));
  assert.deepEqual(lanAddresses(s, 'primary'), { phone: 'http://192.0.2.10:8090', tv: null });
  assert.deepEqual(lanAddresses(status(viewer(null, false), viewer('http://192.0.2.10:8091')), 'primary'), {
    phone: null,
    tv: 'http://192.0.2.10:8091/tv',
  });
  assert.deepEqual(lanAddresses(null, 'primary'), { phone: null, tv: null });
});

/** The source of the AddressRow component. */
const ROW = DRAWER.slice(DRAWER.indexOf('function AddressRow'), DRAWER.indexOf('export function RemoteQrPanel'));

test('the address box shows the whole address: no truncate or ellipsis, wraps anywhere, selectable, tabular digits', () => {
  assert.ok(ROW.length > 0, 'AddressRow exists');
  const code = ROW.slice(ROW.indexOf('<code'), ROW.indexOf('</code>'));
  for (const cls of ['break-all', 'select-all', 'tabular-nums', 'font-mono', 'min-w-0', 'flex-1']) assert.match(code, new RegExp(`\\b${cls}\\b`), cls);
  for (const clip of ['truncate', 'text-ellipsis', 'overflow-hidden', 'whitespace-nowrap', 'line-clamp']) assert.doesNotMatch(code, new RegExp(clip), clip);
  assert.match(code, /\{value\}/, 'the full value is rendered, not a shortened copy');
});

test('the Copy button never shrinks and copies the exact row address', () => {
  assert.match(DRAWER, /const button =\s*\n?\s*'[^']*\bshrink-0\b/);
  assert.match(ROW, /className=\{`\$\{button\}/);
  assert.match(ROW, /writeText\(value\)/);
  assert.match(ROW, /lanT\(lang, copied \? 'copied' : 'copy'\)/);
});

test('the TV IP row sits directly below the Phone / Stage Mirror IP row and is given the TV address', () => {
  const panel = DRAWER.slice(DRAWER.indexOf('export function RemoteQrPanel'));
  const phone = panel.indexOf('id="remote-phone-ip"');
  const tv = panel.indexOf('id="remote-tv-ip"');
  assert.ok(phone > 0 && tv > phone, 'phone row comes first, TV row after it');
  const between = panel.slice(phone, tv);
  assert.equal((between.match(/<AddressRow/g) ?? []).length, 1, 'nothing but the TV row follows the phone row');
  assert.match(panel.slice(tv, tv + 300), /value=\{tvUrl\}/);
  assert.match(panel, /lanAddresses\(status, role\)/);
  assert.doesNotMatch(panel, /truncate rounded-md[^"]*font-mono/, 'the old truncated address box is gone');
});
