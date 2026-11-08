// Tests the sanctuary hardware lock: SMBIOS parsing gives the values Windows' WMI shows, the fingerprint is an HMAC keyed with the church
// code and never carries a raw id, one replaced part does not lock while another PC does, the license is tamper-evident, and the start-up
// guard activates, verifies, and locks a copied userData folder with the dialog and exit code 1 — in the packaged app on Windows only.
// Run with: node --test electron/hardware-id.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register } from 'node:module';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const hw = await import('./hardware-id.js');
const {
  COMPONENTS,
  LICENSE_FILE,
  LOCKDOWN_TITLE,
  PARISH_CHURCH_CODE,
  compareFingerprints,
  computeFingerprint,
  decodeLicense,
  encodeLicense,
  enforceHardwareLock,
  formatProcessorId,
  formatSmbiosUuid,
  parseSmbios,
  readHardwareIdentity,
  readHardwareViaPowerShell,
  tpmFromDeviceName,
  tpmFromNative,
} = hw;

// ---- A synthetic SMBIOS table, laid out as GetSystemFirmwareTable('RSMB') returns it. ----

/** One SMBIOS structure: formatted area of `len` bytes (with `fill(body)` writing into it), then its strings and the double zero. */
function structure(type, len, fill = () => {}, strings = []) {
  const body = Buffer.alloc(len);
  body[0] = type;
  body[1] = len;
  fill(body);
  const tail = strings.length ? Buffer.concat([...strings.map((s) => Buffer.from(`${s}\0`)), Buffer.from([0])]) : Buffer.from([0, 0]);
  return Buffer.concat([body, tail]);
}
function rsmb(structures, { major = 3, minor = 4 } = {}) {
  const data = Buffer.concat([...structures, structure(127, 4)]);
  const header = Buffer.alloc(8);
  header[1] = major;
  header[2] = minor;
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}
// The bytes SMBIOS 2.6+ stores for the UUID WMI shows as 8D3942F5-BADE-F242-B6B9-7320D776419D (first three fields little-endian).
const UUID_BYTES = Buffer.from('F542398DDEBA42F2B6B97320D776419D', 'hex');
const UUID_TEXT = '8D3942F5-BADE-F242-B6B9-7320D776419D';
// The bytes for the processor id WMI shows as 178BFBFF00A40F41: EAX (signature) then EDX (features), each little-endian.
const CPU_BYTES = Buffer.from('410FA400FFFB8B17', 'hex');
const CPU_TEXT = '178BFBFF00A40F41';

const system = (uuid = UUID_BYTES) => structure(1, 0x1b, (b) => uuid.copy(b, 0x08), ['Maker', 'Model']);
const processor = (id = CPU_BYTES, populated = true) =>
  structure(4, 0x2a, (b) => {
    id.copy(b, 0x08);
    b[0x18] = populated ? 0x41 : 0x00;
  }, ['CPU0', 'AMD']);
const bios = () => structure(0, 0x18, () => {}, ['Vendor', '1.2.3', '01/01/2026']);

// ---- SMBIOS parsing ----

test('the board UUID and processor id come out exactly as WMI shows them', () => {
  const parsed = parseSmbios(rsmb([bios(), system(), processor()]));
  assert.deepEqual(parsed, { board: UUID_TEXT, cpu: CPU_TEXT });
});

test('before SMBIOS 2.6 the UUID is read in plain byte order', () => {
  assert.equal(formatSmbiosUuid(UUID_BYTES, 2, 5), 'F542398D-DEBA-42F2-B6B9-7320D776419D');
  assert.equal(formatSmbiosUuid(UUID_BYTES, 2, 6), UUID_TEXT);
});

test('a UUID the firmware marks as missing or unset is no UUID', () => {
  assert.equal(formatSmbiosUuid(Buffer.alloc(16, 0xff)), null);
  assert.equal(formatSmbiosUuid(Buffer.alloc(16, 0x00)), null);
  assert.equal(parseSmbios(rsmb([system(Buffer.alloc(16, 0xff)), processor()])).board, null);
});

test('the first populated processor socket wins over an empty one listed first', () => {
  const empty = Buffer.from('1111111111111111', 'hex');
  assert.equal(parseSmbios(rsmb([processor(empty, false), processor(CPU_BYTES, true)])).cpu, CPU_TEXT);
  // With no socket marked populated, the first id is used.
  assert.equal(parseSmbios(rsmb([processor(CPU_BYTES, false)])).cpu, CPU_TEXT);
  assert.equal(formatProcessorId(Buffer.alloc(8)), null);
});

