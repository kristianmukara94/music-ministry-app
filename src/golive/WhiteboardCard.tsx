import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileUp, Folder, Inbox, Layers, ListPlus, Monitor, Pencil, Plus } from 'lucide-react';
import { addToQueue } from '../planner/plan-api';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import { setUi } from '../state/ui';
import { SlideCanvas } from '../whiteboard/SlideCanvas';
import { onWhiteboardChanged } from '../whiteboard/changes';
import { errorText } from '../whiteboard/errors';
import { addWhiteboardPictureToQueue, listWhiteboardFolders, listWhiteboardSlides, projectWhiteboardSlide } from '../whiteboard/projectSlide';
import type { WhiteboardFolder, WhiteboardSlide } from '../whiteboard/types';
import { LiveSlideEditor } from './LiveSlideEditor';
import type { GoLiveT } from './strings';

const CARD = 'rounded-[10px] border border-line bg-panel';
const BTN =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const BTN_PRIMARY =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-bold text-on-accent transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';
const CHIP = (on: boolean) =>
  `inline-flex h-9 max-w-56 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
    on ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 bg-panel-2 text-fg/85 hover:border-accent/50 hover:text-accent'
  }`;

/** Which slides to show: all of them (grouped by folder), the unfiled ones, or one folder. */
type Filter = 'all' | 'unfiled' | number;
const UNFILED = 'unfiled';

/**
 * The Whiteboard's slides, by folder: the same folders and slides as the Whiteboard panel. Project puts a slide on the projector and marks
 * it LIVE; PowerPoint slides can go to the Mass Queue one at a time or a whole folder at once. The card reloads whenever the Whiteboard changes.
 */
