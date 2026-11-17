// Print Lineup in the main process (electron/print-lineup.js): the Print dialog and Save as PDF from a hidden white-paper window, with a
// stand-in BrowserWindow. Synthetic data only. Run with: node --test electron/print-lineup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OPEN_PDF_CHANNEL, PRINT_CHANNEL, SAVE_PDF_CHANNEL, countPdfPages, createLineupPrinter, pageFooterTemplate, registerLineupPrinting } from './print-lineup.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const lineup = {
  type: 'pw',
  title: 'Sample Session',
  subtitle: 'Sample Day',
  minutes: 8,
  sections: [
    {
      heading: 'Sample Segment',
      minutes: 8,
      entries: [
        { number: '01', name: 'Sample Slot', kind: 'song', minutes: 5, items: [{ kind: 'song', title: 'Sample Song 1', key: 'Bb' }] },
        { number: '02', name: 'Sample Slot 2', kind: 'song', minutes: 3, writeIn: true, items: [] },
      ],
    },
  ],
};
const job = (over = {}) => ({ lineup, layout: 'double', mode: 'original', lang: 'en', church: 'Sample Parish', ...over });

/** A one-page or a two-page "PDF": only its page objects matter here. */
const fakePdf = (pages) => Buffer.from(`%PDF-1.4 1 0 obj << /Type /Pages /Count ${pages} >> ${Array.from({ length: pages }, () => '<< /Type /Page /Parent 1 0 R >>').join(' ')} %%EOF`, 'latin1');

/** A stand-in for Electron's BrowserWindow that records what the printer asks of it. */
function fakeElectron({ printResult = [true, ''], pdfPages = [1, 1] } = {}) {
  const made = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.loaded = null;
      this.printCalls = [];
      this.pdfCalls = [];
      this.scripts = [];
      const self = this;
      this.webContents = {
        executeJavaScript: async (code) => {
          self.scripts.push(code);
          return true;
        },
        print: (options, callback) => {
          self.printCalls.push(options);
          setImmediate(() => callback(...printResult));
        },
        printToPDF: async (options) => {
          self.pdfCalls.push(options);
          return fakePdf(pdfPages[self.pdfCalls.length - 1] ?? 1);
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

const quiet = { info() {}, warn() {} };

test('Print… lays the lineup out in a hidden, sandboxed window and opens the system Print dialog, portrait for 2 copies', async () => {
  const { BrowserWindow, made } = fakeElectron();
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => assert.fail('no Save dialog when printing'), writeFile: async () => {}, log: quiet });
  const owner = { id: 'sample-owner' };
  const result = await printer.print(job(), owner);
  assert.deepEqual(result, { printed: true, canceled: false, reason: null });
  assert.equal(made.length, 1);
  const [win] = made;
  assert.equal(win.options.show, false, 'the paper window is never shown: the operator sees only the Print dialog');
  assert.equal(win.options.parent, owner);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.preload, undefined, 'the paper gets no bridge to the app');
  const html = decodeURIComponent(win.loaded.replace(/^data:text\/html;charset=utf-8,/, ''));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<span class="parish">Sample Parish<\/span>/);
  assert.match(html, /<small>Key<\/small>Bb<\/span>/);
  assert.match(html, /data-write-in/);
  assert.match(win.scripts[0], /document\.fonts\.ready/, 'printing waits for the fonts');
  assert.deepEqual(win.printCalls, [{ silent: false, printBackground: true, landscape: false, pageSize: 'A4' }], 'the Print dialog opens on Portrait and A4');
  assert.match(html, /@page \{ size: A4 portrait; margin: 0; \}/);
  assert.equal(win.destroyed, true, 'the paper window is closed once the job is sent');
});

test('1 copy per page prints portrait too', async () => {
  const { BrowserWindow, made } = fakeElectron();
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({ canceled: true }), writeFile: async () => {}, log: quiet });
  await printer.print(job({ layout: 'single' }));
  assert.equal(made[0].printCalls[0].landscape, false);
  assert.equal(made[0].printCalls[0].pageSize, 'A4');
  assert.match(decodeURIComponent(made[0].loaded), /data-copies="1"/);
});

test('cancelling the Print dialog is reported as cancelled, not as an error, and the window is still closed', async () => {
  const { BrowserWindow, made } = fakeElectron({ printResult: [false, 'Print job canceled'] });
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({ canceled: true }), writeFile: async () => {}, log: quiet });
  assert.deepEqual(await printer.print(job()), { printed: false, canceled: true, reason: 'Print job canceled' });
  assert.equal(made[0].destroyed, true);
  assert.equal(printer.isBusy(), false);
  const failing = fakeElectron({ printResult: [false, 'Sample failure'] });
  const other = createLineupPrinter({ BrowserWindow: failing.BrowserWindow, showSaveDialog: async () => ({}), writeFile: async () => {}, log: quiet });
  assert.deepEqual(await other.print(job()), { printed: false, canceled: false, reason: 'Sample failure' });
});

