// Sanctuary hardware lock: binds this install's userData to the PC it was first started on.
//
// Three hardware facts, read without administrator rights:
//   - board: the motherboard / system UUID (SMBIOS type 1, the value WMI reports as Win32_ComputerSystemProduct.UUID).
//   - cpu:   the processor id (SMBIOS type 4, WMI's Win32_Processor.ProcessorId).
//   - tpm:   whether a TPM is present and its family ('tpm2.0', 'tpm1.2', 'none'), from the TPM Base Services.
// They are read by the display-matrix addon in well under a millisecond (GetSystemFirmwareTable + Tbsi_GetDeviceInfo). Without the addon,
// one PowerShell CIM query is the fallback; it gives the same values but takes a second or more, so it is for development machines only
// (release builds fail if the addon cannot be built).
//
// Each fact is HMAC-SHA256'd with the parish church code, and so is the three together (the fingerprint). Only the digests are stored;
// the raw ids never reach the disk or the log.
//
// The license, userData/sanctuary-license.lic, is written on the first packaged start (first-run activation) and checked on every start
// after. A license made on another PC means the userData folder was copied here: the app shows "Unapproved Sanctuary Hardware" and exits
// with code 1 before the database is opened.
//
// What this does not do, on purpose or by necessity:
//   - The Endorsement Key is not read: Windows only shows it to administrators, and the app runs as a normal user. TPM presence and family
//     are what a normal user can read.
//   - The church code and the license key ship inside the app, so they are not secrets. The license is tamper-evident (AES-GCM), not
//     unforgeable, and deleting it starts a new activation. A copy of the app on its own (no userData) is a fresh install and activates.
//     Stopping those needs activation approved off this PC (a developer-signed license or the cloud), which this module does not do.
//   - Copying the database file out of userData and opening it with any SQLite tool is not stopped here. The Mass Intention vault
//     (db-vault.js) is what protects those bodies.
//   - The processor id is the CPU model's signature, not a serial: two laptops of one model share it. The board UUID is the unique part.
//
// Only the packaged app on Windows is locked. `npm run dev`, the tests and the CDP checks run unpackaged and are never bound.
import { app, dialog } from 'electron';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeSecurityLog } from './anti-tamper.js';
import { loadDisplayMatrix } from './edid-watchdog.js';

/** The parish church code: the HMAC key for the fingerprint, and the root of the license key. */
export const PARISH_CHURCH_CODE = 'PTGS-X2D9';
export const LICENSE_FILE = 'sanctuary-license.lic';
export const COMPONENTS = ['board', 'cpu', 'tpm'];

const LICENSE_PREFIX = 'APCCMMA-LIC1:';
const LICENSE_VERSION = 1;
const LICENSE_AAD = Buffer.from('apccmma-sanctuary-license-v1');
/** Reading the license failed for a moment, not because of what the file is. */
const TEMPORARY_READ_ERRORS = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE', 'EAGAIN']);

export const LOCKDOWN_TITLE = 'Unapproved Sanctuary Hardware';
export const LOCKDOWN_MESSAGE =
  'This copy of APCCMMA is licensed to a different computer.\n\n' +
  'The app and its data were copied from the sanctuary laptop they were activated on, and cannot run on this one.\n\n' +
  'Ask the parish administrator to set up APCCMMA on this computer.';

// ---------------------------------------------------------------------------------------------------------------------------------------
// SMBIOS parsing

/**
 * The UUID in an SMBIOS type 1 structure, formatted the way Windows (WMI) shows it: since SMBIOS 2.6 the first three fields are
 * little-endian. Null when the firmware says it has none (all 0xFF: not present; all 0x00: present but not set).
 */
