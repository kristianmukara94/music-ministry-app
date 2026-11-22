// Tests for the Remote view network adapter choice, Smart TV detection and bulk disconnect.
// Run with: node --test electron/remote-view-adapters.test.mjs. Node built-ins only; the server runs on 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { adapterKind, createRemoteViewServer, deviceLabel, isSmartTvAgent, listAdapters, pickLocalAddress } from './remote-view-server.js';

const entries = [
  { name: 'vEthernet (Sample Switch)', family: 'IPv4', internal: false, address: '192.168.56.1' },
  { name: 'Sample VPN virtual', family: 'IPv4', internal: false, address: '10.8.0.2' },
  { name: 'Ethernet', family: 'IPv4', internal: false, address: '192.168.1.30' },
  { name: 'Wi-Fi', family: 'IPv4', internal: false, address: '10.0.0.15' },
  { name: 'Loopback', family: 'IPv4', internal: true, address: '127.0.0.1' },
  { name: 'Wi-Fi', family: 'IPv6', internal: false, address: 'fe80::2' },
  { name: 'Public Test', family: 'IPv4', internal: false, address: '8.8.4.4' },
];

test('adapters are classified and listed Wi-Fi first, virtual last, without public or loopback addresses', () => {
  assert.equal(adapterKind('Wi-Fi'), 'wifi');
  assert.equal(adapterKind('wlan0'), 'wifi');
  assert.equal(adapterKind('Ethernet'), 'wired');
  assert.equal(adapterKind('vEthernet (Sample Switch)'), 'virtual');
  assert.equal(adapterKind('Sample Adapter'), 'other');
  const list = listAdapters(entries);
  assert.deepEqual(
    list.map((a) => a.name),
    ['Wi-Fi', 'Ethernet', 'vEthernet (Sample Switch)', 'Sample VPN virtual'],
  );
  assert.ok(list.every((a) => a.address !== '127.0.0.1' && a.address !== '8.8.4.4'));
});

test('automatic pick prefers Wi-Fi over cable and virtual adapters, even when the cable has a 192.168 address', () => {
  assert.equal(pickLocalAddress(entries), '10.0.0.15');
  assert.equal(pickLocalAddress(entries.filter((e) => e.name !== 'Wi-Fi')), '192.168.1.30');
  assert.equal(pickLocalAddress(entries.filter((e) => /virtual|vEthernet/i.test(e.name))), null);
});

test('a chosen adapter wins, so the viewer, TV and QR addresses follow it; a missing adapter falls back to automatic', () => {
  assert.equal(pickLocalAddress(entries, 'Ethernet'), '192.168.1.30');
  assert.equal(pickLocalAddress(entries, 'vEthernet (Sample Switch)'), '192.168.56.1');
  assert.equal(pickLocalAddress(entries, 'Unplugged'), '10.0.0.15');
  // The TV address is the Secondary address with /tv on the end, so it changes with the adapter in the same way.
  const url = (name) => `http://${pickLocalAddress(entries, name)}:9002`;
  assert.equal(new URL('/tv', url('Ethernet')).toString(), 'http://192.168.1.30:9002/tv');
  assert.equal(new URL('/tv', url('Wi-Fi')).toString(), 'http://10.0.0.15:9002/tv');
});

test('Smart TV browsers are recognised', () => {
  assert.equal(isSmartTvAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0)'), true);
  assert.equal(isSmartTvAgent('Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS)'), true);
  assert.equal(isSmartTvAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), false);
  assert.equal(deviceLabel('Mozilla/5.0 (Web0S; Linux/SmartTV)'), 'Smart TV');
});

test('a viewer drops all its devices at once, and says how many addresses it dropped', async () => {
  const viewer = createRemoteViewServer({ distDir: os.tmpdir(), role: 'secondary' });
  const started = await viewer.start({ host: '127.0.0.1', port: 0, pin: null });
  assert.equal(started.ok, true);
  const open = (userAgent) =>
    new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: viewer.port(), path: '/api/remote/stream', headers: { 'user-agent': userAgent } }, (res) => {
        // The headers go out as soon as the page is registered, even before any slide data is sent.
        res.resume();
        resolve(req);
      });
      req.on('error', () => undefined);
    });
  const first = await open('Sample Browser A');
  const second = await open('Mozilla/5.0 (SMART-TV; Tizen 6.0)');
  assert.equal(viewer.devices(), 1, 'both pages come from one address');
  assert.equal(viewer.clients()[0].tabs, 2);
  assert.equal(viewer.clients()[0].tv, true);
  assert.equal(viewer.disconnectAll(), 1);
  assert.equal(viewer.devices(), 0);
  assert.equal(viewer.disconnectAll(), 0);
  first.destroy();
  second.destroy();
  await viewer.stop();
});