test('a truncated, garbled or missing table gives nulls instead of throwing', () => {
  const full = rsmb([system(), processor()]);
  for (const raw of [null, Buffer.alloc(0), Buffer.alloc(5), full.subarray(0, 20), Buffer.concat([full.subarray(0, 8), Buffer.from([1, 2, 0, 0])])]) {
    const out = parseSmbios(raw);
    assert.ok(out && 'board' in out && 'cpu' in out);
  }
  assert.deepEqual(parseSmbios(full.subarray(0, 20)), { board: null, cpu: null });
});

test('the TPM fact: native status and the device-name fallback agree', () => {
  assert.equal(tpmFromNative({ status: 'present', version: 2 }), 'tpm2.0');
  assert.equal(tpmFromNative({ status: 'present', version: 1 }), 'tpm1.2');
  assert.equal(tpmFromNative({ status: 'absent', version: 0 }), 'none');
  assert.equal(tpmFromNative({ status: 'error', version: 0 }), null);
  assert.equal(tpmFromDeviceName('Trusted Platform Module 2.0'), 'tpm2.0');
  assert.equal(tpmFromDeviceName('Trusted Platform Module 1.2'), 'tpm1.2');
  assert.equal(tpmFromDeviceName(null), 'none');
});

test('the addon is used when present; PowerShell only without it', () => {
  const native = { getHardwareIdentity: () => ({ smbios: rsmb([system(), processor()]), tpm: { status: 'present', version: 2 } }) };
  let fellBack = false;
  const fallback = () => {
    fellBack = true;
    return { board: null, cpu: null, tpm: null, source: 'powershell' };
  };
  assert.deepEqual(readHardwareIdentity({ native, fallback }), { board: UUID_TEXT, cpu: CPU_TEXT, tpm: 'tpm2.0', source: 'native' });
  assert.equal(fellBack, false);
  readHardwareIdentity({ native: null, fallback });
  assert.equal(fellBack, true);
});