test('only one print at a time: a second press while the Print dialog is open is refused', async () => {
  let release;
  const { BrowserWindow } = fakeElectron();
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({ canceled: true }), writeFile: async () => {}, log: quiet });
  const slow = new Promise((resolve) => (release = resolve));
  // Hold the first job open in its Save dialog.
  const held = createLineupPrinter({ BrowserWindow, showSaveDialog: () => slow, writeFile: async () => {}, log: quiet });
  const first = held.savePdf(job());
  await assert.rejects(held.print(job()), /already being printed/);
  release({ canceled: true });
  assert.deepEqual(await first, { saved: false, canceled: true });
  assert.equal(held.isBusy(), false);
  assert.equal((await printer.print(job())).printed, true);
});

test('a bad request never opens a window', async () => {
  const { BrowserWindow, made } = fakeElectron();
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({ canceled: true }), writeFile: async () => {}, log: quiet });
  await assert.rejects(printer.print({ lineup: null }), /no lineup/);
  await assert.rejects(printer.savePdf({}), /no lineup/);
  assert.equal(made.length, 0);
  assert.equal(printer.isBusy(), false);
});

test('Save PDF asks where, offering <Service-Title>-Lineup.pdf, then writes a portrait A4 PDF', async () => {
  const { BrowserWindow, made } = fakeElectron();
  const saved = [];
  const asked = [];
  const owner = { id: 'sample-owner' };
  const printer = createLineupPrinter({
    BrowserWindow,
    showSaveDialog: async (win, options) => {
      asked.push({ win, options });
      return { canceled: false, filePath: path.join('C:', 'Sample', 'Sample-Session-Lineup') };
    },
    writeFile: async (file, bytes) => saved.push({ file, bytes }),
    defaultDir: () => path.join('C:', 'Sample Documents'),
    log: quiet,
  });
  const result = await printer.savePdf(job(), owner);
  assert.equal(asked[0].win, owner);
  assert.equal(asked[0].options.defaultPath, path.join('C:', 'Sample Documents', 'Sample-Session-Lineup.pdf'));
  assert.deepEqual(asked[0].options.filters, [{ name: 'PDF', extensions: ['pdf'] }]);
  assert.equal(asked[0].options.title, 'Save PDF');
  assert.deepEqual(result, { saved: true, path: path.join('C:', 'Sample', 'Sample-Session-Lineup.pdf'), pages: 1 }, '.pdf is added when the name has none');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].file, result.path);
  assert.match(saved[0].bytes.toString('latin1'), /^%PDF/);
  assert.deepEqual(made[0].pdfCalls, [{ printBackground: true, landscape: false, pageSize: 'A4', preferCSSPageSize: false }]);
  assert.match(asked[0].options.title, /Save PDF/);
  assert.equal(made[0].destroyed, true);

  const portrait = fakeElectron();
  const p2 = createLineupPrinter({ BrowserWindow: portrait.BrowserWindow, showSaveDialog: async () => ({ filePath: 'Sample.pdf' }), writeFile: async () => {}, log: quiet });
  await p2.savePdf(job({ layout: 'single' }));
  assert.equal(portrait.made[0].pdfCalls[0].landscape, false);
});

test('closing the Save dialog saves nothing and opens no window', async () => {
  const { BrowserWindow, made } = fakeElectron();
  const saved = [];
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({ canceled: true, filePath: '' }), writeFile: async (f) => saved.push(f), log: quiet });
  assert.deepEqual(await printer.savePdf(job()), { saved: false, canceled: true });
  assert.equal(made.length, 0);
  assert.deepEqual(saved, []);
});

test('a lineup that runs past one page is saved again with page numbers in its footer', async () => {
  const { BrowserWindow, made } = fakeElectron({ pdfPages: [2, 2] });
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({ filePath: 'Sample.pdf' }), writeFile: async () => {}, log: quiet });
  const result = await printer.savePdf(job({ lang: 'tl' }));
  assert.equal(result.pages, 2);
  const [first, second] = made[0].pdfCalls;
  assert.equal(first.displayHeaderFooter, undefined, 'a one-page sheet gets no page numbers');
  assert.equal(second.displayHeaderFooter, true);
  assert.match(second.footerTemplate, /Sample Session &nbsp;·&nbsp; Pahina <span class="pageNumber"><\/span> ng <span class="totalPages"><\/span>/);
  // It is laid out again with its margins in @page, so every page keeps them and the footer has room; still portrait.
  assert.equal(second.landscape, false);
  assert.match(decodeURIComponent(made[0].loaded), /@page \{ size: A4 portrait; margin: 10mm 8mm; \}/);
  assert.equal(made[0].scripts.length, 2, 'it waits for the fonts again');
});

