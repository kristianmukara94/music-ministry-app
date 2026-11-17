import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FileDown, Maximize, Minus, Plus, Printer, X } from 'lucide-react';
import { COLOR_MODES, PAPER_SIZES, PRINT_LAYOUTS, colorModeOf, paperSizeOf, printLayoutOf, type ColorMode, type PaperSize, type PrintLayout, type PrintLineup } from '../../shared/print-lineup.js';
import { lineupDocument, sheetOf } from '../../shared/print-lineup-html.js';
import { TextCaseSwitch } from '../components/TextCaseSwitch';
import { bridge, type LineupPrintJob } from '../live/bridge';
import { useChurchName } from '../church/profile';
import { useUi } from '../state/ui';
import { usePlannerTextCase } from './textCase';
import { usePlannerT } from './strings';

const LAYOUT_KEY = 'apcc.printLineupLayout';
const PAPER_KEY = 'apcc.printLineupPaper';
const COLOR_KEY = 'apcc.printLineupColorMode';
const MM_TO_PX = 96 / 25.4;
/**
 * The app window is frameless with the system's minimise / maximise / close buttons drawn over its top bar (titleBarOverlay, height
 * TITLE_BAR_HEIGHT in shared/title-bar.js). The print studio starts below that strip, so its own buttons can never sit under them.
 */
const TITLE_BAR_CLEARANCE = 48;
/** The zoom steps of − and +; Fit fits the whole first page in the desk. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5];
/** The desk's padding around the paper, in px (p-6 on each side). */
const DESK_PAD = 48;

function readStored<T>(key: string, parse: (value: string | null) => T, fallback: T): T {
  try {
    return parse(window.localStorage.getItem(key));
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A blocked store only means the choice is not kept.
  }
}

/** The Print Lineup button for a planner toolbar. */
export function PrintLineupButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  const t = usePlannerT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={t('printLineupHint')}
      data-print-lineup-button
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide uppercase text-fg/85 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Printer size={14} aria-hidden /> {t('printLineup')}
    </button>
  );
}

const TOOL =
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-bold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const SEGMENTS = 'flex h-10 shrink-0 overflow-hidden rounded-md border border-fg/15 bg-panel-2';
const segment = (on: boolean) =>
  `flex items-center justify-center px-3 text-xs font-bold transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 focus-visible:outline-none ${on ? 'bg-accent text-on-accent' : 'text-fg/75 hover:bg-fg/10 hover:text-fg'}`;
const ZOOM_BUTTON =
  'flex h-full w-9 items-center justify-center text-fg/80 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40';
const DIVIDER = <span aria-hidden className="mx-1 hidden h-7 w-px shrink-0 bg-fg/15 lg:block" />;

type Busy = 'print' | 'pdf' | 'open' | null;

/**
 * The print studio. The sheet is shared/print-lineup-html.js, shown in a frame of its own exactly as it prints: white paper, in colour or black and white, none
 * of the app's theme, at its real proportions (A4, Letter or Legal) on a dark desk. By default it holds two identical copies side by side on
 * a portrait sheet, in two columns (cut down the dashed line for two handouts); the bar switches to one copy across the sheet. Print… opens the system
 * Print dialog (already on the right orientation and paper), Save PDF writes a PDF, and Open PDF opens one in the system's PDF viewer, all
 * from a hidden window in the desktop app (electron/print-lineup.js). Ctrl+P prints; Esc closes.
 */
