import type { ColorMode, PaperSize, PrintLayout, PrintLineup } from './print-lineup.js';

export interface PrintPage {
  landscape: boolean;
  paper: PaperSize;
  /** The sheet in its orientation, in mm. */
  width: number;
  height: number;
  /** The safe printer margins, in mm. */
  marginY: number;
  marginX: number;
  /** How tall the copies stand inside the margins, in mm. */
  fill: number;
}

/** The safe margins of each layout, in mm. */
export const MARGINS: Readonly<Record<PrintLayout, Readonly<{ y: number; x: number }>>>;
/** Half the gutter between two copies, in mm (equal to their outer side margin). */
export const HALF_GUTTER: number;

/** The sheet of a layout on a paper: always portrait, two copies in two columns or one across. */
export function sheetOf(layout: PrintLayout | string, paper?: PaperSize | string): PrintPage;

/** The A4 sheet of each layout. */
export const PAGE: Readonly<Record<PrintLayout, PrintPage>>;

/** The CSS @page size, as in "A4 portrait". */
export function pageSizeRule(layout: PrintLayout | string, paper?: PaperSize | string): string;

export const DENSITIES: readonly string[];
export function fitDensity(lineup: PrintLineup, layout: PrintLayout | string, paper?: PaperSize | string): string;

/** A monochrome line icon for a row: a cross, a note, an open book or a screen. */
export function iconSvg(kind: string): string;

/** The lineup as a standalone white-paper HTML document: the preview, the printed page and the PDF. */
export function lineupDocument(
  lineup: PrintLineup,
  options?: { layout?: PrintLayout | string; mode?: string; lang?: string; church?: string; paper?: PaperSize | string; paged?: boolean; colorMode?: ColorMode | string },
): string;

export interface CheckedPrintJob {
  lineup: PrintLineup;
  layout: PrintLayout;
  mode: 'original' | 'uppercase' | 'lowercase';
  lang: string;
  church: string;
  paper: PaperSize;
  colorMode: ColorMode;
  /** The same paper, as Electron's print / printToPDF pageSize. */
  pageSize: PaperSize;
  landscape: boolean;
}

/** A print request from the window, checked and trimmed. Throws when there is no lineup. */
export function checkPrintJob(input: unknown): CheckedPrintJob;

/** "<Service-Title>-Lineup.pdf", safe as a Windows file name. */
export function pdfFileName(title: unknown): string;
