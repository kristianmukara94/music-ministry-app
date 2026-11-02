import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, FileUp, Loader2, Radio, TriangleAlert, Type, Wand2, X } from 'lucide-react';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { bulletMark, parseSlideContent, sanitizeTextBox, SLIDE_DESIGN_DEFAULTS, type WhiteboardDesign, type WhiteboardTextBox } from '../../shared/whiteboard.js';
import { TEXT_FONTS } from '../../shared/text-style.js';
import { notifyWhiteboardChanged } from '../whiteboard/changes';
import { errorText } from '../whiteboard/errors';
import { BackgroundImageGroup, type SlidePicture } from '../whiteboard/SlideForm';
import { TextBoxEditor } from '../whiteboard/TextBoxEditor';
import type { WhiteboardSlide } from '../whiteboard/types';
import type { GoLiveT } from './strings';

const api = bridge.whiteboard;

/** How long after the last keystroke an edit is saved, and sent to the projector. */
const SAVE_DELAY_MS = 400;
const PROJECT_DELAY_MS = 120;

type Status = 'idle' | 'saving' | 'saved' | 'error';
interface Draft {
  title: string;
  content: string;
  design: WhiteboardDesign;
}

/** Where the editor lives: its own window (the normal case), or a panel docked to the side where windows cannot be opened. */
export type EditorLayout = 'window' | 'panel';

/**
 * The starting point for a PowerPoint slide that is about to be edited. A slide that was taken apart on import starts as it looks: its
 * background without the words, and each of its words in a text box in its place, with its own font, size and colour, all ready to change.
 * Otherwise it starts with its text when the import kept it, the default design and no heading (the slide's own first line is its heading);
 * and a slide whose words were not kept starts with its picture as the background, so it still looks as it did while words are typed over it.
 */
function draftForPicture(slide: WhiteboardSlide): Draft {
  if (slide.layers) {
    return {
      title: slide.title,
      content: '',
      design: { ...SLIDE_DESIGN_DEFAULTS, titleVisible: false, bgImage: slide.layers.background, bgFit: 'stretch', bgDim: 0, boxes: slide.layers.boxes },
    };
  }
  const hasText = slide.content.trim().length > 0;
  const design: WhiteboardDesign = { ...SLIDE_DESIGN_DEFAULTS, titleVisible: false };
  if (!hasText && slide.image) Object.assign(design, { bgImage: slide.image, bgFit: 'contain', bgDim: 0 });
  return { title: slide.title, content: slide.content, design };
}

