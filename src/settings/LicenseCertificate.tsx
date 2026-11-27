import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, Printer, X } from 'lucide-react';
import { bridge } from '../live/bridge';
import { DRAG, NO_DRAG, TITLE_BAR_CLEARANCE } from '../components/appRegion';
import {
  CERTIFICATE_PAPERS,
  CERTIFICATE_TITLE,
  DEFAULT_PAPER,
  certificateDocument,
  type CertificateJob,
  type CertificatePaperName,
} from '../../shared/license-certificate.js';

const MM_TO_PX = 96 / 25.4;
/** The sheet at its real size: the paper, portrait, at 96 dpi. */
const paperPx = (name: CertificatePaperName) => ({
  width: Math.round(CERTIFICATE_PAPERS[name].width * MM_TO_PX),
  height: Math.round(CERTIFICATE_PAPERS[name].height * MM_TO_PX),
});
const PAPER_NAMES = Object.keys(CERTIFICATE_PAPERS) as CertificatePaperName[];
/** The paper last chosen here, so a parish on US Letter does not pick it every time. */
const PAPER_KEY = 'apccmma.certificatePaper';
const savedPaper = (): CertificatePaperName => {
  try {
    const saved = localStorage.getItem(PAPER_KEY);
    return PAPER_NAMES.find((name) => name === saved) ?? DEFAULT_PAPER;
  } catch {
    return DEFAULT_PAPER;
  }
};
const DESK_PAD = 48;
const TOOL =
  'no-drag inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-bold uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

type Busy = 'print' | 'pdf' | null;

const reasonOf = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);

/**
 * The certificate preview: the printed sheet on a dark desk, fitted to the window, with the paper (A4 or US Letter), Print and Save PDF. The
 * desktop app prints from a hidden window of its own (electron/license-certificate.js); the browser preview prints the frame. Esc closes;
 * Ctrl+P prints.
 */
export function LicenseCertificateDialog({ job: registration, onClose }: { job: CertificateJob; onClose: () => void }) {
  const [paper, setPaper] = useState<CertificatePaperName>(savedPaper);
  const job = useMemo<CertificateJob>(() => ({ ...registration, paper }), [registration, paper]);
  const html = useMemo(() => certificateDocument(job), [job]);
  const PAPER = paperPx(paper);
  const frame = useRef<HTMLIFrameElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: PAPER.width, height: PAPER.height });
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const choosePaper = (name: CertificatePaperName) => {
    setPaper(name);
    setStatus(null);
    try {
      localStorage.setItem(PAPER_KEY, name);
    } catch {
      // A blocked store only means the choice is not remembered.
    }
  };

  useEffect(() => {
    const el = desk.current;
    if (!el) return;
    const update = () => setRoom({ width: el.clientWidth - DESK_PAD, height: el.clientHeight - DESK_PAD });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);
  const scale = Math.max(0.2, Math.min(room.width / PAPER.width, room.height / PAPER.height, 1.25));

  const run = useCallback(
    async (what: Exclude<Busy, null>) => {
      if (busy) return;
      setStatus(null);
      const api = bridge.certificate;
      if (!api) {
        if (what === 'print') frame.current?.contentWindow?.print();
        return;
      }
      setBusy(what);
      try {
        if (what === 'print') {
          const result = await api.print(job);
          if (!result.printed && !result.canceled && result.reason) setStatus({ tone: 'error', text: `Could not print: ${result.reason}` });
        } else {
          const result = await api.savePdf(job);
          if (result.saved) setStatus({ tone: 'ok', text: `Saved to ${result.path}` });
        }
      } catch (err) {
        setStatus({ tone: 'error', text: `Could not ${what === 'print' ? 'print' : 'save'} the certificate: ${reasonOf(err)}` });
      } finally {
        setBusy(null);
      }
    },
    [busy, job],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc closes this sheet only: never Settings behind it, nor Go Live Fullscreen Mode.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        void run('print');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, run]);

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm" data-certificate-backdrop>
      {/* The caption strip stays a window handle; everything below it is no-drag (see components/appRegion.ts). */}
      <div aria-hidden className="app-drag absolute inset-x-0 top-0" style={{ height: TITLE_BAR_CLEARANCE, ...DRAG }} />
      <div
        className="no-drag pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col border-t border-line"
        style={{ top: TITLE_BAR_CLEARANCE, ...NO_DRAG }}
        role="dialog"
        aria-modal="true"
        aria-label={CERTIFICATE_TITLE}
        data-certificate-dialog
      >
        <div className="no-drag relative z-10 flex items-center gap-3 border-b border-line bg-panel px-3 py-2.5" style={NO_DRAG}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Printer size={16} aria-hidden className="shrink-0 text-accent" />
            <h2 className="shrink-0 text-sm font-bold text-fg">License Certificate</h2>
            <div role="group" aria-label="Paper size" className="flex shrink-0 overflow-hidden rounded-full border border-fg/15 bg-panel-2" data-certificate-paper>
              {PAPER_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => choosePaper(name)}
                  disabled={busy !== null}
                  aria-pressed={paper === name}
                  title={`${name} · 1 page`}
                  className={`no-drag px-2.5 py-1 text-[11px] font-semibold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed ${
                    paper === name ? 'bg-accent text-on-accent' : 'text-fg/80 hover:bg-fg/10 hover:text-fg'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-fg/80">1 page</span>
            {status && (
              <p role="status" title={status.text} className={`min-w-0 truncate text-xs font-semibold ${status.tone === 'error' ? 'text-danger' : 'text-fg/80'}`}>
                {status.text}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {bridge.certificate && (
              <button
                type="button"
                onClick={() => void run('pdf')}
                disabled={busy !== null}
                data-certificate-save-pdf
                className={`${TOOL} border-fg/20 bg-panel-2 text-fg/90 hover:bg-fg/10 hover:text-fg`}
              >
                <FileDown size={15} aria-hidden /> {busy === 'pdf' ? 'Working…' : 'Save PDF'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void run('print')}
              disabled={busy !== null}
              aria-busy={busy === 'print'}
              data-certificate-print
              className={`${TOOL} border-accent bg-accent px-4 text-on-accent hover:brightness-110`}
            >
              <Printer size={15} aria-hidden /> {busy === 'print' ? 'Opening…' : 'Print…'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
              className={`${TOOL} border-fg/15 bg-panel-2 text-fg/80 hover:bg-fg/10 hover:text-fg`}
            >
              <X size={16} aria-hidden /> <span className="hidden sm:inline">Close</span>
            </button>
          </div>
        </div>
        <div ref={desk} className="flex-1 overflow-auto bg-[#161412]">
          <div className="flex min-h-full min-w-fit items-start justify-center p-6">
            <div className="shrink-0 overflow-hidden rounded-[2px] bg-white shadow-2xl ring-1 ring-black/40" style={{ width: PAPER.width * scale, height: PAPER.height * scale }}>
              <iframe
                ref={frame}
                title={CERTIFICATE_TITLE}
                srcDoc={html}
                // No scripts run in the sheet; modals only so the browser preview can open its Print dialog.
                sandbox="allow-same-origin allow-modals"
                data-certificate-sheet
                style={{ width: PAPER.width, height: PAPER.height, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', background: '#ffffff' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
