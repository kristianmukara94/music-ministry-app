// Print Lineup, the way a Word document or a PDF prints: the lineup is laid out as paper in a hidden window of its own (white, with none of
// the app's styles or theme), then either handed to the system Print dialog or saved as a PDF where the operator chooses. The paper is
// shared/print-lineup-html.js, the same document the preview shows. Open PDF writes the PDF to the temp folder and opens it in the system's
// PDF viewer (Edge, Acrobat …) for a full native preview. No Electron import here: main.js passes BrowserWindow and the dialogs in,
// so the tests run this under plain Node with stand-ins.
import path from 'node:path';
import { checkPrintJob, lineupDocument, pdfFileName, sheetOf } from '../shared/print-lineup-html.js';
import { plannerT } from '../shared/planner-i18n.js';

export const PRINT_CHANNEL = 'lineup:print';
export const SAVE_PDF_CHANNEL = 'lineup:save-pdf';
export const OPEN_PDF_CHANNEL = 'lineup:open-pdf';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** How many pages a PDF made by Chromium has: its page objects (not the /Pages tree). */
export function countPdfPages(pdf) {
  const text = Buffer.from(pdf).toString('latin1');
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

/** The PDF page footer for a lineup that runs past one page: "Title · Page 2 of 3", in small grey type. */
export function pageFooterTemplate(title, lang) {
  const label = esc(plannerT(lang, 'printPage', { n: '\u0001', total: '\u0002' }))
    .replace('\u0001', '<span class="pageNumber"></span>')
    .replace('\u0002', '<span class="totalPages"></span>');
  const name = title ? `${esc(title)} &nbsp;·&nbsp; ` : '';
  return `<div style="width:100%;margin:0 9mm;font-family:'Segoe UI',Arial,sans-serif;font-size:7pt;color:#4b5563;text-align:right;">${name}${label}</div>`;
}

/**
 * The settings both the Print dialog and the PDF writer get, so they agree with the paper's @page rule: the paper size, always portrait
 * (two copies sit side by side on a portrait sheet).
 */
export function pageSettings(job) {
  return { landscape: false, pageSize: job.pageSize };
}

/**
 * The lineup printer. `BrowserWindow` is Electron's; `showSaveDialog(owner, options)` is dialog.showSaveDialog; `writeFile(path, bytes)`
 * saves the PDF; `defaultDir()` is where the Save dialog opens; `tempDir()` is app.getPath('temp') and `openPath(file)` is shell.openPath
 * (it resolves to '' on success, or an error message), both for Open PDF. One job at a time: a second press while a dialog is open is refused.
 */
export function createLineupPrinter({
  BrowserWindow,
  showSaveDialog,
  writeFile,
  defaultDir = () => '',
  tempDir = () => '',
  openPath = async () => 'Opening files is not available here.',
  log = console,
}) {
  let busy = false;

  /** Opens the job's paper in a hidden, script-free-content window and waits for its fonts. The caller destroys the window. */
  async function openSheet(job, owner) {
    const page = sheetOf(job.layout, job.paper);
    const win = new BrowserWindow({
      show: false,
      // About the paper's size at 96 dpi; printing lays the page out again at the printer's size.
      width: Math.round((page.width / 25.4) * 96),
      height: Math.round((page.height / 25.4) * 96),
      ...(owner ? { parent: owner } : {}),
      title: job.lineup.title || 'Lineup',
      paintWhenInitiallyHidden: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    });
    try {
      await loadPaper(win, job);
    } catch (err) {
      if (!win.isDestroyed()) win.destroy();
      throw err;
    }
    return win;
  }

  /** Lays the job's paper out in `win` and waits for its fonts. `paged` moves the margins into @page (see lineupDocument). */
  async function loadPaper(win, job, paged = false) {
    const html = lineupDocument(job.lineup, { ...job, paged });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  }

  const oneAtATime = (work) => async (...args) => {
    if (busy) throw new Error('A lineup is already being printed. Finish or cancel that first.');
    busy = true;
    try {
      return await work(...args);
    } finally {
      busy = false;
    }
  };

  /**
   * Opens the system Print dialog for the lineup. Resolves when the job is sent or the dialog is cancelled:
   * `{ printed, canceled, reason }`. The paper's window is closed either way.
   */
  const print = oneAtATime(async (input, owner = null) => {
    const job = checkPrintJob(input);
    const win = await openSheet(job, owner);
    try {
      // The window stays hidden: Windows 11 still opens its Print dialog for it (checked on Electron 33), so the operator sees only that.
      return await new Promise((resolve) => {
        // Orientation and paper are passed explicitly (and match the @page rule), so the dialog opens on Portrait and the chosen paper.
        win.webContents.print({ silent: false, printBackground: true, ...pageSettings(job) }, (success, failureReason) => {
          const reason = success ? null : String(failureReason ?? '');
          resolve({ printed: Boolean(success), canceled: !success && /cancel/i.test(reason ?? ''), reason });
        });
      });
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  });

  /**
   * The job as PDF bytes, portrait on its paper. A lineup that runs past one page is laid out again with its margins on every page and
   * page numbers in the bottom one.
   */
  async function renderPdf(job) {
    const win = await openSheet(job, null);
    try {
      const base = { printBackground: true, ...pageSettings(job), preferCSSPageSize: false };
      let pdf = await win.webContents.printToPDF(base);
      let pages = countPdfPages(pdf);
      if (pages > 1) {
        await loadPaper(win, job, true);
        pdf = await win.webContents.printToPDF({
          ...base,
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: pageFooterTemplate(job.lineup.title, job.lang),
        });
        pages = countPdfPages(pdf);
      }
      return { pdf, pages };
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  /**
   * Asks where to save, then saves the lineup as a PDF there, on the chosen paper. Resolves to `{ saved: true, path, pages }`, or `{ saved: false,
   * canceled: true }` when the operator closes the Save dialog. A lineup that runs past one page gets page numbers in its footer.
   */
  const savePdf = oneAtATime(async (input, owner = null) => {
    const job = checkPrintJob(input);
    const picked = await showSaveDialog(owner, {
      title: plannerT(job.lang, 'printSavePdf'),
      defaultPath: path.join(defaultDir() || '', pdfFileName(job.lineup.title)),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!picked || picked.canceled || !picked.filePath) return { saved: false, canceled: true };
    const filePath = /\.pdf$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.pdf`;
    const { pdf, pages } = await renderPdf(job);
    await writeFile(filePath, pdf);
    log.info?.(`[print] Saved the lineup as ${filePath} (${pages} page${pages === 1 ? '' : 's'}).`);
    return { saved: true, path: filePath, pages };
  });

  /**
   * Writes the lineup's PDF to the temp folder and opens it in the system's PDF viewer, for a full native preview before printing.
   * Each open gets a fresh name, so a copy still open (and locked) in the viewer is never overwritten. Resolves to `{ opened: true, path,
   * pages }`; throws when the viewer cannot be started.
   */
  const openPdf = oneAtATime(async (input) => {
    const job = checkPrintJob(input);
    const { pdf, pages } = await renderPdf(job);
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const filePath = path.join(tempDir() || '', pdfFileName(job.lineup.title).replace(/\.pdf$/, `-${stamp}.pdf`));
    await writeFile(filePath, pdf);
    const failure = await openPath(filePath);
    if (failure) throw new Error(failure);
    log.info?.(`[print] Opened the lineup PDF ${filePath} (${pages} page${pages === 1 ? '' : 's'}).`);
    return { opened: true, path: filePath, pages };
  });

  return { print, savePdf, openPdf, isBusy: () => busy };
}

/** Wires the printer to the window: `lineup:print` opens the Print dialog, `lineup:save-pdf` saves a PDF, `lineup:open-pdf` opens one. */
export function registerLineupPrinting({ ipcMain, printer, windowOf = () => null }) {
  ipcMain.handle(PRINT_CHANNEL, (event, input) => printer.print(input, windowOf(event?.sender)));
  ipcMain.handle(SAVE_PDF_CHANNEL, (event, input) => printer.savePdf(input, windowOf(event?.sender)));
  ipcMain.handle(OPEN_PDF_CHANNEL, (event, input) => printer.openPdf(input));
}