/** The first font name in a CSS font list, for a text box. */
const fontNameOf = (css: string | undefined) => (css ?? '').split(',')[0].replace(/["']/g, '').trim() || 'Segoe UI';

/**
 * A slide's title and text, which the slide lays out by itself, as text boxes in the same places and with the same look, so they can be edited
 * like any other text on the slide. Bullets keep their marks.
 */
export function flowToBoxes(title: string, content: string, d: WhiteboardDesign): WhiteboardTextBox[] {
  const font = fontNameOf(TEXT_FONTS[d.fontFamily as keyof typeof TEXT_FONTS]?.css);
  const boxes: WhiteboardTextBox[] = [];
  const showTitle = d.titleVisible && title.trim().length > 0;
  if (showTitle) {
    boxes.push(sanitizeTextBox({ text: title, x: 7, y: 7, w: 86, h: 14, size: d.titleSize, font, color: d.textColor, bold: d.titleBold, italic: d.titleItalic, align: d.align, valign: 'top' }));
  }
  const lines = parseSlideContent(content).map((item, i) => {
    const mark = item.bullet ? bulletMark(d.bulletStyle, i) : '';
    return mark ? `${mark} ${item.text}` : item.text;
  });
  if (lines.length > 0) {
    const top = showTitle ? 24 : 7;
    boxes.push(sanitizeTextBox({ text: lines.join('\n'), x: 7, y: top, w: 86, h: 93 - top, size: d.fontSize, font, color: d.textColor, bold: d.bodyBold, italic: d.bodyItalic, align: d.align, valign: 'top' }));
  }
  return boxes;
}

/**
 * Edits one Whiteboard slide. It normally fills a window of its own, so it can be moved, resized and put on another screen while Go Live stays
 * in view. Every change saves a moment after typing stops, and while the slide is on the projector each change is sent there too, so the
 * congregation sees the edit as it is made.
 *
 * Everything on the slide is edited the same way: every text is a text box, and behind them is the background picture. A PowerPoint slide is a
 * picture until its first change, which turns it into an editable slide in place.
 */
export function LiveSlideEditor({
  slide,
  layout = 'window',
  onClose,
  t,
}: {
  slide: WhiteboardSlide;
  layout?: EditorLayout;
  onClose: () => void;
  t: GoLiveT;
}) {
  // The PowerPoint picture behind this slide, if it ever was one: offered as a background.
  const originalPicture = slide.image ?? slide.originalImage;
  const startsAsPicture = slide.image != null;
  const [draft, setDraft] = useState<Draft>(() =>
    startsAsPicture ? draftForPicture(slide) : { title: slide.title, content: slide.content, design: slide.design },
  );
  // True until the first change turns a PowerPoint slide into an editable one.
  const stillPicture = useRef(startsAsPicture);
  const [status, setStatus] = useState<Status>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  // The slide taken apart: from the import, or read again from its PowerPoint file while the editor is open.
  const [layers, setLayers] = useState(slide.layers);
  // For a PowerPoint slide imported before slides were taken apart: the file its words can be read again from.
  const [source, setSource] = useState<{ file: string; slideNo: number } | null>(null);
  const [reading, setReading] = useState(false);
  const [inspectorHost, setInspectorHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!originalPicture || slide.layers) return;
    api
      .pptxSource(slide.id)
      .then(setSource)
      .catch(() => setSource(null));
  }, []);

  const latest = useRef(draft);
  const saveTimer = useRef<number | undefined>(undefined);
  const projectTimer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  const serial = useRef(0);
  const lastSent = useRef<{ title: string; content: string } | null>(null);

  /** Whether the projector shows the text slide at the moment: the one last sent from here, or else the slide as it was saved. */
  const onProjector = () => {
    const state = useLive.getState().state;
    const frame = state.projector.live;
    if (!state.outputs.projector || frame.kind !== 'whiteboard') return false;
    const known = lastSent.current ?? { title: slide.title, content: slide.content };
    return frame.slide.title === known.title && frame.slide.content === known.content;
  };

  // Seen once on open, so the panel can say the slide is on air before anything is typed.
  useEffect(() => {
    if (!startsAsPicture) setPushing(onProjector());
  }, []);

  const save = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const cur = latest.current;
    // A slide needs a title: until one is typed, nothing is written and the last good version stays.
    if (!cur.title.trim()) {
      setStatus('idle');
      return Promise.resolve();
    }
    const mine = ++serial.current;
    setStatus('saving');
    const run = (async () => {
      try {
        if (stillPicture.current) {
          // The first change: the PowerPoint slide becomes an editable slide, right where it is.
          await api.makeEditable(slide.id, { title: cur.title, content: cur.content, design: cur.design });
          stillPicture.current = false;
        } else {
          await api.save({ id: slide.id, title: cur.title, content: cur.content, design: cur.design });
        }
        notifyWhiteboardChanged();
        if (mine === serial.current) {
          setStatus('saved');
          setProblem(null);
        }
      } catch (err) {
        if (mine === serial.current) {
          setStatus('error');
          setProblem(errorText(err));
        }
      }
    })();
    inflight.current = run;
    return run;
  };

  /** Waits for anything still being written, and writes what is waiting. Used before the editor goes away. */
  const settle = async () => {
    if (saveTimer.current !== undefined) await save();
    else await inflight.current;
  };

  /** Sends the draft to the projector when this slide is the one on it. */
  const project = () => {
    projectTimer.current = undefined;
    const cur = latest.current;
    if (stillPicture.current || !onProjector()) return;
    lastSent.current = { title: cur.title || 'Untitled slide', content: cur.content };
    dispatch({ type: 'projector/stage', frame: { kind: 'whiteboard', slide: { title: lastSent.current.title, content: cur.content, design: cur.design } } });
    dispatch({ type: 'projector/take' });
  };

  const update = (patch: Partial<Draft>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
    window.clearTimeout(projectTimer.current);
    projectTimer.current = window.setTimeout(project, PROJECT_DELAY_MS);
    setPushing(!stillPicture.current && onProjector());
  };

  // Leaving the editor writes any change still waiting.
  useEffect(
    () => () => {
      window.clearTimeout(projectTimer.current);
      if (saveTimer.current !== undefined) void save();
    },
    [],
  );

  // The window is being closed: the main process asks for pending changes to be written, then waits for the word that they are.
  useEffect(() => {
    if (layout !== 'window') return undefined;
    return api.onEditorFlush(() => {
      void settle().finally(() => api.editorFlushed());
    });
  }, []);

  const close = () => {
    if (layout === 'window') {
      // The main process closes the window, and asks the page to write anything waiting first, so no change is lost.
      api.closeEditor();
      return;
    }
    if (saveTimer.current !== undefined) void save();
    onClose();
  };

  // Escape closes the editor, unless a dialog or picker on top of it is what Escape was meant for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The window's title names the slide, so several open editors can be told apart in the taskbar.
  useEffect(() => {
    if (layout === 'window') document.title = `${t('editorHeading')} — ${draft.title || '…'} · APCCMMA`;
  }, [draft.title, layout]);

  /**
   * Reads the slide's words again from its PowerPoint file, which the operator chooses, and puts them on the slide as text boxes over its
   * background without words. Every slide from that file is taken apart at the same time, so the file is chosen only once.
   */
  const readFromFile = async () => {
    setReading(true);
    setProblem(null);
    try {
      const updated = await api.layersFromFile(slide.id);
      if (!updated?.layers) return;
      const parts = updated.layers;
      setLayers(parts);
      update({
        content: '',
        design: { ...latest.current.design, titleVisible: false, bgImage: parts.background, bgFit: 'stretch', bgDim: 0, boxes: parts.boxes },
      });
    } catch (err) {
      setStatus('error');
      setProblem(errorText(err));
    } finally {
      setReading(false);
    }
  };

  // The slide's own title and text, laid out by the slide rather than placed in boxes.
  const hasFlowText = (draft.design.titleVisible && draft.title.trim().length > 0) || draft.content.trim().length > 0;
  /** Turns the slide's laid-out title and text into text boxes, so every word on it is edited the same way. The title stays as its name. */
  const flowIntoBoxes = () => {
    const cur = latest.current;
    const added = flowToBoxes(cur.title, cur.content, cur.design);
    update({ content: '', design: { ...cur.design, titleVisible: false, boxes: [...cur.design.boxes, ...added] } });
  };

  const preview = { title: draft.title || 'Untitled slide', content: draft.content, design: draft.design };
  // A slide from PowerPoint can use its background without the words, or its whole picture, as its background.
  const slidePictures: SlidePicture[] = [
    ...(layers ? [{ src: layers.background, label: t('editorBgNoWords') }] : []),
    ...(originalPicture ? [{ src: originalPicture, label: t('editorBgWithWords') }] : []),
  ];

  const notice = (icon: ReactNode, heading: string, info: string, button: ReactNode, label: string) => (
    <section aria-label={label} className="flex flex-wrap items-center gap-4 rounded-lg border-2 border-accent/60 bg-accent/10 p-4">
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-sm font-bold text-fg">{heading}</h3>
        <p className="text-xs text-fg/75">{info}</p>
      </div>
      {button}
    </section>
  );
  const noticeButton = 'inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-60';

  // A PowerPoint slide imported as a picture only: its words can still be made editable, from its file.
  const readBlock =
    originalPicture && !layers && source
      ? notice(
          <Wand2 size={22} className="shrink-0 text-accent" aria-hidden />,
          t('editorReadHeading'),
          t('editorReadInfo', { file: source.file }),
          <button type="button" onClick={() => void readFromFile()} disabled={reading} className={noticeButton}>
            {reading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FileUp size={15} aria-hidden />}
            {reading ? t('editorReadBusy') : t('editorReadButton')}
          </button>,
          t('editorReadHeading'),
        )
      : null;

  // A slide whose title and text are laid out for it: one press puts them in text boxes.
  const flowBlock =
    hasFlowText && !readBlock
      ? notice(
          <Type size={22} className="shrink-0 text-accent" aria-hidden />,
          t('editorFlowHeading'),
          t('editorFlowInfo'),
          <button type="button" onClick={flowIntoBoxes} className={noticeButton}>
            <Type size={15} aria-hidden /> {t('editorFlowButton')}
          </button>,
          t('editorFlowHeading'),
        )
      : null;

  const slideBlock = (
    <div className="flex flex-col gap-3">
      {readBlock}
      {flowBlock}
      <TextBoxEditor
        slide={preview}
        onBoxes={(boxes) => update({ design: { ...latest.current.design, boxes } })}
        onEditPart={() => flowIntoBoxes()}
        inspectorHost={inspectorHost}
        heading={t('editorSlideHeading')}
        badge={
          pushing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/50 bg-danger/15 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-danger uppercase">
              <Radio size={11} className="animate-pulse" aria-hidden /> {t('editorOnAir')}
            </span>
          ) : null
        }
      />
      <p className="text-xs text-fg/55">{layout === 'window' ? t('editorWindowHint') : t('editorHint')}</p>
    </div>
  );

  // The controls: the selected text box's, then the background picture.
  const controls = (
    <div className="flex flex-col gap-4">
      <div ref={setInspectorHost} />
      <BackgroundImageGroup design={draft.design} slidePictures={slidePictures} allowDim={false} onDesign={(patch) => update({ design: { ...latest.current.design, ...patch } })} />
    </div>
  );

  const statusLine: ReactNode =
    status === 'saving' ? (
      <span className="flex items-center gap-2 text-fg/70">
        <Loader2 size={15} className="animate-spin" aria-hidden /> {t('editorSaving')}
      </span>
    ) : status === 'error' ? (
      <span className="flex min-w-0 items-center gap-2 text-danger">
        <TriangleAlert size={15} className="shrink-0" aria-hidden /> <span className="truncate">{t('editorFailed', { error: problem ?? '' })}</span>
      </span>
    ) : status === 'saved' ? (
      <span className="flex items-center gap-2 text-ok">
        <Check size={15} aria-hidden /> {t('editorSaved')}
      </span>
    ) : null;

  const doneButton = (
    <button
      type="button"
      onClick={close}
      className="rounded-lg bg-accent px-5 py-2 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
    >
      {t('editorDone')}
    </button>
  );

  // The window: the slide on the left, its controls on the right, both always in view.
  if (layout === 'window') {
    return (
      <div className="flex h-screen min-h-0 flex-col bg-canvas text-fg">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-3">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-base font-bold tracking-tight">{t('editorHeading')}</h1>
            <p className="truncate text-sm text-fg/65" title={draft.title}>
              {draft.title || '—'}
            </p>
          </div>
          <p role="status" aria-live="polite" className="flex min-w-0 items-center text-sm">
            {statusLine}
          </p>
        </header>
        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)] lg:overflow-hidden">
          <div className="min-h-0 lg:overflow-y-auto lg:pr-2">{slideBlock}</div>
          <div className="min-h-0 lg:overflow-y-auto lg:pr-2">{controls}</div>
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-6 py-3">{doneButton}</footer>
      </div>
    );
  }

  // The docked panel: used where a window cannot be opened. The slide, then its controls below.
  return (
    <aside
      aria-label={t('editorHeading')}
      className="fixed top-[var(--topbar-h,48px)] right-0 z-[35] flex h-[calc(100vh-var(--topbar-h,48px))] w-[min(580px,100vw)] flex-col border-l border-line bg-canvas shadow-2xl shadow-black/60"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-bold tracking-tight text-fg">{t('editorHeading')}</h2>
          <p className="truncate text-sm text-fg/65" title={slide.title}>
            {draft.title || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={t('editorClose')}
          title={t('editorClose')}
          className="grid size-9 shrink-0 place-items-center rounded-md border border-fg/20 text-fg/70 transition hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {slideBlock}
        {controls}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p role="status" aria-live="polite" className="flex min-w-0 items-center text-sm">
          {statusLine}
        </p>
        {doneButton}
      </footer>
    </aside>
  );
}