test('page counting and the footer template', () => {
  assert.equal(countPdfPages(fakePdf(1)), 1);
  assert.equal(countPdfPages(fakePdf(3)), 3, '/Type /Pages is not counted as a page');
  assert.match(pageFooterTemplate('Sample <Session>', 'en'), /Sample &lt;Session&gt; &nbsp;·&nbsp; Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span>/);
  assert.doesNotMatch(pageFooterTemplate('', 'en'), /&nbsp;·&nbsp;/);
});

test('the IPC channels lineup:print and lineup:save-pdf reach the printer with the sending window', async () => {
  const handlers = new Map();
  const calls = [];
  const printer = { print: async (input, owner) => calls.push(['print', input, owner]), savePdf: async (input, owner) => calls.push(['pdf', input, owner]) };
  const sender = { id: 7 };
  registerLineupPrinting({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, printer, windowOf: (contents) => (contents === sender ? 'sample-window' : null) });
  printer.openPdf = async (input) => calls.push(['open', input, null]);
  assert.deepEqual([...handlers.keys()], [PRINT_CHANNEL, SAVE_PDF_CHANNEL, OPEN_PDF_CHANNEL]);
  assert.equal(PRINT_CHANNEL, 'lineup:print');
  assert.equal(SAVE_PDF_CHANNEL, 'lineup:save-pdf');
  assert.equal(OPEN_PDF_CHANNEL, 'lineup:open-pdf');
  await handlers.get('lineup:print')({ sender }, job());
  await handlers.get('lineup:save-pdf')({ sender }, job({ layout: 'single' }));
  await handlers.get('lineup:open-pdf')({ sender }, job({ paper: 'Legal' }));
  assert.deepEqual(
    calls.map(([what, input, owner]) => [what, input.layout, input.paper, owner]),
    [['print', 'double', undefined, 'sample-window'], ['pdf', 'single', undefined, 'sample-window'], ['open', 'double', 'Legal', null]],
  );
});

