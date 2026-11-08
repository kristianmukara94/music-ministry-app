// The display-matrix native addon against this PC's real hardware. Skipped off Windows, and when the addon is not built
// (node tools/build-native.mjs builds it).
// Run with: env -u ELECTRON_RUN_AS_NODE node --test electron/display-matrix.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDisplayMatrix, normalizeTopology, parseEdid } from './edid-watchdog.js';

const addon = loadDisplayMatrix({ log: { warn() {} } });
const skip = addon ? false : 'the display-matrix addon is not built on this machine';

test('the addon reports every active display path with its GPU output and monitor', { skip }, () => {
  const topology = addon.getHardwareDisplayTopology();
  assert.ok(Array.isArray(topology.monitors));
  assert.ok(topology.monitors.length >= 1, 'a PC running the tests has a screen');
  for (const m of topology.monitors) {
    assert.match(m.gdiDeviceName, /^\\\\\.\\DISPLAY\d+$/);
    assert.match(m.adapterLuid, /^[0-9a-f]{8}:[0-9a-f]{8}$/);
    assert.ok(m.adapterDevicePath.startsWith('\\\\?\\'), 'an adapter device path, the stable half of the port key');
    assert.equal(typeof m.targetId, 'number');
    assert.equal(typeof m.outputTechnology, 'number');
    assert.ok(m.physicalBounds && Number.isInteger(m.physicalBounds.width) && m.physicalBounds.width > 0);
  }
  assert.ok(topology.adapters.some((a) => a.name), 'DXGI names the graphics adapters');
});

test('the monitors\' EDID blocks are read and parse', { skip }, () => {
  const { monitors } = addon.getHardwareDisplayTopology();
  const withEdid = monitors.filter((m) => m.edid);
  assert.ok(withEdid.length >= 1, 'at least one monitor has an EDID');
  for (const m of withEdid) {
    assert.ok(Buffer.isBuffer(m.edid));
    assert.equal(m.edid.length % 128, 0);
    const e = parseEdid(m.edid);
    assert.ok(e, 'a valid EDID header');
    assert.match(e.manufacturer, /^[A-Z]{3}$/);
    assert.equal(e.checksumValid, true);
  }
});

test('the fingerprints are the same on every read', { skip }, () => {
  const a = normalizeTopology(addon.getHardwareDisplayTopology()).map((m) => m.fingerprint).sort();
  const b = normalizeTopology(addon.getHardwareDisplayTopology()).map((m) => m.fingerprint).sort();
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, 'every connected monitor has its own fingerprint');
});

test('a read is quick enough to run inside a display event', { skip }, () => {
  addon.getHardwareDisplayTopology();
  const started = performance.now();
  for (let i = 0; i < 10; i += 1) addon.getHardwareDisplayTopology();
  const avg = (performance.now() - started) / 10;
  assert.ok(avg < 50, `average ${avg.toFixed(1)} ms`);
});
