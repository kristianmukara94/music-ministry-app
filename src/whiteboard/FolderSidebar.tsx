import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Folder, FolderPlus, Inbox, Layers, Megaphone, Pencil, Presentation, Trash2, X } from 'lucide-react';
import { SLIDE_DRAG_TYPE, parseDragSlideIds } from '../../shared/slide-selection.js';
import { ANN_SLIDE_DRAG_TYPE } from '../../shared/deck-presets.js';
import type { DeckSource, DeckView } from '../../shared/deck-items.js';
import { errorText } from './errors';

const MAX_NAME = 60;
/** Which library sections are folded away, kept between sessions. */
const COLLAPSED_KEY = 'apccmma.deck.sidebarCollapsed';

/** A folder as the tree shows it: its id in its own library, its name, and how many slides it lists. */
export interface TreeFolder {
  id: number;
  name: string;
  count: number;
  /** A folder the app keeps for itself: it cannot be renamed, deleted or filed into here. */
  locked?: boolean;
}

/** The drag type each library's slides travel under. */
const DRAG_TYPE: Record<DeckSource, string> = { ann: ANN_SLIDE_DRAG_TYPE, wb: SLIDE_DRAG_TYPE };

const ROW =
  'group flex min-h-10 w-full items-center gap-2 rounded-md border-l-2 px-3 py-2 text-left text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';
const COUNT = 'shrink-0 rounded-full border border-fg/15 bg-panel px-2 py-0.5 font-mono text-xs tabular-nums';
const ICON_BTN =
  'grid size-7 shrink-0 place-items-center rounded text-muted transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';
/** A name that wraps to a second line before it is cut, so a long name stays readable; the row's tooltip shows the whole of it. */
const NAME = 'min-w-0 flex-1 line-clamp-2 leading-snug [overflow-wrap:anywhere]';

const readCollapsed = (): Record<DeckSource, boolean> => {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null');
    return { ann: raw?.ann === true, wb: raw?.wb === true };
  } catch {
    return { ann: false, wb: false };
  }
};