test('the app wires it all: main registers the printer, the preload exposes it, and the preview calls it (Ctrl+P prints)', () => {
  const main = read('electron/main.js');
  assert.match(main, /import \{ createLineupPrinter, registerLineupPrinting \} from '\.\/print-lineup\.js';/);
  assert.match(main, /registerLineupPrinting\(\{\n  ipcMain,\n  windowOf: \(contents\) => \(contents \? BrowserWindow\.fromWebContents\(contents\) : null\),\n  printer: createLineupPrinter\(\{\n    BrowserWindow,/);
  const preload = read('electron/preload.cjs');
  assert.match(preload, /print: \(job\) => ipcRenderer\.invoke\('lineup:print', job\),/);
  assert.match(preload, /savePdf: \(job\) => ipcRenderer\.invoke\('lineup:save-pdf', job\),/);
  assert.match(preload, /openPdf: \(job\) => ipcRenderer\.invoke\('lineup:open-pdf', job\),/);
  assert.match(main, /tempDir: \(\) => app\.getPath\('temp'\),\n    openPath: \(file\) => shell\.openPath\(file\),/);
  const dialog = read('src/planner/PrintLineup.tsx');
  assert.match(dialog, /const result = await api\.print\(job\);/);
  assert.match(dialog, /const result = await api\.savePdf\(job\);/);
  assert.match(dialog, /const result = await api\.openPdf\(job\);/);
  assert.match(dialog, /onClick=\{\(\) => void run\('open'\)\}/);
  // The studio starts below the frameless window's caption buttons (minimise, maximise, close), so nothing of its own sits under them.
  assert.match(dialog, /const TITLE_BAR_CLEARANCE = 48;/);
  assert.match(dialog, /style=\{\{ top: TITLE_BAR_CLEARANCE \}\}/);
  assert.match(read('shared/title-bar.js'), /export const TITLE_BAR_HEIGHT = 48;/, 'the clearance matches the overlay height');
  // Print… reads "Opening Print Dialog…" while the dialog is up, and always resets.
  assert.match(dialog, /\{busy === 'print' \? t\('printOpening'\) : t\('printNow'\)\}/);
  assert.match(dialog, /\} finally \{[^}]*setBusy\(null\);/);
  // Paper size and layout are both kept for next time.
  assert.match(dialog, /const PAPER_KEY = 'apcc\.printLineupPaper';/);
  assert.match(dialog, /writeStored\(PAPER_KEY, next\);/);
  assert.match(dialog, /writeStored\(LAYOUT_KEY, next\);/);
  assert.match(dialog, /\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.shiftKey && e\.key\.toLowerCase\(\) === 'p'\) \{[^}]*e\.preventDefault\(\);[^}]*void run\('print'\);/);
  assert.match(dialog, /onClick=\{\(\) => void run\('print'\)\}/);
  assert.match(dialog, /onClick=\{\(\) => void run\('pdf'\)\}/);
  // The bar's right-hand group never shrinks, so Save PDF, Print… and Close stay in view on a narrow window.
  assert.match(dialog, /<div className="flex shrink-0 items-center gap-2" data-print-actions>/);
  assert.match(dialog, /<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">/);
  assert.doesNotMatch(dialog, /window\.print\(\)/, 'the app window itself is never printed');
});

test('every paper size reaches lineup:print, lineup:save-pdf and lineup:open-pdf, always portrait (landscape: false)', async () => {
  for (const paper of ['A4', 'Letter', 'Legal']) {
    for (const layout of ['double', 'single']) {
      const { BrowserWindow, made } = fakeElectron();
      const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({ filePath: 'Sample.pdf' }), writeFile: async () => {}, openPath: async () => '', log: quiet });
      // Through the IPC channels, as the window sends them.
      const handlers = new Map();
      registerLineupPrinting({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, printer });
      await handlers.get('lineup:print')({}, job({ layout, paper }));
      await handlers.get('lineup:save-pdf')({}, job({ layout, paper }));
      await handlers.get('lineup:open-pdf')({}, job({ layout, paper }));
      assert.equal(made.length, 3);
      assert.deepEqual(made[0].printCalls[0], { silent: false, printBackground: true, landscape: false, pageSize: paper }, `${layout} on ${paper}: Print`);
      assert.deepEqual(made[1].pdfCalls[0], { printBackground: true, landscape: false, pageSize: paper, preferCSSPageSize: false }, `${layout} on ${paper}: Save PDF`);
      assert.deepEqual(made[2].pdfCalls[0], { printBackground: true, landscape: false, pageSize: paper, preferCSSPageSize: false }, `${layout} on ${paper}: Open PDF`);
      for (const win of made) {
        const html = decodeURIComponent(win.loaded);
        assert.match(html, new RegExp(`@page \\{ size: ${paper} portrait; margin: 0; \\}`), 'the paper says the same');
        assert.doesNotMatch(html, /landscape/);
      }
    }
  }
});

test('Open PDF writes the lineup to the temp folder under a fresh name and opens it in the system PDF viewer', async () => {
  const { BrowserWindow, made } = fakeElectron();
  const saved = [];
  const opened = [];
  const printer = createLineupPrinter({
    BrowserWindow,
    showSaveDialog: async () => assert.fail('Open PDF asks nothing'),
    writeFile: async (file, bytes) => saved.push({ file, bytes }),
    tempDir: () => path.join('C:', 'Sample Temp'),
    openPath: async (file) => {
      opened.push(file);
      return '';
    },
    log: quiet,
  });
  const result = await printer.openPdf(job({ layout: 'double', paper: 'Letter' }));
  assert.equal(result.opened, true);
  assert.equal(result.pages, 1);
  assert.equal(path.dirname(result.path), path.join('C:', 'Sample Temp'));
  assert.match(path.basename(result.path), /^Sample-Session-Lineup-\d{14}\.pdf$/);
  assert.deepEqual(opened, [result.path]);
  assert.equal(saved[0].file, result.path);
  assert.match(saved[0].bytes.toString('latin1'), /^%PDF/);
  assert.deepEqual(made[0].pdfCalls, [{ printBackground: true, landscape: false, pageSize: 'Letter', preferCSSPageSize: false }]);
  assert.equal(made[0].destroyed, true);
  assert.equal(printer.isBusy(), false);
});

test('Open PDF reports a viewer that cannot be started', async () => {
  const { BrowserWindow } = fakeElectron();
  const printer = createLineupPrinter({ BrowserWindow, showSaveDialog: async () => ({}), writeFile: async () => {}, tempDir: () => 'tmp', openPath: async () => 'No application is associated with this file', log: quiet });
  await assert.rejects(printer.openPdf(job()), /No application is associated/);
  assert.equal(printer.isBusy(), false);
});