export function formatSmbiosUuid(bytes, major = 3, minor = 0) {
  if (!bytes || bytes.length < 16) return null;
  const b = Buffer.from(bytes.subarray(0, 16));
  if (b.every((x) => x === 0xff) || b.every((x) => x === 0x00)) return null;
  const le = major > 2 || (major === 2 && minor >= 6);
  const hex = (start, end, reverse) => {
    const part = [...b.subarray(start, end)];
    if (reverse && le) part.reverse();
    return part.map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`.toUpperCase();
}

/** The processor id as WMI shows it: the 8 bytes read as one little-endian 64-bit number (EDX features, then EAX signature), in hex. */
export function formatProcessorId(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const b = Buffer.from(bytes.subarray(0, 8));
  if (b.every((x) => x === 0x00) || b.every((x) => x === 0xff)) return null;
  return b.readBigUInt64LE(0).toString(16).toUpperCase().padStart(16, '0');
}

/**
 * The board UUID and processor id in a raw SMBIOS table (GetSystemFirmwareTable('RSMB') output: an 8-byte RawSMBIOSData header, then
 * the structures). For the processor, the first populated socket wins. Reads defensively: a truncated or garbled table gives nulls.
 */
export function parseSmbios(raw) {
  const out = { board: null, cpu: null };
  if (!raw || raw.length < 8) return out;
  const buf = Buffer.from(raw);
  const major = buf[1];
  const minor = buf[2];
  const length = buf.readUInt32LE(4);
  const end = Math.min(buf.length, 8 + length);
  let firstCpu = null;
  let populatedCpu = null;
  let o = 8;
  while (o + 4 <= end) {
    const type = buf[o];
    const len = buf[o + 1];
    if (len < 4 || o + len > end) break;
    const body = buf.subarray(o, o + len);
    if (type === 1 && len >= 0x19 && out.board === null) out.board = formatSmbiosUuid(body.subarray(0x08, 0x18), major, minor);
    if (type === 4 && len >= 0x1a) {
      const id = formatProcessorId(body.subarray(0x08, 0x10));
      if (id) {
        firstCpu ??= id;
        // Status byte, bit 6: CPU socket populated.
        if (populatedCpu === null && (body[0x18] & 0x40) !== 0) populatedCpu = id;
      }
    }
    if (type === 127) break;
    // The strings follow the formatted area and end with two zero bytes.
    let s = o + len;
    while (s + 1 < end && !(buf[s] === 0 && buf[s + 1] === 0)) s += 1;
    o = s + 2;
  }
  out.cpu = populatedCpu ?? firstCpu;
  return out;
}

/** The TPM fact from the addon's Tbsi_GetDeviceInfo result: 'tpm2.0', 'tpm1.2', 'none', or null when the TPM service could not answer. */
export function tpmFromNative(tpm) {
  if (!tpm) return null;
  if (tpm.status === 'absent') return 'none';
  if (tpm.status !== 'present') return null;
  if (tpm.version === 2) return 'tpm2.0';
  if (tpm.version === 1) return 'tpm1.2';
  return 'tpm';
}

/** The TPM fact from a Plug and Play device name ("Trusted Platform Module 2.0"), for the PowerShell fallback. */
export function tpmFromDeviceName(name) {
  if (name === null || name === undefined || name === '') return 'none';
  const m = /(\d+)\.(\d+)/.exec(String(name));
  if (!m) return 'tpm';
  if (m[1] === '2') return 'tpm2.0';
  if (m[1] === '1') return 'tpm1.2';
  return 'tpm';
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Reading the hardware

const POWERSHELL_QUERY = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$p=Get-CimInstance Win32_ComputerSystemProduct',
  '$c=Get-CimInstance Win32_Processor | Select-Object -First 1',
  "$t=Get-CimInstance Win32_PnPEntity -Filter \"Service='TPM'\" | Select-Object -First 1",
  '@{board=$p.UUID;cpu=$c.ProcessorId;tpm=$t.Name;tpmFound=[bool]$t} | ConvertTo-Json -Compress',
].join(';');

/** A board UUID from WMI, with the same "none" rules as the native read. */
function cleanUuid(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(text)) return null;
  const digits = text.replace(/-/g, '');
  if (/^F+$/.test(digits) || /^0+$/.test(digits)) return null;
  return text;
}

function cleanCpu(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[0-9A-F]{16}$/.test(text) && !/^0+$/.test(text) && !/^F+$/.test(text) ? text : null;
}

/** The slow path: one PowerShell CIM query. Returns null facts on any failure. */
export function readHardwareViaPowerShell({ run = spawnSync } = {}) {
  try {
    const res = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_QUERY], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return { board: null, cpu: null, tpm: null, source: 'powershell' };
    const data = JSON.parse(res.stdout.trim());
    return {
      board: cleanUuid(data.board),
      cpu: cleanCpu(data.cpu),
      tpm: data.tpmFound ? tpmFromDeviceName(data.tpm) : 'none',
      source: 'powershell',
    };
  } catch {
    return { board: null, cpu: null, tpm: null, source: 'powershell' };
  }
}

/** The three hardware facts: from the addon when it is there and has the call, else from PowerShell. */
export function readHardwareIdentity({ native = loadDisplayMatrix({ log: { warn() {} } }), fallback = readHardwareViaPowerShell } = {}) {
  if (native && typeof native.getHardwareIdentity === 'function') {
    try {
      const raw = native.getHardwareIdentity();
      const { board, cpu } = parseSmbios(raw?.smbios);
      return { board, cpu, tpm: tpmFromNative(raw?.tpm), source: 'native' };
    } catch {
      // Fall through to the slow path.
    }
  }
  return fallback();
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fingerprint

const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');

/**
 * The HMAC-SHA256 digests of one PC's hardware facts, keyed with the church code: one per fact (null when that fact could not be read),
 * and the fingerprint over all three. Raw ids go in and only digests come out.
 */
export function computeFingerprint(identity, { churchCode = PARISH_CHURCH_CODE } = {}) {
  const components = {};
  for (const name of COMPONENTS) {
    const value = identity?.[name];
    components[name] = value ? hmac(churchCode, `apccmma-hw-v1|${name}|${value}`) : null;
  }
  const fingerprint = hmac(churchCode, `apccmma-hw-v1|${COMPONENTS.map((n) => `${n}=${identity?.[n] ?? ''}`).join('|')}`);
  return { fingerprint, components };
}

/**
 * Whether the hardware now is the hardware the license was made on. An exact fingerprint is a match. Otherwise the facts are compared one
 * by one, so a single part replaced in a repair does not lock the parish out:
 *   - a different board UUID is never a match (it is the one fact unique to the PC);
 *   - at least two of the three facts must match.
 * A fact that could not be read on either side counts neither way. Returns { match, changed: [names of facts that differ] }.
 */
export function compareFingerprints(licensed, current) {
  if (!licensed || !current) return { match: false, changed: [...COMPONENTS] };
  const changed = [];
  let same = 0;
  for (const name of COMPONENTS) {
    const a = licensed.components?.[name];
    const b = current.components?.[name];
    if (!a || !b) continue;
    if (a === b) same += 1;
    else changed.push(name);
  }
  if (licensed.fingerprint && licensed.fingerprint === current.fingerprint) return { match: true, changed: [] };
  return { match: !changed.includes('board') && same >= 2, changed };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// License file

function licenseKey(churchCode) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(churchCode), Buffer.from('apccmma-sanctuary-license'), Buffer.from('v1'), 32));
}

/** The license file's text for one fingerprint: `APCCMMA-LIC1:` + base64url(IV | TAG | AES-256-GCM ciphertext). */
export function encodeLicense(fp, { churchCode = PARISH_CHURCH_CODE, now = new Date(), appVersion = '' } = {}) {
  const body = JSON.stringify({ v: LICENSE_VERSION, fingerprint: fp.fingerprint, components: fp.components, activatedAt: now.toISOString(), appVersion });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', licenseKey(churchCode), iv);
  cipher.setAAD(LICENSE_AAD);
  const ct = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return LICENSE_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

/** The license's contents, or null when the text is not a license this app made, or it was changed. Never throws. */
export function decodeLicense(text, { churchCode = PARISH_CHURCH_CODE } = {}) {
  try {
    const s = String(text ?? '').trim();
    if (!s.startsWith(LICENSE_PREFIX)) return null;
    const raw = Buffer.from(s.slice(LICENSE_PREFIX.length), 'base64url');
    if (raw.length < 12 + 16 + 2) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', licenseKey(churchCode), raw.subarray(0, 12));
    decipher.setAAD(LICENSE_AAD);
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    if (body?.v !== LICENSE_VERSION || typeof body.fingerprint !== 'string' || typeof body.components !== 'object') return null;
    return body;
  } catch {
    return null;
  }
}

/** Writes the license through a temporary file and a rename, so a power cut mid-write never leaves a half license that would lock. */
export function writeLicense(userData, text) {
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, LICENSE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The start-up guard

/**
 * Checks this PC against the license, or activates it on the first start. Returns { status, ms, changed? }:
 *   - 'skipped':    not the packaged app, or not Windows. Nothing is read or written.
 *   - 'activated':  no license yet; one is written for this PC.
 *   - 'verified':   the license matches this PC.
 *   - 'unverified': none of the hardware could be read, or the license file is held open for a moment. The app starts (logged): a Sunday
 *                   Mass is not stopped by a driver fault or a virus scan.
 *   - 'locked':     the license is from another PC, or was changed. The dialog is shown and the app exits with code 1.
 * `ms` is the time from the start of the check to its decision.
 */
export function enforceHardwareLock({
  electronApp = app,
  platform = process.platform,
  userData = null,
  readIdentity = readHardwareIdentity,
  churchCode = PARISH_CHURCH_CODE,
  now = () => new Date(),
  clock = () => performance.now(),
  showLockdown = (title, message) => dialog.showErrorBox(title, message),
  exit = (code) => {
    electronApp.exit(code);
    // app.exit() returns before the process is gone; nothing more of the app may run in the meantime.
    process.exit(code);
  },
  log = writeSecurityLog,
} = {}) {
  if (!electronApp.isPackaged || platform !== 'win32') return { status: 'skipped', ms: 0 };
  const started = clock();
  const dir = userData ?? electronApp.getPath('userData');
  const logTo = (event, details) => log(event, details, { userData: dir });

  const identity = readIdentity();
  const current = computeFingerprint(identity, { churchCode });
  const readable = COMPONENTS.filter((n) => current.components[n]);
  if (!readable.length) {
    logTo('hardware-id-unreadable', { source: identity?.source ?? null });
    return { status: 'unverified', ms: clock() - started };
  }

  const file = path.join(dir, LICENSE_FILE);
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // A virus scan or a sync tool holding the file says nothing about this PC, and must not lock a parish out on a Sunday morning.
    if (TEMPORARY_READ_ERRORS.has(err?.code)) {
      logTo('license-read-failed', { error: err.code });
      return { status: 'unverified', ms: clock() - started };
    }
    if (err?.code !== 'ENOENT') text = '';
  }

  if (text === null) {
    try {
      writeLicense(dir, encodeLicense(current, { churchCode, now: now(), appVersion: safeVersion(electronApp) }));
      logTo('hardware-activated', { components: readable, source: identity.source });
    } catch (err) {
      // A license that cannot be written (read-only profile) is tried again on the next start; this one runs.
      logTo('hardware-activation-failed', { error: err?.code ?? err?.name ?? 'Error' });
    }
    return { status: 'activated', ms: clock() - started };
  }

  const licensed = decodeLicense(text, { churchCode });
  const result = licensed ? compareFingerprints(licensed, current) : { match: false, changed: [] };
  if (result.match) {
    if (result.changed.length) logTo('hardware-part-changed', { changed: result.changed });
    return { status: 'verified', ms: clock() - started, changed: result.changed };
  }

  const ms = clock() - started;
  // Which facts differ, never their values.
  logTo('hardware-mismatch', { reason: licensed ? 'other-hardware' : 'license-unreadable', changed: result.changed, ms: Math.round(ms * 1000) / 1000 });
  showLockdown(LOCKDOWN_TITLE, LOCKDOWN_MESSAGE);
  exit(1);
  return { status: 'locked', ms, changed: result.changed };
}

function safeVersion(electronApp) {
  try {
    return electronApp.getVersion();
  } catch {
    return '';
  }
}