export function PrintLineupDialog({ lineup, onClose }: { lineup: PrintLineup; onClose: () => void }) {
  const t = usePlannerT();
  const lang = useUi((s) => s.lang);
  const church = useChurchName();
  const mode = usePlannerTextCase((s) => s.mode);
  const setMode = usePlannerTextCase((s) => s.set);
  const [layout, setLayout] = useState<PrintLayout>(() => readStored(LAYOUT_KEY, printLayoutOf, 'double'));
  const [paper, setPaper] = useState<PaperSize>(() => readStored(PAPER_KEY, paperSizeOf, 'A4'));
  const [colorMode, setColorMode] = useState<ColorMode>(() => readStored(COLOR_KEY, colorModeOf, 'color'));
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const job: LineupPrintJob = useMemo(() => ({ lineup, layout, mode, lang, church, paper, colorMode }), [lineup, layout, mode, lang, church, paper, colorMode]);
  const html = useMemo(() => lineupDocument(lineup, { layout, mode, lang, church, paper, colorMode }), [lineup, layout, mode, lang, church, paper, colorMode]);

  // The paper is drawn at its real size (mm at 96 dpi) and scaled: to fit the whole first page in the desk, or to a chosen zoom.
  const frame = useRef<HTMLIFrameElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const sheet = sheetOf(layout, paper);
  const paperWidth = Math.round(sheet.width * MM_TO_PX);
  const pageHeight = Math.round(sheet.height * MM_TO_PX);
  const [paperHeight, setPaperHeight] = useState(pageHeight);
  const [room, setRoom] = useState({ width: paperWidth, height: pageHeight });
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  useEffect(() => {
    const el = desk.current;
    if (!el) return;
    const update = () => setRoom({ width: el.clientWidth - DESK_PAD, height: el.clientHeight - DESK_PAD });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);
  const fitScale = Math.max(0.2, Math.min(room.width / paperWidth, room.height / pageHeight, 1.5));
  const scale = zoom === 'fit' ? fitScale : zoom;
  const pages = Math.max(1, Math.ceil(paperHeight / pageHeight - 0.02));
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    // The sheet's own height (it grows past one page for a long lineup), so the preview also shrinks back when the lineup gets shorter.
    const height = doc?.querySelector('.sheet')?.getBoundingClientRect().height ?? doc?.documentElement?.scrollHeight ?? 0;
    setPaperHeight(Math.max(pageHeight, Math.ceil(height)));
  }, [pageHeight]);
  useEffect(() => setPaperHeight(pageHeight), [pageHeight]);

  const zoomOut = () => setZoom([...ZOOM_STEPS].reverse().find((z) => z < scale - 0.001) ?? ZOOM_STEPS[0]);
  const zoomIn = () => setZoom(ZOOM_STEPS.find((z) => z > scale + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]);

  const run = useCallback(
    async (what: Exclude<Busy, null>) => {
      if (busy) return;
      setStatus(null);
      const api = bridge.lineup;
      if (!api) {
        // The browser preview has no desktop printer: print the preview frame, which is the same paper.
        if (what === 'print') frame.current?.contentWindow?.print();
        return;
      }
      setBusy(what);
      try {
        if (what === 'print') {
          const result = await api.print(job);
          if (!result.printed && !result.canceled && result.reason) setStatus({ tone: 'error', text: t('printFailed', { reason: result.reason }) });
        } else if (what === 'pdf') {
          const result = await api.savePdf(job);
          if (result.saved) setStatus({ tone: 'ok', text: t('printSaved', { file: result.path }) });
        } else {
          const result = await api.openPdf(job);
          setStatus({ tone: 'ok', text: t('printOpened', { file: result.path }) });
        }
      } catch (err) {
        setStatus({ tone: 'error', text: t('printFailed', { reason: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) }) });
      } finally {
        // Always back to "Print…", whether the dialog printed, was cancelled or failed.
        setBusy(null);
      }
    },
    [busy, job, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        // Ctrl+P / Cmd+P prints the lineup, as in a document.
        e.preventDefault();
        e.stopPropagation();
        void run('print');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, run]);

  const pickLayout = (next: PrintLayout) => {
    setLayout(next);
    writeStored(LAYOUT_KEY, next);
  };
  const pickPaper = (next: PaperSize) => {
    setPaper(next);
    writeStored(PAPER_KEY, next);
  };
  const pickColorMode = (next: ColorMode) => {
    setColorMode(next);
    writeStored(COLOR_KEY, next);
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm" data-print-lineup-backdrop>
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col border-t border-line"
        style={{ top: TITLE_BAR_CLEARANCE }}
        role="dialog"
        aria-modal="true"
        aria-label={t('printPreview')}
        data-print-lineup-dialog
      >
        <div className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2.5">
          {/* Left: page setup, then zoom. They wrap on a narrow window; the right group never shrinks, so its buttons are always in view. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Printer size={16} aria-hidden className="shrink-0 text-accent" />
            <h2 className="mr-1 shrink-0 text-sm font-bold text-fg">{t('printLineup')}</h2>
            <div role="group" aria-label={t('printPageSetup')} className="flex shrink-0 flex-wrap items-center gap-2" data-print-setup>
              <div role="radiogroup" aria-label={t('printLayout')} className={SEGMENTS}>
                {PRINT_LAYOUTS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={layout === id}
                    data-layout={id}
                    onClick={() => pickLayout(id)}
                    className={`${segment(layout === id)} flex-col leading-tight`}
                  >
                    <span>{t(id === 'double' ? 'printCopiesDouble' : 'printCopiesSingle')}</span>
                    <span className="text-[10px] font-semibold opacity-80">{t('printPortrait')}</span>
                  </button>
                ))}
              </div>
              <div role="radiogroup" aria-label={t('printPaperSize')} title={t('printPaperSize')} className={SEGMENTS} data-paper-size={paper}>
                {PAPER_SIZES.map((id) => (
                  <button key={id} type="button" role="radio" aria-checked={paper === id} data-paper={id} onClick={() => pickPaper(id)} className={segment(paper === id)}>
                    {id}
                  </button>
                ))}
              </div>
              <div role="radiogroup" aria-label={t('printColorMode')} className={SEGMENTS} data-color-mode={colorMode}>
                {COLOR_MODES.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={colorMode === id}
                    data-color-mode-option={id}
                    onClick={() => pickColorMode(id)}
                    title={t(id === 'color' ? 'printColorHint' : 'printBwHint')}
                    className={segment(colorMode === id)}
                  >
                    {t(id === 'color' ? 'printColor' : 'printBw')}
                  </button>
                ))}
              </div>
              <TextCaseSwitch
                size="md"
                value={mode}
                onChange={setMode}
                labels={{ group: t('textCase'), original: t('textCaseOriginal'), uppercase: t('textCaseUpper'), lowercase: t('textCaseLower') }}
              />
            </div>
            {DIVIDER}
            <div role="group" aria-label={t('printZoom')} className="flex shrink-0 items-center gap-2" data-print-zoom>
              <div className={SEGMENTS}>
                <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} title={t('printFitHint')} className={`${segment(zoom === 'fit')} gap-1.5`}>
                  <Maximize size={13} aria-hidden /> {t('printFit')}
                </button>
                <button type="button" onClick={zoomOut} disabled={scale <= ZOOM_STEPS[0] + 0.001} aria-label={t('printZoomOut')} title={t('printZoomOut')} className={`${ZOOM_BUTTON} border-l border-fg/15`}>
                  <Minus size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  title={t('printZoomReset')}
                  className="flex h-full w-14 items-center justify-center border-x border-fg/15 font-mono text-xs font-bold text-fg/85 tabular-nums transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 focus-visible:outline-none"
                  data-zoom-level
                >
                  {Math.round(scale * 100)}%
                </button>
                <button type="button" onClick={zoomIn} disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001} aria-label={t('printZoomIn')} title={t('printZoomIn')} className={ZOOM_BUTTON}>
                  <Plus size={14} aria-hidden />
                </button>
              </div>
              <span className="shrink-0 rounded-full border border-fg/15 bg-panel-2 px-2.5 py-1 text-[11px] font-semibold text-fg/80" data-print-pages>
                {sheet.paper} · {t(pages === 1 ? 'printSheetOne' : 'printSheetMany', { n: pages })}
              </span>
            </div>
            {status && (
              <p role="status" className={`min-w-0 truncate text-xs font-semibold ${status.tone === 'error' ? 'text-danger' : 'text-fg/80'}`} title={status.text}>
                {status.text}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2" data-print-actions>
            {bridge.lineup && (
              <>
                <button
                  type="button"
                  onClick={() => void run('open')}
                  disabled={busy !== null}
                  title={t('printOpenPdfHint')}
                  aria-label={t('printOpenPdf')}
                  data-open-pdf
                  className={`${TOOL} border-fg/20 bg-panel-2 text-fg/90 hover:bg-fg/10 hover:text-fg`}
                >
                  <ExternalLink size={15} aria-hidden /> <span className="hidden xl:inline">{busy === 'open' ? t('printWorking') : t('printOpenPdf')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void run('pdf')}
                  disabled={busy !== null}
                  title={t('printSavePdfHint')}
                  aria-label={t('printSavePdf')}
                  data-save-pdf
                  className={`${TOOL} border-fg/20 bg-panel-2 text-fg/90 hover:bg-fg/10 hover:text-fg`}
                >
                  <FileDown size={15} aria-hidden /> <span className="hidden md:inline">{busy === 'pdf' ? t('printWorking') : t('printSavePdf')}</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void run('print')}
              disabled={busy !== null}
              title={t('printNowHint')}
              aria-busy={busy === 'print'}
              data-print-now
              className={`${TOOL} border-accent bg-accent px-4 font-extrabold tracking-wide text-on-accent hover:brightness-110`}
            >
              <Printer size={15} aria-hidden /> {busy === 'print' ? t('printOpening') : t('printNow')}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('printClose')}
              title={`${t('printClose')} (Esc)`}
              data-print-close
              className={`${TOOL} border-fg/15 bg-panel-2 text-fg/80 hover:bg-fg/10 hover:text-fg`}
            >
              <X size={16} aria-hidden /> <span className="hidden sm:inline">{t('printClose')}</span>
            </button>
          </div>
        </div>
        {/* The desk: a dark studio surface with the paper on it, scrolled when zoomed past the window. */}
        <div ref={desk} className="flex-1 overflow-auto bg-[#161412]" data-print-desk>
          <div className="flex min-h-full min-w-fit items-start justify-center p-6">
            <div
              className="shrink-0 overflow-hidden rounded-[2px] bg-white shadow-2xl ring-1 ring-black/40"
              style={{ width: paperWidth * scale, height: paperHeight * scale }}
              data-paper-sheet={`${sheet.paper}-${sheet.landscape ? 'landscape' : 'portrait'}`}
            >
              <iframe
                ref={frame}
                title={t('printPreview')}
                srcDoc={html}
                onLoad={measure}
                // No scripts run in the paper; same-origin only so the preview can read its height, modals so the browser preview can print it.
                sandbox="allow-same-origin allow-modals"
                data-print-sheet
                data-layout={layout}
                style={{ width: paperWidth, height: paperHeight, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', background: '#ffffff' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
