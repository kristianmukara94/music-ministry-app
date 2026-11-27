// The license certificate in the main process (electron/license-certificate.js): the Print dialog and Save as PDF from a hidden white-paper
// window, with a stand-in BrowserWindow, and the registration the certificate is made from. Synthetic data only.
// Run with: node --test electron/license-certificate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  CERTIFICATE_PRINT_CHANNEL,
  CERTIFICATE_SAVE_PDF_CHANNEL,
  certificatePage,
  createCertificatePrinter,
  registerCertificatePrinting,
} from './license-certificate.js';
import { CERTIFICATE_EMBLEM } from '../shared/certificate-emblem.js';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { createSettingsService } = await import('./settings.js');
const { readConfig, validateRegistration } = await import('./config.js');

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const job = (over = {}) => ({ church: 'Sample Parish Name', location: 'Sample City', registeredOn: '01/02/2026', registeredDate: '2026-02-01', version: '1.2.3', ...over });

/** A stand-in for Electron's BrowserWindow that records what the printer asks of it. */
function fakeElectron({ printResult = [true, ''] } = {}) {
  const made = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.loaded = null;
      this.printCalls = [];
      this.pdfCalls = [];
      const self = this;
      this.webContents = {
        print: (options, callback) => {
          self.printCalls.push(options);
          setImmediate(() => callback(...printResult));
        },
        printToPDF: async (options) => {
          self.pdfCalls.push(options);
          return Buffer.from('%PDF-1.4 sample %%EOF', 'latin1');
        },
      };
      made.push(this);
    }
    async loadURL(url) {
      this.loaded = url;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { BrowserWindow: FakeWindow, made };
}

const sheetOf = (win) => decodeURIComponent(win.loaded.replace(/^data:text\/html;charset=utf-8,/, ''));

test('Print opens the system dialog on a hidden, script-free A4 sheet of the certificate, then closes the sheet', async () => {
  const electron = fakeElectron();
  const printer = createCertificatePrinter({ ...electron, showSaveDialog: async () => assert.fail('no save dialog'), writeFile: async () => {} });
  const result = await printer.print(job());
  assert.deepEqual(result, { printed: true, canceled: false, reason: null });
  assert.equal(electron.made.length, 1);
  const [win] = electron.made;
  assert.equal(win.options.show, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.javascript, false, 'the sheet runs no script');
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(win.printCalls, [{ silent: false, printBackground: true, landscape: false, pageSize: 'A4' }]);
  assert.deepEqual({ width: win.options.width, height: win.options.height }, { width: 794, height: 1123 }, 'A4 at 96 dpi');
  assert.deepEqual(certificatePage(undefined), { landscape: false, pageSize: 'A4' });
  assert.match(sheetOf(win), /<p class="licensee" data-licensee>Sample Parish Name<\/p>/);
  assert.equal(win.destroyed, true);
});

test('the sheet the hidden window prints carries the emblem, the seal, the Credential ID and the delivered-system block, all inline', async () => {
  const electron = fakeElectron();
  const printer = createCertificatePrinter({ ...electron, showSaveDialog: async () => null, writeFile: async () => {} });
  await printer.print(job());
  const sheet = sheetOf(electron.made[0]);
  // Scripts are off in that window and it loads nothing from outside, so every graphic travels inside the page.
  assert.ok(sheet.includes(`<img class="emblem" src="${CERTIFICATE_EMBLEM}"`), 'the APCCMMA emblem as a data URI');
  assert.match(CERTIFICATE_EMBLEM, /^data:image\/png;base64,/);
  assert.match(sheet, /<svg class="seal-art" viewBox="0 0 100 100" role="img" aria-label="Official seal" data-seal>/);
  assert.match(sheet, /data-credential-id>APCCMMA-2026-0201-[0-9A-Z]{4}</);
  assert.match(sheet, /<div class="delivered" data-delivered-scope><h2>Delivered System &amp; Architectural Scope<\/h2>/);
  assert.match(sheet, /<div class="watermark" aria-hidden="true" data-watermark>/);
  assert.doesNotMatch(sheet, /<script|<link|@import/i);
  for (const [, value] of sheet.matchAll(/\ssrc="([^"]*)"/g)) assert.match(value, /^data:image\/png;base64,/);
});

