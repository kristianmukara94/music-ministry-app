import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Scissors, Sparkles, X } from 'lucide-react';
import { BACKGROUND_COLORS, customSizes, fontCss, sanitizeTextStyle } from '../../shared/text-style.js';
import type { TextAlign, TextStyle } from '../../shared/text-style';
import { bridge } from '../live/bridge';
import { useUi } from '../state/ui';
import { useAnnT } from './strings';
import { ColorField, StyleToolbar } from './StyleControls';
import { autoPaginateText, BREAK, pagesOf, SLIDE_W, TEXT_FONT_SHARE, withFitter } from './paginate';

const api = bridge.announcements;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A pixel size on the 1920 slide, as a container width. The preview scales the way the projector scales with the window. */
const cqw = (px: number) => `${px / 19.2}cqw`;
const ALIGN_ITEMS: Record<TextAlign, string> = { left: 'items-start', center: 'items-center', right: 'items-end' };

/**
 * A 16:9 slide drawn with its typography and background. The projector applies the same style, so the preview is what the
 * screen shows. With no chosen size or style, it keeps the projector's default look.
 */
export function SlidePreview({
  text,
  headline = null,
  bgSrc,
  className = '',
  style = null,
}: {
  text: string;
  headline?: string | null;
  bgSrc: string | null;
  className?: string;
  style?: TextStyle | null;
}) {
  const align = style?.textAlign ?? 'center';
  const sizes = customSizes(style);
  const bodySize = sizes ? cqw(sizes.body) : headline ? '3.2cqw' : '4.1cqw';
  const headSize = sizes ? cqw(sizes.headline) : '5.2cqw';
  const color = style?.textColor ?? '#FFFFFF';
  const family = fontCss(style);

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ containerType: 'inline-size', backgroundColor: bgSrc ? undefined : (style?.bgColor ?? '#000000') }}
    >
      {bgSrc && (
        <>
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bgSrc}")`, backgroundSize: 'cover' }} />
          <div className="absolute inset-0 bg-black/60" />
        </>
      )}
      <div className={`absolute inset-[7%] flex flex-col justify-center gap-[3cqw] ${ALIGN_ITEMS[align]}`} style={{ textAlign: align }}>
        {headline && (
          <p className="leading-tight font-bold" style={{ color, fontFamily: family, fontSize: headSize }}>
            {headline}
          </p>
        )}
        {text && (
          <p className="whitespace-pre-line leading-[1.22] font-medium" style={{ color, fontFamily: family, fontSize: bodySize }}>
            {text}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Creates text slides from pasted or typed text. The style controls (font, size, colour, alignment, background) apply to
 * every page of the sequence, and the preview shows exactly what the projector will draw.
 */
export function TextSlideModal({
  folderId,
  onClose,
  onSaved,
}: {
  folderId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useAnnT();
  const lang = useUi((s) => s.lang);
  const [master, setMaster] = useState('');
  const [bgName, setBgName] = useState<string | null>(null);
  const [style, setStyle] = useState<TextStyle>({ fontFamily: 'sans' });
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);


  const pages = pagesOf(master);
  const current = Math.min(pageIndex, Math.max(pages.length - 1, 0));
  const bgSrc = bgName ? `apcc-media://bg/${bgName}` : null;
  // The style as it will be saved and drawn: anything out of range is dropped here, as in the main process.
  const checked = sanitizeTextStyle(style);
  const update = (patch: TextStyle) => setStyle((s) => ({ ...s, ...patch }));



  /** Cancel removes a background that was uploaded for this session and never saved. */
  const cancel = () => {
    if (bgName) void api.discardBackground(bgName);
    onClose();
  };

  /** Auto-pagination measures with the chosen font and size, so each page fits at the size the operator picked. */
  const autoPaginate = () => {
    setError(null);
    const sizes = customSizes(checked);
    const measure = sizes
      ? { fontFamily: fontCss(checked) ?? 'var(--font-sans)', fontWeight: '500', fontSize: sizes.body }
      : { fontFamily: 'var(--font-sans)', fontWeight: '500', fontSize: SLIDE_W * TEXT_FONT_SHARE };
    setMaster(withFitter((fits) => autoPaginateText(master, fits), 0.8, 'sans', measure));
  };

  /** Inserts a manual break where the cursor sits. */
  const insertBreak = () => {
    const el = editor.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const before = master.slice(0, start).replace(/\s+$/, '');
    const after = master.slice(end).replace(/^\s+/, '');
    setMaster(`${before}\n${BREAK}\n${after}`);
  };

  const pickBackground = async () => {
    setError(null);
    try {
      const name = await api.pickBackground(lang);
      if (!name) return;
      if (bgName) await api.discardBackground(bgName);
      setBgName(name);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createTextSlides(folderId, pages, bgName, checked);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const button =
    'flex h-9 items-center gap-2 rounded-md border border-line-strong px-3 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-label={tr('modalTitle')}>
      <div className="flex max-h-full w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel">
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-2xl font-black uppercase condensed">{tr('modalTitle')}</h2>
          <button type="button" onClick={cancel} aria-label={tr('cancel')} className="text-muted hover:text-fg">
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3">
            <StyleToolbar style={style} onChange={update} />

            <label htmlFor="ann-text" className="eyebrow">{tr('textLabel')}</label>
            <textarea
              id="ann-text"
              ref={editor}
              value={master}
              onChange={(e) => setMaster(e.target.value)}
              rows={12}
              spellCheck={false}
              className="min-h-[240px] resize-y rounded-md border border-line-strong bg-canvas p-3 font-mono text-sm leading-relaxed outline-none focus:border-accent"
            />
            <p className="text-xs text-faint">{tr('textHint')}</p>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={autoPaginate} disabled={!master.trim()} className={button}>
                <Sparkles size={14} aria-hidden /> {tr('autoPaginate')}
              </button>
              <button type="button" onClick={insertBreak} disabled={!master.trim()} className={button}>
                <Scissors size={14} aria-hidden /> {tr('insertBreak')}
              </button>
              <button type="button" onClick={pickBackground} className={button}>
                <ImagePlus size={14} aria-hidden /> {bgName ? tr('changeBackground') : tr('uploadBackground')}
              </button>
              {bgName && (
                <button type="button" onClick={() => { void api.discardBackground(bgName); setBgName(null); }} className={button}>
                  <X size={14} aria-hidden /> {tr('removeBackground')}
                </button>
              )}
            </div>

            {/* Background colour: used when no background image is set. */}
            <ColorField
              label="Background colour"
              prefix="Background"
              value={style.bgColor}
              presets={BACKGROUND_COLORS}
              onChange={(hex) => update({ bgColor: hex })}
              clearLabel="No colour"
            />

          </section>

          <section className="flex min-w-0 flex-col gap-3">
            <div className="eyebrow">{tr('preview')}</div>
            <SlidePreview
              text={pages[current] ?? tr('noText')}
              bgSrc={bgSrc}
              style={checked}
              className="aspect-video w-full rounded-lg border border-line-strong"
            />
            {pages.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => setPageIndex(Math.max(current - 1, 0))} disabled={current === 0} className={button}>
                  <ChevronLeft size={14} aria-hidden /> {tr('prev')}
                </button>
                <span className="font-mono text-xs text-muted">{tr('pageOf', { n: current + 1, total: pages.length })}</span>
                <button
                  type="button"
                  onClick={() => setPageIndex(Math.min(current + 1, pages.length - 1))}
                  disabled={current >= pages.length - 1}
                  className={button}
                >
                  {tr('next')} <ChevronRight size={14} aria-hidden />
                </button>
              </div>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line px-6 py-4">
          <p role="alert" className="min-h-5 text-sm text-danger">{error}</p>
          <div className="flex gap-3">
            <button type="button" onClick={cancel} className="h-10 rounded-md px-4 text-xs font-bold uppercase text-muted hover:text-fg">
              {tr('cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || pages.length === 0}
              className="h-10 rounded-md bg-accent px-5 text-[13px] font-extrabold uppercase condensed text-on-accent hover:brightness-105 disabled:opacity-40"
            >
              {tr('saveSequence', { n: pages.length })}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