/** A name field that creates or renames a folder. Enter saves, Escape cancels; a refused name (a duplicate) is shown under the field. */
function NameForm({ initial, label, onSubmit, onCancel, children }: {
  initial: string;
  label: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
  /** Extra controls above the field (the library choice for a new folder). */
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      {children}
      <div className="flex items-center gap-1">
        <input
          ref={input}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={MAX_NAME}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          placeholder="Folder name"
          disabled={saving}
          className="h-9 min-w-0 flex-1 rounded-md border border-fg/20 bg-panel-2 px-2.5 text-sm text-fg outline-none placeholder:text-faint focus:border-accent"
        />
        <button type="submit" disabled={saving || !name.trim()} aria-label="Save folder name" title="Save" className={`${ICON_BTN} text-ok disabled:opacity-40`}>
          <Check size={15} aria-hidden />
        </button>
        <button type="button" onClick={onCancel} aria-label="Cancel" title="Cancel" className={ICON_BTN}>
          <X size={15} aria-hidden />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * A library's heading in the tree, as an accordion header. The chevron folds its folders away; the label shows every slide in that library.
 * A slide dragged over a folded section opens it, so its folders can take the drop.
 */
function SectionRow({ id, icon, label, count, active, expanded, onClick, onToggle, onAdd, onDragOver }: {
  id: string;
  icon: ReactNode;
  label: string;
  count: number;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
  onToggle: () => void;
  onAdd: () => void;
  onDragOver: (e: DragEvent) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-0.5" onDragOver={onDragOver}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={id}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        title={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        className={ICON_BTN}
      >
        <ChevronDown size={14} className={`transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        title={`${label}: every slide (${count})`}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[11px] font-bold tracking-[0.08em] uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
          active ? 'bg-accent/10 text-accent' : 'text-faint hover:bg-fg/[0.06] hover:text-fg'
        }`}
      >
        <span className="shrink-0">{icon}</span>
        <span className={NAME}>{label}</span>
        <span className="shrink-0 font-mono text-[11px] font-semibold tracking-normal tabular-nums">{count}</span>
      </button>
      <button type="button" onClick={onAdd} aria-label={`New folder in ${label}`} title={`New folder in ${label}`} className={ICON_BTN}>
        <FolderPlus size={14} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The deck's folder tree: All Slides & Decks, then the Announcements and Whiteboard & Notes libraries as collapsible sections, each with
 * its folders (and the Whiteboard's Unfiled). Folders are made, renamed and deleted here. Slides dragged from the grid file into a folder
 * of their own library: every picked slide comes along when the dragged one was picked, and a mixed pick files only the slides that
 * belong to the folder's library. Deleting a Whiteboard folder keeps its slides; deleting an announcement folder deletes its slides, and
 * asks first.
 */
export function FolderSidebar({
  annFolders,
  wbFolders,
  total,
  annTotal,
  wbTotal,
  unfiledCount,
  view,
  section,
  dragging,
  onView,
  onCreate,
  onRename,
  onDelete,
  onDropOn,
  onClearUnfiled,
}: {
  annFolders: TreeFolder[];
  wbFolders: TreeFolder[];
  total: number;
  annTotal: number;
  wbTotal: number;
  unfiledCount: number;
  view: DeckView;
  /** The library the open view belongs to, so "New folder" offers it first. */
  section: DeckSource;
  /** The libraries whose slides are being dragged (empty when nothing is), so their folders show they can take them. */
  dragging: DeckSource[];
  onView: (view: DeckView) => void;
  onCreate: (store: DeckSource, name: string) => Promise<void>;
  onRename: (store: DeckSource, id: number, name: string) => Promise<void>;
  onDelete: (store: DeckSource, folder: TreeFolder) => void;
  /** Slides of `store` (`ids`) were dropped on one of its folders (its id), or for the Whiteboard on Unfiled (null). */
  onDropOn: (store: DeckSource, folderId: number | null, ids: number[]) => void;
  onClearUnfiled: () => void;
}) {
  const [creating, setCreating] = useState<DeckSource | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const setSectionCollapsed = (store: DeckSource, value: boolean) =>
    setCollapsed((current) => {
      if (current[store] === value) return current;
      const next = { ...current, [store]: value };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the sections still fold for this session.
      }
      return next;
    });

  // Only slides of the folder's own library are taken: a file, text from elsewhere, or the other library's slides are left alone.
  const carries = (e: DragEvent, store: DeckSource) => e.dataTransfer.types.includes(DRAG_TYPE[store]);
  const drop = (store: DeckSource, key: string, folderId: number | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!carries(e, store)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOverKey(key);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setOverKey((k) => (k === key ? null : k));
    },
    onDrop: (e: DragEvent) => {
      if (!carries(e, store)) return;
      e.preventDefault();
      setOverKey(null);
      onDropOn(store, folderId, parseDragSlideIds(e.dataTransfer.getData(DRAG_TYPE[store])));
    },
  });

  // A drag that ends anywhere (a drop, Escape, outside the window) leaves no row lit.
  const anyDrag = dragging.length > 0;
  useEffect(() => {
    if (!anyDrag) setOverKey(null);
  }, [anyDrag]);

  const rowClass = (active: boolean, key: string, droppable: boolean) =>
    `${ROW} ${
      overKey === key
        ? 'border border-amber-500 bg-amber-500/20 text-amber-300'
        : active
          ? 'border-accent bg-accent/10 text-accent'
          : `border-transparent text-fg/85 hover:bg-fg/[0.06] ${droppable ? 'border-dashed !border-fg/30' : ''}`
    }`;

  const startCreate = (store: DeckSource) => {
    setRenaming(null);
    setCreating(store);
    setSectionCollapsed(store, false);
  };

  const folderRows = (store: DeckSource, folders: TreeFolder[]) =>
    folders.map((folder) => {
      const key = `${store}:${folder.id}`;
      if (renaming === key) {
        return (
          <NameForm
            key={key}
            initial={folder.name}
            label={`Rename ${folder.name}`}
            onCancel={() => setRenaming(null)}
            onSubmit={async (name) => {
              await onRename(store, folder.id, name);
              setRenaming(null);
            }}
          />
        );
      }
      const droppable = !folder.locked;
      return (
        <div key={key} className="group/row relative" {...(droppable ? drop(store, key, folder.id) : {})}>
          <button
            type="button"
            onClick={() => onView(key)}
            aria-current={view === key ? 'true' : undefined}
            className={rowClass(view === key, key, droppable && dragging.includes(store))}
            title={folder.locked ? `${folder.name} (kept by the app for imported PowerPoint pictures)` : `${folder.name} · ${folder.count} ${folder.count === 1 ? 'slide' : 'slides'}`}
          >
            <Folder size={15} className="shrink-0" aria-hidden />
            <span className={NAME}>{folder.name}</span>
            <span className={`${COUNT} transition ${folder.locked ? '' : 'group-focus-within/row:opacity-0 group-hover/row:opacity-0'}`}>{folder.count}</span>
          </button>
          {!folder.locked && (
            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 gap-0.5 rounded bg-surface opacity-0 transition group-focus-within/row:opacity-100 group-hover/row:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setCreating(null);
                  setRenaming(key);
                }}
                aria-label={`Rename ${folder.name}`}
                title="Rename"
                className={ICON_BTN}
              >
                <Pencil size={13} aria-hidden />
              </button>
              <button type="button" onClick={() => onDelete(store, folder)} aria-label={`Delete ${folder.name}`} title="Delete folder" className={`${ICON_BTN} hover:!text-danger`}>
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          )}
        </div>
      );
    });

  const createForm = (store: DeckSource) =>
    creating === store && (
      <NameForm
        initial=""
        label={`New ${store === 'ann' ? 'Announcements' : 'Whiteboard'} folder name`}
        onCancel={() => setCreating(null)}
        onSubmit={async (name) => {
          await onCreate(store, name);
          setCreating(null);
        }}
      >
        <div role="radiogroup" aria-label="Library" className="flex gap-1">
          {(['ann', 'wb'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={creating === s}
              onClick={() => startCreate(s)}
              className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-bold tracking-wide uppercase transition ${
                creating === s ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 text-muted hover:text-fg'
              }`}
            >
              {s === 'ann' ? 'Announcements' : 'Whiteboard'}
            </button>
          ))}
        </div>
      </NameForm>
    );

  /** A dragged slide over a folded section of its own library opens it. */
  const openOnDrag = (store: DeckSource) => (e: DragEvent) => {
    if (collapsed[store] && carries(e, store)) setSectionCollapsed(store, false);
  };

  return (
    <aside aria-label="Deck folders" className="flex max-h-full w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-4">
      <button
        type="button"
        onClick={() => startCreate(section)}
        className="mb-2 flex h-10 items-center justify-center gap-2 rounded-md border border-fg/15 text-xs font-extrabold tracking-wider uppercase transition hover:border-accent/40 hover:bg-fg/[0.06] hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
      >
        <FolderPlus size={15} aria-hidden /> New folder
      </button>

      <button
        type="button"
        onClick={() => onView('all')}
        aria-current={view === 'all' ? 'true' : undefined}
        title={`All Slides & Decks · ${total}`}
        className={rowClass(view === 'all', 'all', false)}
      >
        <Layers size={15} className="shrink-0" aria-hidden />
        <span className={NAME}>All Slides &amp; Decks</span>
        <span className={COUNT}>{total}</span>
      </button>

      <SectionRow
        id="deck-section-ann"
        icon={<Megaphone size={13} aria-hidden />}
        label="Announcements"
        count={annTotal}
        active={view === 'ann'}
        expanded={!collapsed.ann}
        onClick={() => onView('ann')}
        onToggle={() => setSectionCollapsed('ann', !collapsed.ann)}
        onAdd={() => startCreate('ann')}
        onDragOver={openOnDrag('ann')}
      />
      <div id="deck-section-ann" className={collapsed.ann ? 'hidden' : 'flex flex-col gap-1'}>
        {createForm('ann')}
        {folderRows('ann', annFolders)}
        {annFolders.length === 0 && creating !== 'ann' && <p className="px-3 py-1 text-xs text-faint">No announcement folders yet.</p>}
      </div>

      <SectionRow
        id="deck-section-wb"
        icon={<Presentation size={13} aria-hidden />}
        label="Whiteboard & Notes"
        count={wbTotal}
        active={view === 'wb'}
        expanded={!collapsed.wb}
        onClick={() => onView('wb')}
        onToggle={() => setSectionCollapsed('wb', !collapsed.wb)}
        onAdd={() => startCreate('wb')}
        onDragOver={openOnDrag('wb')}
      />
      <div id="deck-section-wb" className={collapsed.wb ? 'hidden' : 'flex flex-col gap-1'}>
        {createForm('wb')}
        {folderRows('wb', wbFolders)}
        {/* Whiteboard slides in no folder. Always a drop target, so a slide can be taken out of its folder. */}
        <div className="group/row relative" {...drop('wb', 'wb:unfiled', null)}>
          <button
            type="button"
            onClick={() => onView('wb:unfiled')}
            aria-current={view === 'wb:unfiled' ? 'true' : undefined}
            title={`Unfiled: Whiteboard slides in no folder · ${unfiledCount}`}
            className={rowClass(view === 'wb:unfiled', 'wb:unfiled', dragging.includes('wb'))}
          >
            <Inbox size={15} className="shrink-0" aria-hidden />
            <span className={NAME}>Unfiled</span>
            <span className={COUNT}>{unfiledCount}</span>
          </button>
        </div>
        {unfiledCount > 0 && (
          <button
            type="button"
            onClick={onClearUnfiled}
            title="Delete every Whiteboard slide that is not in a folder"
            className="mt-1 ml-3 flex h-8 w-fit items-center gap-1.5 rounded-md border border-danger/60 bg-danger/10 px-3 text-[11px] font-bold tracking-wider text-danger uppercase transition hover:bg-danger/20 focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none"
          >
            <Trash2 size={12} aria-hidden /> Clear Unfiled
          </button>
        )}
      </div>
    </aside>
  );
}