export function WhiteboardCard({ t }: { t: GoLiveT }) {
  const [slides, setSlides] = useState<WhiteboardSlide[] | null>(null);
  const [folders, setFolders] = useState<WhiteboardFolder[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState<Set<number | typeof UNFILED>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // The slide open in the side editor, if any.
  const [editingId, setEditingId] = useState<number | null>(null);
  const liveFrame = useLive((s) => s.state.projector.live);
  const projectorOn = useLive((s) => s.state.outputs.projector);

  useEffect(() => {
    const reload = () =>
      Promise.all([listWhiteboardSlides(), listWhiteboardFolders()])
        .then(([list, folderList]) => {
          setSlides(list);
          setFolders(folderList);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    void reload();
    return onWhiteboardChanged(() => void reload());
  }, []);

  // A confirmation fades on its own, so it never sits over later work.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // A folder that is gone cannot stay selected.
  useEffect(() => {
    if (typeof filter === 'number' && !folders.some((f) => f.id === filter)) setFilter('all');
  }, [folders, filter]);

  const all = slides ?? [];
  const unfiled = useMemo(() => all.filter((s) => s.folderId == null), [all]);
  const inFolder = (id: number) => all.filter((s) => s.folderId === id);

  /** Whether this slide is the one on the projector right now. */
  const isLive = (slide: WhiteboardSlide) =>
    projectorOn &&
    (slide.image
      ? liveFrame.kind === 'image' && liveFrame.src === slide.image
      : liveFrame.kind === 'whiteboard' && liveFrame.slide.title === slide.title && liveFrame.slide.content === slide.content);

  const project = (slide: WhiteboardSlide) => {
    setError(null);
    projectWhiteboardSlide(slide, all);
    setNotice(t('whiteboardShowing', { title: slide.title || '—' }));
  };

  const queue = async (slide: WhiteboardSlide) => {
    setBusyKey(`s${slide.id}`);
    setError(null);
    try {
      await addWhiteboardPictureToQueue(slide);
      setNotice(t('whiteboardQueued', { title: slide.title || '—' }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyKey(null);
    }
  };

  /** Adds every PowerPoint slide of a group to the Mass Queue, in folder order. */
  const queueGroup = async (key: string, name: string, group: WhiteboardSlide[]) => {
    const pictures = group.filter((s) => s.slideId != null);
    if (pictures.length === 0) return;
    setBusyKey(key);
    setError(null);
    try {
      await addToQueue(pictures.map((s) => ({ block: 'word' as const, module: 'announcements' as const, sourceId: String(s.slideId), label: s.title })));
      setNotice(t('whiteboardQueuedMany', { n: pictures.length, folder: name }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyKey(null);
    }
  };

  /** Opens the slide in its own editor window. Where windows cannot be opened (a browser), the editor docks to the side instead. */
  const openEditor = async (slide: WhiteboardSlide) => {
    setError(null);
    try {
      if (await bridge.whiteboard.openEditor(slide.id)) return;
    } catch (err) {
      setError(errorText(err));
      return;
    }
    setEditingId(slide.id);
  };

  const toggle = (key: number | typeof UNFILED) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** One slide as a card: its look, what it is, and what can be done with it. */
  const slideCard = (slide: WhiteboardSlide) => {
    const live = isLive(slide);
    const editing = editingId === slide.id;
    return (
      <li
        key={slide.id}
        className={`flex min-w-0 flex-col overflow-hidden rounded-lg border bg-panel-2 ${
          live ? 'border-accent ring-1 ring-accent' : editing ? 'border-info ring-2 ring-info/40' : 'border-line'
        }`}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {slide.image ? (
            <img src={slide.image} alt="" draggable={false} className="h-full w-full object-contain" />
          ) : (
            <SlideCanvas slide={slide} className="h-full w-full" />
          )}
          <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2">
            {slide.image ? (
              <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-fg/90 uppercase">{t('whiteboardPowerPoint')}</span>
            ) : (
              <span />
            )}
            {live && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">{t('whiteboardLive')}</span>}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 p-2.5">
          <span className="truncate text-sm font-semibold text-fg" title={slide.title}>
            {slide.title || t('whiteboardUntitled')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={live ? BTN : BTN_PRIMARY} onClick={() => project(slide)} aria-label={`${t('whiteboardProject')} ${slide.title}`}>
              <Monitor size={13} aria-hidden /> {live ? t('whiteboardShowAgain') : t('whiteboardProject')}
            </button>
            <button
              type="button"
              className={BTN}
              aria-pressed={editing}
              onClick={() => (editing ? setEditingId(null) : void openEditor(slide))}
              aria-label={`${t('whiteboardEdit')} ${slide.title}`}
            >
              <Pencil size={13} aria-hidden /> {t('whiteboardEdit')}
            </button>
            {slide.slideId != null && (
              <button type="button" className={BTN} disabled={busyKey === `s${slide.id}`} onClick={() => void queue(slide)} aria-label={`${t('whiteboardQueue')} ${slide.title}`}>
                <ListPlus size={13} aria-hidden /> {t('whiteboardQueue')}
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  const grid = (group: WhiteboardSlide[]) => <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">{group.map(slideCard)}</ul>;

  /** A folder's slides under their own heading, which can be folded away and can send the whole folder to the Mass Queue. */
  const section = (key: number | typeof UNFILED, name: string, group: WhiteboardSlide[], icon: typeof Folder) => {
    const Icon = icon;
    const open = !collapsed.has(key);
    const pictures = group.filter((s) => s.slideId != null).length;
    return (
      <section key={String(key)} aria-label={t('whiteboardFolderCount', { n: group.length, folder: name })} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={open}
            aria-label={t(open ? 'whiteboardCollapse' : 'whiteboardExpand', { folder: name })}
            className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            {open ? <ChevronDown size={16} className="shrink-0 text-fg/60" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-fg/60" aria-hidden />}
            <Icon size={16} className="shrink-0 text-accent" aria-hidden />
            <span className="truncate text-base font-bold text-fg">{name}</span>
            <span className="rounded-full border border-fg/15 bg-panel-2 px-2 py-0.5 font-mono text-xs text-fg/70 tabular-nums">{group.length}</span>
          </button>
          {pictures > 0 && (
            <button type="button" className={BTN} disabled={busyKey === `g${key}`} onClick={() => void queueGroup(`g${key}`, name, group)}>
              <ListPlus size={13} aria-hidden /> {t('whiteboardQueueFolder')}
            </button>
          )}
        </div>
        {open && grid(group)}
      </section>
    );
  };

  const count = all.length;
  const editingSlide = editingId == null ? null : (all.find((s) => s.id === editingId) ?? null);
  const shownFolder = typeof filter === 'number' ? folders.find((f) => f.id === filter) : undefined;
  const hasFolders = folders.length > 0;

  return (
    <section aria-labelledby="whiteboard-card-heading" className={`${CARD} flex min-w-0 flex-col gap-4 p-4 md:p-5`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="whiteboard-card-heading" className="text-lg font-bold tracking-tight text-fg">
            {t('whiteboardHeading')}
          </h2>
          <p className="text-sm text-fg/65">{t('whiteboardIntro')}</p>
        </div>
        <span className="text-xs font-semibold text-fg/60">{slides ? t('whiteboardCount', { n: count }) : ''}</span>
      </header>

      {/* The Whiteboard's folders. Shown once there is more than one way to look at the slides. */}
      {hasFolders && slides && (
        <div role="group" aria-label={t('whiteboardFolders')} className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className={CHIP(filter === 'all')}>
            <Layers size={14} className="shrink-0" aria-hidden /> {t('whiteboardAll')}
            <span className="font-mono text-xs opacity-80">{count}</span>
          </button>
          {folders.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={CHIP(filter === f.id)} title={f.name}>
              <Folder size={14} className="shrink-0" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="font-mono text-xs opacity-80">{f.count}</span>
            </button>
          ))}
          {unfiled.length > 0 && (
            <button type="button" aria-pressed={filter === 'unfiled'} onClick={() => setFilter('unfiled')} className={CHIP(filter === 'unfiled')}>
              <Inbox size={14} className="shrink-0" aria-hidden /> {t('whiteboardUnfiled')}
              <span className="font-mono text-xs opacity-80">{unfiled.length}</span>
            </button>
          )}
        </div>
      )}

      <div aria-live="polite" className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-ok/50 bg-ok/10 px-4 py-2 text-sm text-ok">
            {notice}
          </p>
        )}
      </div>

      {slides === null ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3" aria-label={t('whiteboardLoading')}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="aspect-video animate-pulse rounded-lg border border-line bg-panel-2" />
          ))}
        </ul>
      ) : count === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-fg/20 p-5">
          <p className="flex items-center gap-2 text-sm text-fg/70">
            <FileUp size={15} aria-hidden /> {t('whiteboardEmpty')}
          </p>
          <button type="button" className={BTN} onClick={() => setUi({ view: 'whiteboard' })}>
            <Plus size={14} aria-hidden /> {t('whiteboardOpen')}
          </button>
        </div>
      ) : filter === 'all' ? (
        // Every folder with slides, then the slides in no folder. With no folders at all, the slides are one plain list.
        hasFolders ? (
          <div className="flex flex-col gap-5">
            {folders.map((f) => (inFolder(f.id).length > 0 ? section(f.id, f.name, inFolder(f.id), Folder) : null))}
            {unfiled.length > 0 && section(UNFILED, t('whiteboardUnfiled'), unfiled, Inbox)}
          </div>
        ) : (
          grid(all)
        )
      ) : filter === 'unfiled' ? (
        grid(unfiled)
      ) : inFolder(filter).length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-fg/20 p-5">
          <p className="text-sm text-fg/70">{t('whiteboardFolderEmpty')}</p>
          <button type="button" className={BTN} onClick={() => setUi({ view: 'whiteboard' })}>
            <Plus size={14} aria-hidden /> {t('whiteboardOpen')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shownFolder && (
            <div className="flex justify-end">
              {inFolder(filter).some((s) => s.slideId != null) && (
                <button type="button" className={BTN} disabled={busyKey === `g${filter}`} onClick={() => void queueGroup(`g${filter}`, shownFolder.name, inFolder(filter))}>
                  <ListPlus size={13} aria-hidden /> {t('whiteboardQueueFolder')}
                </button>
              )}
            </div>
          )}
          {grid(inFolder(filter))}
        </div>
      )}

      {/* The side editor for the slide whose Edit button is pressed. Keyed by slide, so each slide starts from its own saved state. */}
      {editingSlide && <LiveSlideEditor key={editingSlide.id} slide={editingSlide} layout="panel" onClose={() => setEditingId(null)} t={t} />}
    </section>
  );
}