test('a job on US Letter prints and saves on Letter: the dialog, the PDF, the window and the sheet all agree', async () => {
  const electron = fakeElectron();
  const printer = createCertificatePrinter({
    ...electron,
    showSaveDialog: async () => ({ canceled: false, filePath: path.join('C:', 'Sample Documents', 'certificate.pdf') }),
    writeFile: async () => {},
    log: {},
  });
  await printer.print(job({ paper: 'Letter' }));
  await printer.savePdf(job({ paper: 'Letter' }));
  const [printed, saved] = electron.made;
  assert.deepEqual(printed.printCalls, [{ silent: false, printBackground: true, landscape: false, pageSize: 'Letter' }]);
  assert.deepEqual(saved.pdfCalls, [{ printBackground: true, landscape: false, pageSize: 'Letter', preferCSSPageSize: true }]);
  for (const win of [printed, saved]) {
    assert.deepEqual({ width: win.options.width, height: win.options.height }, { width: 816, height: 1056 }, 'Letter at 96 dpi');
    const sheet = sheetOf(win);
    assert.match(sheet, /@page \{ size: letter portrait; margin: 0; \}/);
    assert.match(sheet, /<main class="sheet" data-certificate data-paper="Letter">/);
  }
  // Anything but the two papers falls back to A4 rather than reaching the printer.
  assert.deepEqual(certificatePage('Tabloid'), { landscape: false, pageSize: 'A4' });
  assert.deepEqual(certificatePage('Letter'), { landscape: false, pageSize: 'Letter' });
});

test('the printed status follows the license the main process holds, whatever expiry the window sent', async () => {
  let expiresAt = '2026-12-15T00:00:00.000Z';
  const electron = fakeElectron();
  const printer = createCertificatePrinter({
    ...electron,
    showSaveDialog: async () => ({ canceled: false, filePath: path.join('C:', 'Sample Documents', 'certificate.pdf') }),
    writeFile: async () => {},
    licenseExpiry: () => expiresAt,
    log: {},
  });
  // A dated key: the pilot status, even though the window claimed none.
  await printer.print(job({ expiresOn: '' }));
  assert.match(sheetOf(electron.made[0]), /data-expires-on>Active Pilot License \(Expires 2026-12-15\)</);
  // Perpetual (null): the perpetual status, even though the window claimed a pilot day.
  expiresAt = null;
  await printer.savePdf(job({ expiresOn: '2027-01-01' }));
  assert.match(sheetOf(electron.made[1]), /<span class="strip-value status">Active Perpetual License<\/span>/);
  // Wired to the license manager in main.js.
  assert.match(read('electron/main.js'), /licenseExpiry: \(\) => licenseManager\.status\(\)\.expiresAt,/);
});

test('a cancelled Print dialog is reported as cancelled, and a failure carries its reason', async () => {
  const cancelled = fakeElectron({ printResult: [false, 'cancelled'] });
  const a = createCertificatePrinter({ ...cancelled, showSaveDialog: async () => null, writeFile: async () => {} });
  assert.deepEqual(await a.print(job()), { printed: false, canceled: true, reason: 'cancelled' });
  const failed = fakeElectron({ printResult: [false, 'Printer offline'] });
  const b = createCertificatePrinter({ ...failed, showSaveDialog: async () => null, writeFile: async () => {} });
  assert.deepEqual(await b.print(job()), { printed: false, canceled: false, reason: 'Printer offline' });
  assert.equal(failed.made[0].destroyed, true);
});

test('Save PDF asks where, suggests the parish in the file name, and writes one A4 page there', async () => {
  const electron = fakeElectron();
  const written = [];
  let asked = null;
  const printer = createCertificatePrinter({
    ...electron,
    defaultDir: () => path.join('C:', 'Sample Documents'),
    showSaveDialog: async (_owner, options) => {
      asked = options;
      return { canceled: false, filePath: path.join('C:', 'Sample Documents', 'certificate') };
    },
    writeFile: async (file, bytes) => written.push({ file, bytes }),
    log: {},
  });
  const result = await printer.savePdf(job());
  assert.equal(asked.defaultPath, path.join('C:', 'Sample Documents', 'APCCMMA-License-Certificate-Sample-Parish-Name.pdf'));
  assert.deepEqual(asked.filters, [{ name: 'PDF', extensions: ['pdf'] }]);
  assert.deepEqual(result, { saved: true, path: path.join('C:', 'Sample Documents', 'certificate.pdf') });
  assert.equal(written.length, 1);
  assert.equal(written[0].file, result.path, '.pdf is added when the operator leaves it off');
  assert.deepEqual(electron.made[0].pdfCalls, [{ printBackground: true, landscape: false, pageSize: 'A4', preferCSSPageSize: true }]);
  assert.equal(electron.made[0].destroyed, true);
});

