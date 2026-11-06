// The dashboard's System Health readout: CPU from two samples, memory, the crash-recovery write timing and the newest snapshot. Run with:
// node --test electron/system-health.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appUsage, cpuPercent, cpuTimes, createHealthReader, createWriteMeter, latestBackup } from './system-health.js';

const core = (busy, idle) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

test('CPU is the busy share between two samples, across every core', () => {
  const a = cpuTimes([core(100, 900), core(100, 900)]);
  const b = cpuTimes([core(400, 1600), core(100, 1900)]);
  // 300 + 0 busy, 700 + 1000 idle out of 2000 total: 15%.
  assert.equal(cpuPercent(a, b), 15);
  assert.equal(cpuPercent(null, b), null, 'no first sample yet');
  assert.equal(cpuPercent(b, b), null, 'no time has passed');
});

test('the write meter records how long each write took, and keeps a failure without hiding it', () => {
  let t = 0;
  const meter = createWriteMeter(() => t, () => 5000);
  meter.time(() => {
    t += 0.234;
  });
  assert.deepEqual(meter.status(), { lastWriteMs: 0.23, lastWriteAt: 5000, writes: 1, error: null });
  assert.throws(() => meter.time(() => { throw new Error('disk full'); }), /disk full/);
  assert.equal(meter.status().error, 'disk full');
  assert.equal(meter.status().writes, 1, 'a failed write is not counted');
  meter.time(() => undefined);
  assert.equal(meter.status().error, null, 'the next good write clears it');
});

test('the newest snapshot comes first from listBackups', () => {
  assert.equal(latestBackup([]), null);
  assert.deepEqual(latestBackup([{ name: 'apccmma-backup-2026-11-07.sqlite.bak', mtimeMs: 1700.6, preMigration: false }, { name: 'old', mtimeMs: 1 }]), {
    name: 'apccmma-backup-2026-11-07.sqlite.bak',
    at: 1701,
    preMigration: false,
  });
});

test('the app\'s own share sums its processes; working set is in kilobytes', () => {
  assert.deepEqual(appUsage([{ cpu: { percentCPUUsage: 1.25 }, memory: { workingSetSize: 1000 } }, { cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 24 } }]), {
    cpuPercent: 3.3,
    memoryBytes: 1024 * 1024,
  });
});

test('the reader puts it together, and a missing snapshot folder or metrics never throw', () => {
  let n = 0;
  const read = createHealthReader({
    cpus: () => [core(100 + n * 50, 900 + n * 50)],
    totalmem: () => 8e9,
    freemem: () => 2e9,
    appMetrics: () => { throw new Error('no electron'); },
    address: () => '192.168.1.20',
    backups: () => { throw new Error('ENOENT'); },
    session: () => ({ journalMode: 'wal', lastWriteMs: 0.2 }),
    now: () => 42,
  });
  const first = read();
  assert.equal(first.cpuPercent, null);
  n = 1;
  const second = read();
  assert.equal(second.cpuPercent, 50);
  assert.deepEqual(second.memory, { totalBytes: 8e9, usedBytes: 6e9 });
  assert.equal(second.address, '192.168.1.20');
  assert.equal(second.latestBackup, null);
  assert.deepEqual(second.app, { cpuPercent: 0, memoryBytes: 0 });
  assert.equal(second.session.journalMode, 'wal');
});

test('main.js times the crash-recovery writes and answers system:health; the preload exposes it', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /save: \(row\) => sessionWrites\.time\(\(\) => sessionStore\?\.save\(row\)\)/);
  assert.match(main, /ipcMain\.handle\('system:health'/);
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /health: \(\) => ipcRenderer\.invoke\('system:health'\)/);
});
