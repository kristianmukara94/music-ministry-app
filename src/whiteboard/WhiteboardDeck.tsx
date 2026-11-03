import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Check, Type, Copy, FileUp, FolderInput, Folder, Inbox, Layers, ListPlus, Monitor, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { addToQueue } from '../planner/plan-api';
import { templateStart } from './templates';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { SlideCanvas } from './SlideCanvas';
import { notifyWhiteboardChanged } from './changes';
import { errorText } from './errors';
import { FolderRail, type FolderView } from './FolderRail';
import { ImportProgressBar } from './ImportProgressBar';
import { usePowerPointImport } from './usePowerPointImport';
import { projectWhiteboardSlide } from './projectSlide';
import { SlideEditorModal } from './SlideEditorModal';
import { TemplateModal, type TemplateId } from './TemplateModal';
import type { WhiteboardFolder, WhiteboardSlide, WhiteboardSlideInput } from './types';

const api = bridge.whiteboard;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A copy of the set with `ids` removed. */
function without(set: Set<number>, ids: number[]): Set<number> {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

/** A copy of the set with `id` added when absent, or removed when present. */
function toggled(set: Set<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

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

const HEADER_BTN =
  'flex h-10 items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-3 text-xs font-bold tracking-wider text-fg/90 uppercase transition-colors hover:border-accent/40 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40';
const HEADER_PRIMARY =
  'flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';

/** The list of folders a slide can move to. Closes on Escape or a click outside. The slide's own folder is marked and cannot be chosen. */
function MoveMenu({
  folders,
  current,
  onPick,
  onClose,
}: {
  folders: WhiteboardFolder[];
  current: number | null;
  onPick: (folderId: number | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const item = (label: string, id: number | null, icon: typeof Folder) => {
    const Icon = icon;
    const here = id === current;
    return (
      <button
        key={id ?? 'unfiled'}
        type="button"
        role="menuitem"
        disabled={here}
        onClick={() => onPick(id)}
        className="flex min-h-9 w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-fg/90 transition hover:bg-fg/10 focus-visible:bg-fg/10 focus-visible:outline-none disabled:cursor-default disabled:text-fg/45 disabled:hover:bg-transparent"
      >
        <Icon size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {here && <Check size={14} className="shrink-0 text-accent" aria-label="Current folder" />}
      </button>
    );
  };

  return (
    <div ref={ref} role="menu" aria-label="Move to folder" className="absolute top-11 right-2 z-30 flex max-h-64 w-56 flex-col gap-0.5 overflow-y-auto rounded-lg border border-fg/20 bg-panel p-1.5 shadow-xl shadow-black/50">
      <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold tracking-wider text-fg/50 uppercase">Move to folder</p>
      {folders.map((f) => item(f.name, f.id, Folder))}
      {item('Unfiled', null, Inbox)}
    </div>
  );
}

/** The Whiteboard: the operator's own slides, built from templates or imported from PowerPoint, kept in folders. */
export function WhiteboardDeck() {
  const [slides, setSlides] = useState<WhiteboardSlide[]>([]);
  const [folders, setFolders] = useState<WhiteboardFolder[]>([]);
  const [view, setView] = useState<FolderView>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // The editor's draft. `key` changes when a template replaces the draft, so the editor starts again from it.
  const [editor, setEditor] = useState<{ key: number; mode: 'create' | 'edit'; initial: WhiteboardSlideInput } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropId, setDropId] = useState<number | null>(null);
  const [moveFor, setMoveFor] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Slides picked for a bulk action, and the slide whose title is being edited (with its draft text).
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const live = useLive((s) => s.state.projector.live);

  // A confirmation fades after a few seconds, so it never lingers over later work.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reload = () =>
    Promise.all([api.list(), api.folders()])
      .then(([list, folderList]) => {
        setSlides(list);
        setFolders(folderList);
        // A selected slide that no longer exists (deleted elsewhere) is dropped from the selection.
        setChecked((current) => new Set([...current].filter((id) => list.some((s) => s.id === id))));
        notifyWhiteboardChanged();
      })
      .catch((err) => setError(errorText(err)));

  useEffect(() => {
    void reload();
  }, []);

  // A folder that is gone (deleted here or elsewhere) cannot stay open.
  useEffect(() => {
    if (typeof view === 'number' && !folders.some((f) => f.id === view)) setView('all');
  }, [folders, view]);

  // Where a new slide or an import goes: the open folder, otherwise Unfiled.
  const folderId = typeof view === 'number' ? view : null;
  const openFolder = typeof view === 'number' ? folders.find((f) => f.id === view) : undefined;
  const destination = openFolder?.name ?? 'Unfiled';
  const folderName = (id: number | null) => (id == null ? 'Unfiled' : (folders.find((f) => f.id === id)?.name ?? 'a folder'));
  const viewTitle = view === 'all' ? 'All slides' : view === 'unfiled' ? 'Unfiled' : (openFolder?.name ?? '');

  /** Puts one slide on the screen, as a full slide, straight away. */
  const project = (slide: WhiteboardSlide) => projectWhiteboardSlide(slide, slides);

  /** Adds a PowerPoint slide to the Service Queue, which is what Go Live plays. The queue's plan is the one that receives it. */
  const addToGoLive = async (slide: WhiteboardSlide) => {
    if (slide.slideId == null) return;
    setError(null);
    try {
      await addToQueue([{ block: 'word', module: 'announcements', sourceId: String(slide.slideId), label: slide.title }]);
      setNotice(`"${slide.title}" added to Go Live.`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** Adds every PowerPoint slide shown to Go Live, in the order they appear. */
  const addAllToGoLive = async () => {
    const pictures = visible.filter((s) => s.slideId != null);
    if (pictures.length === 0) return;
    setError(null);
    try {
      await addToQueue(pictures.map((s) => ({ block: 'word' as const, module: 'announcements' as const, sourceId: String(s.slideId), label: s.title })));
      setNotice(`Added ${plural(pictures.length, 'slide', 'slides')} to Go Live.`);
    } catch (err) {
      setError(errorText(err));
    }
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
    // A new slide goes into the open folder. An existing one keeps the folder it is in.
    await api.save(input.id == null ? { ...input, folderId } : input);
    setEditor(null);
    setError(null);
    await reload();
  };

  const remove = async (slide: WhiteboardSlide) => {
    if (!window.confirm(`Delete "${slide.title}"? This cannot be undone.`)) return;
    try {
      await api.remove(slide.id);
      setChecked((current) => without(current, [slide.id]));
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const toggleChecked = (id: number) => setChecked((current) => toggled(current, id));

  /** Deletes every checked slide after one confirmation. Slides that are already gone are simply not counted. */
  const removeChecked = async () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    const names = slides.filter((s) => checked.has(s.id)).map((s) => s.title);
    const preview = names.slice(0, 3).map((n) => `"${n || 'Untitled slide'}"`).join(', ');
    const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
    if (!window.confirm(`Delete ${plural(ids.length, 'slide', 'slides')}: ${preview}${more}? This cannot be undone.`)) return;
    setError(null);
    try {
      const removed = await api.removeMany(ids);
      setChecked(new Set());
      setNotice(`Deleted ${plural(removed, 'slide', 'slides')}.`);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const startRename = (slide: WhiteboardSlide) => {
    setMoveFor(null);
    setRenameError(null);
    setRenameDraft(slide.title);
    setRenamingId(slide.id);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameError(null);
  };

  /** Saves a new title. An empty or too-long title is refused and the editor stays open with the message. */
  const saveRename = async (slide: WhiteboardSlide) => {
    try {
      await api.rename(slide.id, renameDraft);
      setRenamingId(null);
      setRenameError(null);
      setNotice(`Renamed to "${renameDraft.trim().replace(/\s+/g, ' ')}".`);
      await reload();
    } catch (err) {
      setRenameError(errorText(err));
    }
  };

  /** Saves a copy with its own id, in the same folder, named so it can be told apart from the original. */
  const duplicate = async (slide: WhiteboardSlide) => {
    try {
      await api.save({ title: `${slide.title} (copy)`, content: slide.content, design: slide.design, folderId: slide.folderId });
      setNotice(`Duplicated "${slide.title}".`);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  // The import reports as it goes, so the button can show a bar. A finished import shows a confirmation; a failed one leaves nothing half done and says what to try.
  const powerPoint = usePowerPointImport({
    folderId,
    destination,
    onDone: async (message) => {
      setNotice(message);
      await reload();
    },
    onFail: setError,
  });
  const busy = powerPoint.busy;
  const importPowerPoint = () => {
    setError(null);
    setNotice(null);
    void powerPoint.start();
  };
  /** The button's label: "Import PowerPoint", or the running percentage while an import is under way. */
  const importButtonText = busy ? `Importing… ${powerPoint.progress?.percentage ?? 0}%` : 'Import PowerPoint';

  /** Moves slides to a folder (or Unfiled), then reloads. Says what moved and where. */
  const moveTo = async (ids: number[], target: number | null) => {
    const moving = slides.filter((s) => ids.includes(s.id) && s.folderId !== target);
    if (moving.length === 0) return;
    setError(null);
    setMoveFor(null);
    try {
      await api.move(
        moving.map((s) => s.id),
        target,
      );
      setNotice(`Moved ${moving.length === 1 ? `"${moving[0].title}"` : plural(moving.length, 'slide', 'slides')} to "${folderName(target)}".`);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const createFolder = async (name: string) => {
    const folder = await api.createFolder(name);
    await reload();
    setView(folder.id);
    setNotice(`Folder "${folder.name}" created. Slides you create or import now go into it.`);
  };

  const renameFolder = async (id: number, name: string) => {
    await api.renameFolder(id, name);
    await reload();
  };

  const deleteFolder = async (folder: WhiteboardFolder) => {
    const keep =
      folder.count === 0 ? '' : ` Its ${plural(folder.count, 'slide', 'slides')} ${folder.count === 1 ? 'is' : 'are'} kept and move to Unfiled.`;
    if (!window.confirm(`Delete the folder "${folder.name}"?${keep}`)) return;
    setError(null);
    try {
      await api.deleteFolder(folder.id);
      if (view === folder.id) setView('all');
      setNotice(`Folder "${folder.name}" deleted.${keep}`);
      await reload();
    } catch (err) {
      setError(errorText(err));
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

  const search = query.trim().toLowerCase();
  const inView = useMemo(
    () => slides.filter((s) => (view === 'all' ? true : view === 'unfiled' ? s.folderId == null : s.folderId === view)),
    [slides, view],
  );
  const visible = useMemo(
    () => (search ? inView.filter((s) => s.title.toLowerCase().includes(search) || s.content.toLowerCase().includes(search)) : inView),
    [inView, search],
  );
  const unfiledCount = useMemo(() => slides.filter((s) => s.folderId == null).length, [slides]);
  // Reordering is only meaningful on the whole list, so it is switched off while a search narrows it.
  const reorderable = !search;
  const hasPictures = inView.some((s) => s.slideId != null);

  /** Whether the projector is already showing this slide. */
  const isLive = (slide: WhiteboardSlide) =>
    slide.image ? live.kind === 'image' && live.src === slide.image : live.kind === 'whiteboard' && live.slide.title === slide.title && live.slide.content === slide.content;

  return (
    <div className="flex flex-1 flex-col">
      {/* Header: the category, the title, the status line, and the actions. */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-5 px-6 pt-5 pb-3">
        <div>
          <div className="text-sm font-semibold tracking-wider text-accent uppercase">Slide builder</div>
          <h1 className="mt-1 text-3xl leading-tight font-extrabold tracking-tight text-fg xl:text-4xl">Whiteboard</h1>
          <p className="mt-1 text-sm text-fg/70">Create sermon notes and bulletin points, or import a PowerPoint</p>
          <p className="mt-2 text-xs text-fg/50">
            <span className="tabular-nums">{plural(slides.length, 'slide', 'slides')}</span>
            {folders.length > 0 && (
              <>
                <span aria-hidden> · </span>
                <span className="tabular-nums">{plural(folders.length, 'folder', 'folders')}</span>
              </>
            )}
            <span aria-hidden> · </span>New slides and imports go to <strong className="font-semibold text-fg/75">{destination}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTemplatesOpen(true)} className={HEADER_BTN}>
            <Layers size={14} aria-hidden /> Templates
          </button>
          <button type="button" onClick={importPowerPoint} disabled={busy} className={HEADER_BTN} title={`Import into ${destination}`}>
            <FileUp size={14} aria-hidden /> {importButtonText}
          </button>
          {hasPictures && (
            <button type="button" onClick={() => void addAllToGoLive()} className={HEADER_BTN} title="Adds the PowerPoint slides shown to the Holy Mass Queue">
              <ListPlus size={14} aria-hidden /> Add PowerPoint to Go Live
            </button>
          )}
          <button type="button" onClick={openNew} className={HEADER_PRIMARY} title={`New slide in ${destination}`}>
            <Plus size={14} aria-hidden /> New slide
          </button>
        </div>
      </header>

      {busy && (
        <div className="border-b border-line bg-accent/10 px-6 py-3">
          <ImportProgressBar progress={powerPoint.progress} />
        </div>
      )}
      {error && <div role="alert" className="border-b border-danger/40 bg-danger/10 px-6 py-2 text-sm whitespace-pre-line text-danger">{error}</div>}
      {notice && !error && (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-line bg-accent/10 px-6 py-2 text-sm text-fg/90">
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="grid size-6 place-items-center rounded text-fg/60 hover:text-fg">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <FolderRail
          folders={folders}
          total={slides.length}
          unfiledCount={unfiledCount}
          view={view}
          dragging={dragId != null}
          onView={(next) => {
            setView(next);
            setQuery('');
            setMoveFor(null);
          }}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={(folder) => void deleteFolder(folder)}
          onDropOn={(target) => {
            const id = dragId;
            setDragId(null);
            setDropId(null);
            if (id != null) void moveTo([id], target);
          }}
        />

        <section aria-label={viewTitle} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
          {slides.length === 0 ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-fg/20 bg-panel-2/40 p-10 text-center">
              <div className="grid size-16 place-items-center rounded-xl border border-accent/30 bg-panel text-accent">
                <Monitor size={26} aria-hidden />
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-tight text-fg">No slides yet</h2>
              <p className="mt-2 max-w-md text-sm text-fg/60">
                Create a slide, or import a PowerPoint (.pptx or .ppt). Each slide keeps its full design and can be added to Go Live. Use New folder to keep a talk's slides together.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={openNew} className={HEADER_PRIMARY}>
                  <Plus size={14} aria-hidden /> New slide
                </button>
                <button type="button" onClick={importPowerPoint} disabled={busy} className={HEADER_BTN}>
                  <FileUp size={14} aria-hidden /> {importButtonText}
                </button>
              </div>
              <p className="mt-6 max-w-lg text-xs text-fg/50">
                Slides are drawn by Microsoft PowerPoint (or LibreOffice) when one of them can be used, and by the app itself otherwise.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold tracking-tight text-fg">
                  {view === 'unfiled' ? <Inbox size={18} aria-hidden /> : view === 'all' ? <Layers size={18} aria-hidden /> : <Folder size={18} aria-hidden />}
                  <span className="truncate">{viewTitle}</span>
                  <span className="rounded-full border border-fg/15 bg-panel px-2 py-0.5 font-mono text-xs font-normal text-fg/70 tabular-nums">{inView.length}</span>
                </h2>
                {inView.length > 0 && (
                  <div className="relative w-full max-w-md">
                    <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg/40" aria-hidden />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={view === 'all' ? 'Search slides by title or text' : `Search in ${viewTitle}`}
                      aria-label="Search slides"
                      className="h-10 w-full rounded-lg border border-fg/15 bg-panel-2 pr-9 pl-9 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent"
                    />
                    {query && (
                      <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg/50 hover:text-fg">
                        <X size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* The bulk bar: shown only while something is picked, so it never takes room otherwise. */}
              {checked.size > 0 && (
                <div role="region" aria-label="Selected slides" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/50 bg-accent/10 px-4 py-2.5">
                  <span className="text-sm font-semibold text-fg">
                    {checked.size} selected
                    {checked.size === visible.length && visible.length > 0 ? ' (all shown)' : ''}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setChecked(new Set(visible.map((s) => s.id)))}
                      disabled={visible.every((s) => checked.has(s.id))}
                      className="h-8 rounded-md px-3 text-xs font-bold tracking-wider text-fg/80 uppercase transition hover:bg-fg/10 disabled:opacity-40"
                    >
                      Select all shown
                    </button>
                    <button type="button" onClick={() => setChecked(new Set())} className="h-8 rounded-md px-3 text-xs font-bold tracking-wider text-fg/80 uppercase transition hover:bg-fg/10">
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeChecked()}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-danger/60 bg-danger/15 px-3 text-xs font-bold tracking-wider text-danger uppercase transition hover:bg-danger/25"
                    >
                      <Trash2 size={13} aria-hidden /> Delete selected
                    </button>
                  </div>
                </div>
              )}

              {inView.length === 0 && (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-fg/20 bg-panel-2/40 p-10 text-center">
                  <div className="grid size-14 place-items-center rounded-xl border border-accent/30 bg-panel text-accent">
                    {view === 'unfiled' ? <Inbox size={24} aria-hidden /> : <Folder size={24} aria-hidden />}
                  </div>
                  <h3 className="mt-4 text-xl font-bold tracking-tight text-fg">{view === 'unfiled' ? 'Nothing is unfiled' : 'This folder is empty'}</h3>
                  <p className="mt-2 max-w-md text-sm text-fg/60">
                    {view === 'unfiled'
                      ? 'Every slide is in a folder. Drag a slide onto Unfiled to take it out of its folder.'
                      : 'Import a PowerPoint or make a new slide here, or drag slides onto this folder from All slides.'}
                  </p>
                  {view !== 'unfiled' && (
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                      <button type="button" onClick={importPowerPoint} disabled={busy} className={HEADER_PRIMARY}>
                        <FileUp size={14} aria-hidden /> {importButtonText}
                      </button>
                      <button type="button" onClick={openNew} className={HEADER_BTN}>
                        <Plus size={14} aria-hidden /> New slide
                      </button>
                    </div>
                  )}
                </div>
              )}

              {inView.length > 0 && visible.length === 0 && (
                <p role="status" className="rounded-lg border border-dashed border-fg/20 p-8 text-center text-sm text-fg/60">
                  No slides match "{query.trim()}".
                </p>
              )}

              <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
                {visible.map((slide) => (
                  <li
                    key={slide.id}
                    draggable={reorderable}
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
                    {/* A tick in the corner picks the slide for a bulk action. It shows on hover, and stays while anything is picked. */}
                    <label
                      className={`absolute top-2 left-10 z-10 grid size-6 cursor-pointer place-items-center rounded border bg-black/75 transition ${
                        checked.has(slide.id) ? 'border-accent' : 'border-fg/30 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                      } ${checked.size > 0 && !checked.has(slide.id) ? 'opacity-60' : ''}`}
                      title="Select this slide"
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(slide.id)}
                        onChange={() => toggleChecked(slide.id)}
                        aria-label={`Select ${slide.title || 'untitled slide'}`}
                        className="size-4 cursor-pointer accent-accent"
                      />
                    </label>
                    {/* A plain block layout: the preview keeps its 16:9 shape instead of collapsing inside a flex button. */}
                    <button
                      type="button"
                      onClick={() => setSelectedId(slide.id)}
                      onDoubleClick={() => project(slide)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        project(slide);
                      }}
                      aria-pressed={selectedId === slide.id}
                      aria-label={`${slide.title}. Double-click or press Enter to project.`}
                      className={`block w-full overflow-hidden rounded-lg border bg-panel-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                        selectedId === slide.id ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-accent/40'
                      }`}
                    >
                      <div className="relative aspect-video w-full overflow-hidden">
                        <div className="absolute inset-0">
                          {slide.image ? (
                            <img src={slide.image} alt="" draggable={false} className="h-full w-full bg-black object-contain" />
                          ) : (
                            <SlideCanvas slide={slide} className="h-full w-full" />
                          )}
                        </div>
                        <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-bold text-fg/90">{slides.indexOf(slide) + 1}</span>
                        {isLive(slide) && (
                          <span className="absolute bottom-2 left-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">Live</span>
                        )}
                        {view === 'all' && slide.folderId != null && (
                          <span className="absolute right-2 bottom-2 flex max-w-[60%] items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-fg/90">
                            <Folder size={10} className="shrink-0" aria-hidden />
                            <span className="truncate">{folderName(slide.folderId)}</span>
                          </span>
                        )}
                      </div>
                      <div className="truncate px-3 py-2.5 text-sm font-semibold text-fg">{slide.title || 'Untitled slide'}</div>
                    </button>
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      {[
                        { label: 'Project', icon: Monitor, run: () => project(slide), hover: 'hover:text-accent', show: true },
                        { label: 'Add to Go Live', icon: ListPlus, run: () => void addToGoLive(slide), hover: 'hover:text-accent', show: slide.slideId != null },
                        { label: 'Move to folder', icon: FolderInput, run: () => setMoveFor((cur) => (cur === slide.id ? null : slide.id)), hover: 'hover:text-accent', show: folders.length > 0 },
                        // A PowerPoint slide is a picture, so there is no text or design to edit or copy.
                        { label: 'Rename', icon: Type, run: () => startRename(slide), hover: 'hover:text-accent', show: true },
                        { label: 'Edit', icon: Pencil, run: () => openEdit(slide), hover: 'hover:text-accent', show: !slide.image },
                        { label: 'Duplicate', icon: Copy, run: () => void duplicate(slide), hover: 'hover:text-accent', show: !slide.image },
                        { label: 'Delete', icon: Trash2, run: () => void remove(slide), hover: 'hover:text-danger', show: true },
                      ]
                        .filter((action) => action.show)
                        .map(({ label, icon: Icon, run, hover }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={run}
                            aria-label={`${label} ${slide.title}`}
                            aria-haspopup={label === 'Move to folder' ? 'menu' : undefined}
                            aria-expanded={label === 'Move to folder' ? moveFor === slide.id : undefined}
                            title={label}
                            className={`grid size-7 place-items-center rounded bg-black/75 text-fg/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${hover}`}
                          >
                            <Icon size={13} aria-hidden />
                          </button>
                        ))}
                    </div>
                    {/* Rename: the title line becomes a field. Enter saves, Escape cancels; a refused title stays open with the reason. */}
                    {renamingId === slide.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveRename(slide);
                        }}
                        onKeyDown={(e) => e.key === 'Escape' && cancelRename()}
                        className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 rounded-b-lg border-t border-accent bg-panel p-2 shadow-lg shadow-black/50"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => {
                              setRenameDraft(e.target.value);
                              setRenameError(null);
                            }}
                            onFocus={(e) => e.currentTarget.select()}
                            maxLength={200}
                            aria-label={`New title for ${slide.title || 'untitled slide'}`}
                            aria-invalid={renameError ? true : undefined}
                            className="h-8 min-w-0 flex-1 rounded-md border border-fg/20 bg-panel-2 px-2 text-sm font-semibold text-fg outline-none focus:border-accent"
                          />
                          <button type="submit" aria-label="Save title" title="Save" className="grid size-8 shrink-0 place-items-center rounded-md text-ok transition hover:bg-ok/15">
                            <Check size={15} aria-hidden />
                          </button>
                          <button type="button" onClick={cancelRename} aria-label="Cancel" title="Cancel" className="grid size-8 shrink-0 place-items-center rounded-md text-fg/60 transition hover:bg-fg/10">
                            <X size={15} aria-hidden />
                          </button>
                        </div>
                        {renameError && (
                          <p role="alert" className="px-1 text-xs text-danger">
                            {renameError}
                          </p>
                        )}
                      </form>
                    )}
                    {moveFor === slide.id && <MoveMenu folders={folders} current={slide.folderId} onPick={(target) => void moveTo([slide.id], target)} onClose={() => setMoveFor(null)} />}
                  </li>
                ))}
              </ul>
            </>
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