test('closing the Save dialog writes nothing and opens no sheet', async () => {
  const electron = fakeElectron();
  const printer = createCertificatePrinter({ ...electron, showSaveDialog: async () => ({ canceled: true }), writeFile: async () => assert.fail('nothing written') });
  assert.deepEqual(await printer.savePdf(job()), { saved: false, canceled: true });
  assert.equal(electron.made.length, 0);
});

test('a certificate with no church is refused before any window opens, and one job runs at a time', async () => {
  const electron = fakeElectron();
  const printer = createCertificatePrinter({ ...electron, showSaveDialog: async () => null, writeFile: async () => {} });
  await assert.rejects(printer.print(job({ church: '  ' })), /Register the church/);
  assert.equal(electron.made.length, 0);
  assert.equal(printer.isBusy(), false, 'a refused job does not leave the printer busy');

  const first = printer.print(job());
  await assert.rejects(printer.print(job()), /already being printed/);
  await first;
  assert.equal(printer.isBusy(), false);
});

test('the two channels go to the printer with the asking window as owner, and the window can reach them', async () => {
  const handlers = new Map();
  const calls = [];
  registerCertificatePrinting({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    printer: { print: async (input, owner) => calls.push(['print', input, owner]), savePdf: async (input, owner) => calls.push(['pdf', input, owner]) },
    windowOf: (sender) => `window-of-${sender}`,
  });
  assert.deepEqual([...handlers.keys()], [CERTIFICATE_PRINT_CHANNEL, CERTIFICATE_SAVE_PDF_CHANNEL]);
  await handlers.get('certificate:print')({ sender: 'settings' }, job());
  await handlers.get('certificate:save-pdf')({ sender: 'settings' }, job());
  assert.deepEqual(calls.map(([what, , owner]) => [what, owner]), [['print', 'window-of-settings'], ['pdf', 'window-of-settings']]);

  const preload = read('electron/preload.cjs');
  assert.match(preload, /certificate: \{\n\s+print: \(job\) => ipcRenderer\.invoke\('certificate:print', job\),\n\s+savePdf: \(job\) => ipcRenderer\.invoke\('certificate:save-pdf', job\),/);
  assert.match(read('electron/main.js'), /registerCertificatePrinting\(\{\n\s+ipcMain,/);
});

// ── The registration the certificate is made from ──────────────────────────

test('the registration is saved trimmed, with its repeated spaces made one, both on acceptance and on edit', () => {
  assert.deepEqual(validateRegistration({ church: '  Sample   Parish  Name ', location: 'Sample\t\tCity ' }), { church: 'Sample Parish Name', location: 'Sample City' });
  assert.throws(() => validateRegistration({ church: '   ', location: 'Sample City' }), /church, parish, or ministry name/);
  assert.throws(() => validateRegistration({ church: 'Sample Parish Name', location: ' \t ' }), /location or city/);
  // Collapsing happens before the length check, so padding alone never pushes a name over the limit.
  assert.deepEqual(validateRegistration({ church: `Sample${' '.repeat(200)}Parish`, location: 'Sample City' }).church, 'Sample Parish');
  assert.throws(() => validateRegistration({ church: 'x'.repeat(121), location: 'Sample City' }), /120 characters or fewer/);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-certificate-'));
  try {
    const service = createSettingsService({ userData, getDb: () => null, getStatus: () => ({}), appVersion: '1.2.3', showOpenDirectory: async () => ({ canceled: true }) });
    service.acceptEula({ church: ' Sample   Parish Name', location: 'Sample  City ' });
    const accepted = readConfig(userData);
    assert.equal(accepted.registered_church, 'Sample Parish Name');
    assert.equal(accepted.registered_location, 'Sample City');
    service.updateRegistration({ church: 'Sample\n  Parish   Two ', location: '  Sample    Town' });
    const edited = readConfig(userData);
    assert.equal(edited.registered_church, 'Sample Parish Two');
    assert.equal(edited.registered_location, 'Sample Town');
    assert.equal(edited.registered_at, accepted.registered_at, 'an edit keeps the original registration date');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
