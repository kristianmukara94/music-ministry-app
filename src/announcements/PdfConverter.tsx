import { useEffect } from 'react';
import { SLIDE_H, SLIDE_W } from './paginate';
import { lyricTextFromItems } from '../../shared/lyrics-import.js';

/** One rendered page: its image (JPEG bytes) and the text on the page, which becomes the operator's speaker notes. */
export interface RenderedPage {
  jpeg: Uint8Array;
  text: string;
}

/**
 * Hidden route loaded by electron/pdf-converter.js. Renders each PDF page to a
 * 1920x1080 JPEG with pdf.js and sends the bytes back to the main process.
 */
export function PdfConverter() {
  useEffect(() => {
    const pdf = window.apcc?.pdf;
    if (!pdf) return;
    return pdf.onConvert(async ({ jobId, bytes, mode }) => {
      try {
        const pages = await renderPdf(bytes, mode);
        pdf.finish({ jobId, pages });
      } catch (err) {
        pdf.finish({ jobId, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }, []);

  return null;
}

async function renderPdf(bytes: Uint8Array, mode?: 'lyrics'): Promise<RenderedPage[]> {
  const pdfjs = await import('pdfjs-dist');
  // Run pdf.js's worker on this thread. A separate worker file would be blocked
  // by file:// restrictions, and pdf.js accepts a preloaded handler for this.
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs');
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;

  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages: RenderedPage[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    if (mode === 'lyrics') {
      // A lyrics import needs the text only, so no page image is drawn.
      const content = await page.getTextContent();
      pages.push({ jpeg: new Uint8Array(0), text: lyricTextFromItems(content.items) });
      page.cleanup();
      continue;
    }
    const natural = page.getViewport({ scale: 1 });
    // Fit the page inside 1920x1080 with its proportions kept. A landscape slide fills the screen exactly, and a
    // portrait page is centred with bars at the sides, so the whole page stays readable on the projector.
    const viewport = page.getViewport({ scale: Math.min(SLIDE_W / natural.width, SLIDE_H / natural.height) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable for PDF rendering.');

    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode a PDF page.'))), 'image/jpeg', 0.9),
    );
    // Plain text in reading order: items on the same line are joined by spaces, and each line ends where pdf.js says.
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
      .join('')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), text });
    page.cleanup();
  }

  await doc.destroy();
  return pages;
}
