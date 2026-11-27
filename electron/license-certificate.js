// The license certificate, printed the way Print Lineup is (electron/print-lineup.js): the sheet from shared/license-certificate.js is laid out in
// a hidden, sandboxed window of its own, then handed to the system Print dialog or saved as a PDF where the operator chooses. A pop-up from the
// page would not do: the packaged app refuses every window.open (electron/anti-tamper.js). No Electron import here: main.js passes BrowserWindow
// and the dialogs in, so the tests run this under plain Node with stand-ins.
import path from 'node:path';
import { certificateDocument, certificateFileName, checkCertificateJob, expiryDayOf, paperOf } from '../shared/license-certificate.js';

export const CERTIFICATE_PRINT_CHANNEL = 'certificate:print';
export const CERTIFICATE_SAVE_PDF_CHANNEL = 'certificate:save-pdf';

/** What both the Print dialog and the PDF writer are given for a paper ("A4" or "Letter"), matching the sheet's @page rule. */
export const certificatePage = (paper) => ({ landscape: false, pageSize: paperOf(paper).name });

/** The paper at 96 dpi: the hidden window's size. Printing lays the page out again at the printer's size. */
const windowSize = (paper) => {
  const { width, height } = paperOf(paper);
  return { width: Math.round((width / 25.4) * 96), height: Math.round((height / 25.4) * 96) };
};

/**
 * The certificate printer. `showSaveDialog(owner, options)` is dialog.showSaveDialog, `writeFile(path, bytes)` saves the PDF and `defaultDir()`
 * is where the Save dialog opens. `licenseExpiry()` is the license manager's expiresAt (null for perpetual): when given, it decides the
 * certificate's status, whatever expiry the window sent. One job at a time: a second press while a dialog is open is refused.
 */
export function createCertificatePrinter({ BrowserWindow, showSaveDialog, writeFile, defaultDir = () => '', licenseExpiry = null, log = console }) {
  let busy = false;
  const checkJob = (input) =>
    checkCertificateJob(typeof licenseExpiry === 'function' ? { ...input, expiresOn: expiryDayOf(licenseExpiry()) } : input);

  async function openSheet(job, owner) {
    const win = new BrowserWindow({
      show: false,
      ...windowSize(job.paper),
      ...(owner ? { parent: owner } : {}),
      title: 'License Certificate',
      paintWhenInitiallyHidden: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, backgroundThrottling: false, spellcheck: false },
    });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(certificateDocument(job))}`);
    } catch (err) {
      if (!win.isDestroyed()) win.destroy();
      throw err;
    }
    return win;
  }

  const oneAtATime = (work) => async (...args) => {
    if (busy) throw new Error('The certificate is already being printed. Finish or cancel that first.');
    busy = true;
    try {
      return await work(...args);
    } finally {
      busy = false;
    }
  };

  /** Opens the system Print dialog for the certificate: `{ printed, canceled, reason }`. The sheet's window is closed either way. */
  const print = oneAtATime(async (input, owner = null) => {
    const job = checkJob(input);
    const win = await openSheet(job, owner);
    try {
      return await new Promise((resolve) => {
        win.webContents.print({ silent: false, printBackground: true, ...certificatePage(job.paper) }, (success, failureReason) => {
          const reason = success ? null : String(failureReason ?? '');
          resolve({ printed: Boolean(success), canceled: !success && /cancel/i.test(reason ?? ''), reason });
        });
      });
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  });

  /** Asks where to save, then writes the certificate there as a one-page PDF: `{ saved: true, path }`, or `{ saved: false, canceled: true }`. */
  const savePdf = oneAtATime(async (input, owner = null) => {
    const job = checkJob(input);
    const picked = await showSaveDialog(owner, {
      title: 'Save License Certificate as PDF',
      defaultPath: path.join(defaultDir() || '', certificateFileName(job.church)),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!picked || picked.canceled || !picked.filePath) return { saved: false, canceled: true };
    const filePath = /\.pdf$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.pdf`;
    const win = await openSheet(job, null);
    try {
      const pdf = await win.webContents.printToPDF({ printBackground: true, ...certificatePage(job.paper), preferCSSPageSize: true });
      await writeFile(filePath, pdf);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
    log.info?.(`[certificate] Saved the license certificate as ${filePath}.`);
    return { saved: true, path: filePath };
  });

  return { print, savePdf, isBusy: () => busy };
}

/** Wires the printer to the window: `certificate:print` opens the Print dialog, `certificate:save-pdf` saves a PDF. */
export function registerCertificatePrinting({ ipcMain, printer, windowOf = () => null }) {
  ipcMain.handle(CERTIFICATE_PRINT_CHANNEL, (event, input) => printer.print(input, windowOf(event?.sender)));
  ipcMain.handle(CERTIFICATE_SAVE_PDF_CHANNEL, (event, input) => printer.savePdf(input, windowOf(event?.sender)));
}
