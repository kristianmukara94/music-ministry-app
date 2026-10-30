import { useEffect, useState, type DragEvent } from 'react';
import { FileDown, FileUp, Layers, Monitor, Pencil, Plus, Trash2 } from 'lucide-react';
import { templateStart } from './templates';
import { bridge } from '../live/bridge';
import { dispatch } from '../live/store';
import { SlideCanvas } from './SlideCanvas';
import { SlideEditorModal } from './SlideEditorModal';
import { TemplateModal, type TemplateId } from './TemplateModal';
import type { WhiteboardSlide, WhiteboardSlideInput } from './types';

const api = bridge.whiteboard;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A fresh starting point: the sermon outline and the default design. */
const blank = (template: TemplateId = 'sermon'): WhiteboardSlideInput => templateStart(template);

/** Moves the slide with `fromId` to where `toId` is, and renumbers nothing: the order is the list's order. */
function moveSlide(list: WhiteboardSlide[], fromId: number, toId: number) {
  const from = list.findIndex((s) => s.id === fromId);
  const to = list.findIndex((s) => s.id === toId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The Whiteboard: the operator's own slides, built from templates and edited in the customizer. */
export function WhiteboardDeck() {
  const [slides, setSlides] = useState<WhiteboardSlide[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // The editor's draft. `key` changes when a template replaces the draft, so the editor starts again from it.
  const [editor, setEditor] = useState<{ key: number; mode: 'create' | 'edit'; initial: WhiteboardSlideInput } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropId, setDropId] = useState<number | null>(null);

  const reload = () =>
    api
      .list()
      .then(setSlides)
      .catch((err) => setError(errorText(err)));

  useEffect(() => {
    void reload();
  }, []);

  /** Puts one slide on the screen, as a full slide, straight away. */
  const project = (slide: WhiteboardSlide) => {
    dispatch({ type: 'projector/stage', frame: { kind: 'whiteboard', slide: { title: slide.title, content: slide.content, design: slide.design } } });
    dispatch({ type: 'projector/take' });
  };

  const openNew = () => setEditor({ key: Date.now(), mode: 'create', initial: blank() });

  const openEdit = (slide: WhiteboardSlide) =>
    setEditor({ key: Date.now(), mode: 'edit', initial: { id: slide.id, title: slide.title, content: slide.content, design: slide.design } });

  /** A template either starts a new slide or replaces the draft of the one being made. */
  const pickTemplate = (id: TemplateId) => {
    setTemplatesOpen(false);
    setEditor((current) =>
      current
        ? { key: Date.now(), mode: current.mode, initial: { ...blank(id), id: current.initial.id, design: current.initial.design } }
        : { key: Date.now(), mode: 'create', initial: blank(id) },
    );
  };

  const saveSlide = async (input: WhiteboardSlideInput) => {
    await api.save(input);
    setEditor(null);
    setError(null);
    await reload();
  };

  const remove = async (slide: WhiteboardSlide) => {
    if (!window.confirm(`Delete "${slide.title}"? This cannot be undone.`)) return;
    try {
      await api.remove(slide.id);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const importPowerPoint = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const added = await api.importPowerPoint();
      if (added > 0) setNotice(`Added ${added} ${added === 1 ? 'slide' : 'slides'} from PowerPoint.`);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Drag and drop reorders instantly, then saves the order. A failed save puts the old order back. */
  const dropOn = (target: WhiteboardSlide) => {
    const from = dragId;
    setDragId(null);
    setDropId(null);
    if (from == null || from === target.id) return;
    const previous = slides;
    const next = moveSlide(slides, from, target.id);
    setSlides(next);
    api.reorder(next.map((s) => s.id)).catch((err) => {
      setSlides(previous);
      setError(errorText(err));
    });
  };

  const onDragStart = (e: DragEvent, slide: WhiteboardSlide) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragId(slide.id);
  };

  const count = slides.length;

  return (
    <div className="flex min-h-[calc(100vh-88px)] flex-col">
      {/* Header: the category, the title, the status line, and the actions. */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-5 px-6 pt-5 pb-3">
        <div>
          <div className="text-sm font-semibold tracking-wider text-accent uppercase">Slide builder</div>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">Whiteboard</h1>
          <p className="mt-1 text-sm text-fg/70">Create sermon notes and bulletin points</p>
          <p className="mt-2 font-mono text-xs text-fg/50">
            {count} {count === 1 ? 'slide' : 'slides'} • Drag to reorder • Double-click to project
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTemplatesOpen(true)} className="flex h-10 items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-3 text-xs font-bold tracking-wider text-fg/90 uppercase transition-colors hover:border-accent/40 hover:text-accent">
            <Layers size={14} aria-hidden /> Templates
          </button>
          <button
            type="button"
            disabled
            title="PowerPoint export is not available yet."
            className="flex h-10 items-center gap-2 rounded-lg border border-line bg-panel-2/60 px-3 text-xs font-bold tracking-wider text-fg/50 uppercase opacity-60"
          >
            <FileDown size={14} aria-hidden /> Export PowerPoint
          </button>
          <button type="button" onClick={importPowerPoint} disabled={busy} className="flex h-10 items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-3 text-xs font-bold tracking-wider text-fg/90 uppercase transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40">
            <FileUp size={14} aria-hidden /> {busy ? 'Importing…' : 'Import PowerPoint'}
          </button>
          <button type="button" onClick={openNew} className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110">
            <Plus size={14} aria-hidden /> New slide
          </button>
        </div>
      </header>

      {error && <div role="alert" className="border-b border-danger/40 bg-danger/10 px-6 py-2 text-sm whitespace-pre-line text-danger">{error}</div>}
      {notice && !error && <div role="status" className="border-b border-line px-6 py-2 text-sm text-fg/80">{notice}</div>}

      <div className="flex min-h-0 flex-1">
        {/* Library: the slides, as one folder. */}
        <aside className="flex max-h-full w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-4">
          <div className="text-[11px] font-bold tracking-[0.2em] text-fg/50 uppercase">Library</div>
          <div className="flex items-center justify-between gap-2 rounded-md border-l-2 border-accent bg-accent/10 px-3 py-2.5 text-sm font-semibold text-accent">
            <span>All slides</span>
            <span className="rounded-full border border-accent/30 bg-panel px-2 py-0.5 font-mono text-xs text-accent tabular-nums">{count}</span>
          </div>
        </aside>

        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
          {slides.length === 0 ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-fg/20 bg-panel-2/40 p-10 text-center">
              <div className="grid size-16 place-items-center rounded-xl border border-accent/30 bg-panel text-accent">
                <Monitor size={26} aria-hidden />
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-tight text-fg">No slides yet</h2>
              <p className="mt-2 max-w-md text-sm text-fg/60">Create a slide, or import a PowerPoint (.pptx) to turn its text into editable slides.</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={openNew} className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 hover:brightness-110">
                  <Plus size={14} aria-hidden /> New slide
                </button>
                <button type="button" onClick={importPowerPoint} disabled={busy} className="flex h-10 items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-4 text-xs font-bold tracking-wider text-fg/90 uppercase hover:border-accent/40 hover:text-accent disabled:opacity-40">
                  <FileUp size={14} aria-hidden /> Import PowerPoint
                </button>
              </div>
              <p className="mt-6 max-w-lg text-xs text-fg/50">
                To show a deck exactly as designed, import it in Announcements instead: each slide becomes a full-quality image.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              {slides.map((slide, i) => (
                <li
                  key={slide.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, slide)}
                  onDragOver={(e) => {
                    if (dragId == null) return;
                    e.preventDefault();
                    setDropId(slide.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(slide);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropId(null);
                  }}
                  className={`group relative rounded-lg transition ${dropId === slide.id ? 'ring-2 ring-accent' : ''} ${dragId === slide.id ? 'opacity-40' : ''}`}
                >
                  <button
                    type="button"
                    onDoubleClick={() => project(slide)}
                    aria-label={`${slide.title}. Double-click to project.`}
                    className="flex w-full flex-col overflow-hidden rounded-lg border border-line bg-panel-2 text-left transition-colors hover:border-accent/40"
                  >
                    <div className="relative">
                      <SlideCanvas slide={slide} className="aspect-video w-full" />
                      <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-bold text-fg/90">{i + 1}</span>
                    </div>
                    <div className="truncate px-3 py-2 text-sm font-semibold text-fg">{slide.title}</div>
                  </button>
                  <div className="absolute top-2 right-2 hidden gap-1 group-hover:flex">
                    <button type="button" onClick={() => openEdit(slide)} aria-label={`Edit ${slide.title}`} className="grid size-7 place-items-center rounded bg-black/75 text-fg/90 hover:text-accent">
                      <Pencil size={13} aria-hidden />
                    </button>
                    <button type="button" onClick={() => remove(slide)} aria-label={`Delete ${slide.title}`} className="grid size-7 place-items-center rounded bg-black/75 text-fg/90 hover:text-danger">
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editor && (
        <SlideEditorModal
          key={editor.key}
          mode={editor.mode}
          initial={editor.initial}
          onSave={saveSlide}
          onClose={() => setEditor(null)}
          onUseTemplate={() => setTemplatesOpen(true)}
        />
      )}
      {templatesOpen && <TemplateModal onPick={pickTemplate} onClose={() => setTemplatesOpen(false)} />}
    </div>
  );
}
