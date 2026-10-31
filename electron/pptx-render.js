import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';
import JSZip from 'jszip';
import { buildDeckHtml } from './pptx-html.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renders each visible slide of a .pptx with the app's own renderer, so a computer with no PowerPoint or LibreOffice still gets the
 * deck as designed. The slides are laid out as one page each, printed to a PDF (which does not depend on the screen's size or
 * scaling), and that PDF is turned into one JPEG per slide by `convertPdf`, the same step a PDF import uses. Resolves to one JPEG
 * buffer per slide, in slide order. Hidden slides are skipped. Older .ppt files are a binary format and need PowerPoint or LibreOffice.
 */
export async function renderWithBuiltIn(source, workDir, convertPdf) {
  if (path.extname(source).toLowerCase() !== '.pptx') {
    throw new Error('Older .ppt files can only be shown with Microsoft PowerPoint or LibreOffice. Save the file as .pptx and import it again.');
  }
  const zip = await JSZip.loadAsync(await fs.promises.readFile(source));
  const mediaDir = path.join(workDir, 'media');
  await fs.promises.mkdir(mediaDir, { recursive: true });
  let n = 0;
  const media = async (target) => {
    const file = path.join(mediaDir, `m${(n += 1)}${path.extname(target).toLowerCase()}`);
    await fs.promises.writeFile(file, await zip.file(target).async('nodebuffer'));
    return pathToFileURL(file).href;
  };
  const { html, count } = await buildDeckHtml(zip, { media });
  const page = path.join(workDir, 'deck.html');
  await fs.promises.writeFile(page, html, 'utf8');

  const win = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  let pdf;
  try {
    await win.loadFile(page);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => loadImages()).then(() => fitAll())');
    // Every picture is loaded by now; give the page a moment to paint them before it is printed.
    await pause(200);
    pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  const pdfFile = path.join(workDir, 'deck.pdf');
  await fs.promises.writeFile(pdfFile, pdf);
  const pages = await convertPdf(pdfFile);
  if (pages.length !== count) throw new Error(`The slides came out as ${pages.length} pages instead of ${count}.`);
  return pages.map((p) => p.jpeg);
}