test('the PowerShell fallback cleans its values the way the native read does', () => {
  const run = (stdout, status = 0) => () => ({ status, stdout });
  const out = readHardwareViaPowerShell({ run: run(JSON.stringify({ board: UUID_TEXT.toLowerCase(), cpu: CPU_TEXT, tpm: 'Trusted Platform Module 2.0', tpmFound: true })) });
  assert.deepEqual(out, { board: UUID_TEXT, cpu: CPU_TEXT, tpm: 'tpm2.0', source: 'powershell' });
  const junk = readHardwareViaPowerShell({ run: run(JSON.stringify({ board: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', cpu: '', tpm: null, tpmFound: false })) });
  assert.deepEqual(junk, { board: null, cpu: null, tpm: 'none', source: 'powershell' });
  assert.deepEqual(readHardwareViaPowerShell({ run: run('', 1) }), { board: null, cpu: null, tpm: null, source: 'powershell' });
  assert.equal(readHardwareViaPowerShell({ run: () => { throw new Error('no powershell'); } }).board, null);
});

// ---- Fingerprint ----

const PC_A = { board: UUID_TEXT, cpu: CPU_TEXT, tpm: 'tpm2.0' };
const PC_B = { board: '11111111-2222-3333-4444-555555555555', cpu: CPU_TEXT, tpm: 'tpm2.0' }; // same laptop model, other unit

test('the fingerprint is an HMAC-SHA256 keyed with the church code, and carries no raw id', () => {
  const fp = computeFingerprint(PC_A);
  assert.match(fp.fingerprint, /^[0-9a-f]{64}$/);
  for (const name of COMPONENTS) assert.match(fp.components[name], /^[0-9a-f]{64}$/);
  assert.deepEqual(computeFingerprint(PC_A), fp, 'deterministic');
  assert.notEqual(computeFingerprint(PC_A, { churchCode: 'OTHER-CODE' }).fingerprint, fp.fingerprint, 'keyed');
  assert.notEqual(computeFingerprint(PC_B).fingerprint, fp.fingerprint);
  const text = JSON.stringify(fp).toUpperCase();
  assert.ok(!text.includes(UUID_TEXT.replace(/-/g, '')) && !text.includes(UUID_TEXT) && !text.includes(CPU_TEXT));
  assert.equal(PARISH_CHURCH_CODE, 'PTGS-X2D9');
});

test('a fact that cannot be read has no digest', () => {
  assert.equal(computeFingerprint({ ...PC_A, tpm: null }).components.tpm, null);
});

test('another PC never matches; one replaced part on the same board does', () => {
  const a = computeFingerprint(PC_A);
  assert.deepEqual(compareFingerprints(a, computeFingerprint(PC_A)), { match: true, changed: [] });
  // Same model, other unit: only the board UUID differs, and it is the one fact that must match.
  assert.deepEqual(compareFingerprints(a, computeFingerprint(PC_B)), { match: false, changed: ['board'] });
  // A CPU upgrade on the same motherboard, or a TPM switched off in the firmware: still this PC.
  assert.equal(compareFingerprints(a, computeFingerprint({ ...PC_A, cpu: 'BFEBFBFF000906EA' })).match, true);
  assert.equal(compareFingerprints(a, computeFingerprint({ ...PC_A, tpm: 'none' })).match, true);
  // Both the CPU and the TPM changed: only one of three facts left, so it locks.
  assert.equal(compareFingerprints(a, computeFingerprint({ ...PC_A, cpu: 'BFEBFBFF000906EA', tpm: 'none' })).match, false);
  // A fact unreadable now counts neither way.
  assert.equal(compareFingerprints(a, computeFingerprint({ ...PC_A, tpm: null })).match, true);
  assert.equal(compareFingerprints(null, a).match, false);
});

// ---- License file ----

test('the license round-trips, and a changed, foreign or garbage license reads as none', () => {
  const fp = computeFingerprint(PC_A);
  const text = encodeLicense(fp, { now: new Date('2026-11-08T00:00:00Z'), appVersion: '1.0.48' });
  assert.match(text, /^APCCMMA-LIC1:[A-Za-z0-9_-]+$/);
  const back = decodeLicense(text);
  assert.equal(back.fingerprint, fp.fingerprint);
  assert.deepEqual(back.components, fp.components);
  assert.equal(back.activatedAt, '2026-11-08T00:00:00.000Z');
  // The license is encrypted: no digest is readable in the file.
  assert.ok(!text.includes(fp.fingerprint));

  const raw = Buffer.from(text.slice('APCCMMA-LIC1:'.length), 'base64url');
  raw[raw.length - 1] ^= 1;
  assert.equal(decodeLicense(`APCCMMA-LIC1:${raw.toString('base64url')}`), null, 'one flipped bit');
  assert.equal(decodeLicense(text, { churchCode: 'OTHER-CODE' }), null, 'another church code');
  for (const junk of ['', 'hello', 'APCCMMA-LIC1:', 'APCCMMA-LIC1:!!!!', null]) assert.equal(decodeLicense(junk), null);
});

// ---- The start-up guard ----

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-hw-'));
}
function packagedApp({ isPackaged = true } = {}) {
  return { isPackaged, getPath: () => { throw new Error('userData is passed in'); }, getVersion: () => '1.0.48', exit() {} };
}
/** Runs the guard against fake hardware and records what it showed, logged and exited with. */
function guard(userData, identity, options = {}) {
  const shown = [];
  const exits = [];
  const logs = [];
  const result = enforceHardwareLock({
    electronApp: packagedApp(options),
    platform: 'win32',
    userData,
    readIdentity: () => ({ ...identity, source: 'native' }),
    showLockdown: (title, message) => shown.push({ title, message }),
    exit: (code) => exits.push(code),
    log: (event, details) => logs.push({ event, ...details }),
    ...options,
  });
  return { result, shown, exits, logs };
}

test('the first packaged start activates this PC; later starts verify it', () => {
  const dir = tempUserData();
  const first = guard(dir, PC_A);
  assert.equal(first.result.status, 'activated');
  assert.deepEqual(first.exits, []);
  assert.equal(first.logs[0].event, 'hardware-activated');
  const text = fs.readFileSync(path.join(dir, LICENSE_FILE), 'utf8');
  assert.ok(!text.toUpperCase().includes(UUID_TEXT) && !text.includes(CPU_TEXT), 'no raw id on disk');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temporary file left');

  const second = guard(dir, PC_A);
  assert.equal(second.result.status, 'verified');
  assert.deepEqual([second.shown, second.exits, second.logs], [[], [], []]);
});

test('a userData folder copied to another PC shows the lockdown and exits with code 1 in under 10 ms', () => {
  const dir = tempUserData();
  guard(dir, PC_A);
  const copied = guard(dir, PC_B);
  assert.equal(copied.result.status, 'locked');
  assert.deepEqual(copied.exits, [1]);
  assert.equal(copied.shown.length, 1);
  assert.equal(copied.shown[0].title, LOCKDOWN_TITLE);
  assert.equal(copied.shown[0].title, 'Unapproved Sanctuary Hardware');
  assert.deepEqual(copied.logs.map((l) => [l.event, l.reason, l.changed]), [['hardware-mismatch', 'other-hardware', ['board']]]);
  assert.ok(!JSON.stringify(copied.logs).includes(PC_B.board), 'the log names the fact, never its value');
  assert.ok(copied.result.ms < 10, `decided in ${copied.result.ms} ms`);
  // The license is left as it was: the other PC is not silently re-activated.
  assert.equal(guard(dir, PC_B).result.status, 'locked');
  assert.equal(guard(dir, PC_A).result.status, 'verified');
});

test('a changed license locks too', () => {
  const dir = tempUserData();
  guard(dir, PC_A);
  const file = path.join(dir, LICENSE_FILE);
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8').slice(0, -4)}AAAA`);
  const run = guard(dir, PC_A);
  assert.equal(run.result.status, 'locked');
  assert.deepEqual(run.exits, [1]);
  assert.equal(run.logs[0].reason, 'license-unreadable');
});

test('a replaced CPU on the same motherboard starts, and is logged', () => {
  const dir = tempUserData();
  guard(dir, PC_A);
  const run = guard(dir, { ...PC_A, cpu: 'BFEBFBFF000906EA' });
  assert.equal(run.result.status, 'verified');
  assert.deepEqual(run.logs.map((l) => [l.event, l.changed]), [['hardware-part-changed', ['cpu']]]);
});

test('hardware that cannot be read at all starts the app, logged, without writing a license', () => {
  const dir = tempUserData();
  const run = guard(dir, { board: null, cpu: null, tpm: null });
  assert.equal(run.result.status, 'unverified');
  assert.deepEqual(run.exits, []);
  assert.equal(run.logs[0].event, 'hardware-id-unreadable');
  assert.equal(fs.existsSync(path.join(dir, LICENSE_FILE)), false);
});

test('development, tests and other platforms are never bound', () => {
  const dir = tempUserData();
  assert.equal(guard(dir, PC_A, { isPackaged: false }).result.status, 'skipped');
  assert.equal(guard(dir, PC_A, { platform: 'darwin' }).result.status, 'skipped');
  assert.equal(fs.existsSync(path.join(dir, LICENSE_FILE)), false);
});

test('main.js runs the lock before it opens the database or creates a window', () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const call = source.indexOf('\nenforceHardwareLock();');
  assert.ok(call > 0, 'enforceHardwareLock() is called at the top level');
  assert.ok(call < source.indexOf('openConfiguredDatabase()'));
  assert.ok(call < source.indexOf('app.whenReady()'));
});

// ---- The real addon on this PC (Windows with the addon built) ----

const addon = (() => {
  if (process.platform !== 'win32') return null;
  try {
    return createRequire(import.meta.url)('./display-matrix.node');
  } catch {
    return null;
  }
})();

test('on this PC the addon reads the hardware and fingerprints it in under 5 ms', { skip: !addon?.getHardwareIdentity && 'display-matrix addon not built' }, () => {
  const identity = readHardwareIdentity({ native: addon, fallback: () => assert.fail('the addon must not fall back') });
  assert.equal(identity.source, 'native');
  assert.ok(identity.board || identity.cpu, 'SMBIOS gave a board UUID or processor id');
  assert.ok(['tpm2.0', 'tpm1.2', 'tpm', 'none', null].includes(identity.tpm));
  const times = [];
  for (let i = 0; i < 25; i += 1) {
    const t = performance.now();
    computeFingerprint(readHardwareIdentity({ native: addon }));
    times.push(performance.now() - t);
  }
  times.sort((x, y) => x - y);
  assert.ok(times[12] < 5, `median ${times[12].toFixed(3)} ms`);

  // The whole guard, activation then verification, with the real hardware.
  const dir = tempUserData();
  const readIdentity = () => readHardwareIdentity({ native: addon });
  assert.equal(guard(dir, null, { readIdentity }).result.status, 'activated');
  const verified = guard(dir, null, { readIdentity });
  assert.equal(verified.result.status, 'verified');
  assert.ok(verified.result.ms < 5, `verified in ${verified.result.ms.toFixed(3)} ms`);
});
