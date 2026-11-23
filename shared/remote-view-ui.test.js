// Tests for the Remote view settings rules. Run with: node --test shared/remote-view-ui.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterLabel, allClients, clientRole, generatePin, lanVerdict, portProblem, qrTargetBadge, remotePillLabel } from './remote-view-ui.js';

const role = (running) => ({ running });

test('the top bar pill is ON when either viewer listens and OFF only when both are off', () => {
  assert.deepEqual(remotePillLabel({ primary: role(false), secondary: role(false), devices: 0 }), { on: false, devices: 0, text: 'Remote · OFF' });
  assert.equal(remotePillLabel({ primary: role(true), secondary: role(false), devices: 0 }).text, 'Remote · ON');
  assert.equal(remotePillLabel({ primary: role(false), secondary: role(true), devices: 3 }).text, 'Remote · ON · 3');
  assert.equal(remotePillLabel({ primary: role(true), secondary: role(true), devices: 1 }).text, 'Remote · ON · 1');
  assert.equal(remotePillLabel(null).text, 'Remote · OFF');
  // Devices left over from a viewer that just stopped are not shown.
  assert.equal(remotePillLabel({ primary: role(false), secondary: role(false), devices: 4 }).text, 'Remote · OFF');
});

test('the same port cannot be saved on both viewers', () => {
  assert.match(portProblem('8788', 8788, 'Secondary'), /already used by the Secondary viewer/);
  assert.equal(portProblem('9000', 8788, 'Secondary'), null);
  assert.match(portProblem('80', 8788, 'Secondary'), /1024 to 65535/);
  assert.match(portProblem('70000', 8788, 'Secondary'), /1024 to 65535/);
  assert.match(portProblem('', 8788, 'Secondary'), /1024 to 65535/);
  assert.match(portProblem('12.5', 8788, 'Secondary'), /1024 to 65535/);
  assert.equal(portProblem('1024', 8788, 'Secondary'), null);
  assert.equal(portProblem('65535', 8788, 'Secondary'), null);
});

test('Generate PIN makes a 4-digit PIN, padded with zeros', () => {
  assert.equal(generatePin(() => 7), '0007');
  assert.equal(generatePin(() => 9999), '9999');
  assert.equal(generatePin((max) => max - 1), '9999');
  for (let i = 0; i < 200; i += 1) assert.match(generatePin((max) => Math.floor(Math.random() * max)), /^\d{4}$/);
});

test('the QR badge says what scanning opens', () => {
  assert.equal(qrTargetBadge('primary', true), 'Opens Primary Controller');
  assert.equal(qrTargetBadge('primary', false), 'Opens Primary Controller');
  assert.equal(qrTargetBadge('secondary', true), 'Opens Smart TV (16:9)');
  assert.equal(qrTargetBadge('secondary', false), 'Opens Phone Mirror');
});

test('connected devices from both viewers are listed oldest first with their role', () => {
  const status = {
    primary: { clients: [{ ip: '192.168.1.5', label: 'Sample Phone', userAgent: '', since: 200, tabs: 1 }] },
    secondary: {
      clients: [
        { ip: '192.168.1.9', label: 'Smart TV', userAgent: '', since: 100, tabs: 1, tv: true },
        { ip: '192.168.1.7', label: 'Sample Tablet', userAgent: '', since: 300, tabs: 2 },
      ],
    },
  };
  const rows = allClients(status);
  assert.deepEqual(
    rows.map((r) => [r.ip, r.roleLabel, r.viewer]),
    [
      ['192.168.1.9', 'Smart TV', 'secondary'],
      ['192.168.1.5', 'Primary', 'primary'],
      ['192.168.1.7', 'Secondary', 'secondary'],
    ],
  );
  assert.deepEqual(allClients({}), []);
  assert.equal(clientRole('primary', { tv: false }), 'Primary');
});

test('the adapter label names the adapter, its address and its kind', () => {
  assert.equal(adapterLabel({ name: 'Sample Wi-Fi', address: '192.168.1.20', kind: 'wifi' }), 'Sample Wi-Fi · 192.168.1.20 (Wi-Fi)');
  assert.match(adapterLabel({ name: 'Sample Switch', address: '172.20.0.1', kind: 'virtual' }), /Virtual/);
});

test('Check LAN and Firewall explains each outcome', () => {
  const viewer = (extra = {}) => ({ name: 'Primary', port: 9001, listening: true, devices: 0, ...extra });
  assert.equal(lanVerdict({ ip: null, viewers: [], firewall: null }).level, 'bad');
  assert.equal(lanVerdict({ ip: '192.168.1.20', viewers: [], firewall: null }).level, 'warn');
  const down = lanVerdict({ ip: '192.168.1.20', viewers: [viewer({ listening: false })], firewall: null });
  assert.equal(down.level, 'bad');
  assert.match(down.text, /Primary \(:9001\) did not answer/);
  assert.match(lanVerdict({ ip: '192.168.1.20', viewers: [viewer({ devices: 2 })], firewall: { profile: 'Public', enabled: true } }).text, /Reachable/);
  const blocked = lanVerdict({ ip: '192.168.1.20', viewers: [viewer()], firewall: { profile: 'Public', enabled: true } });
  assert.equal(blocked.level, 'warn');
  assert.match(blocked.text, /Windows Firewall is on \(Public profile\)/);
  assert.equal(lanVerdict({ ip: '192.168.1.20', viewers: [viewer()], firewall: { profile: 'Private', enabled: false } }).level, 'ok');
  assert.equal(lanVerdict({ ip: '192.168.1.20', viewers: [viewer()], firewall: null }).level, 'ok');
});

// The TopBar Remote pill is a pure output switch, like the Projector pill: it toggles the Remote output and never opens the QR drawer.
test('clicking the TopBar Remote pill toggles the Remote output and does not open the QR drawer', async () => {
  const { readFileSync } = await import('node:fs');
  const topBar = readFileSync(new URL('../src/operator/TopBar.tsx', import.meta.url), 'utf8');
  const start = topBar.indexOf('function RemoteMaster()');
  const body = topBar.slice(start, topBar.indexOf('/** A thin vertical rule', start));
  assert.match(body, /role="switch"/, 'it is a switch, as the Projector pill is');
  assert.match(body, /type: 'display\/live', value: next/, 'it flips the Secondary display live switch');
  assert.match(body, /bridge\.remoteView\.save\(\{ role, enabled: next \}\)/, 'it turns both viewers on or off');
  assert.doesNotMatch(body, /remoteOpen/, 'it no longer opens the QR drawer (the REMOTE edge tab does)');
  assert.doesNotMatch(body, /aria-expanded/);
});
