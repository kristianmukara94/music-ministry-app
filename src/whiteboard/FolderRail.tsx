import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Check, Folder, FolderPlus, Inbox, Layers, Pencil, Trash2, X } from 'lucide-react';
import { errorText } from './errors';
import type { WhiteboardFolder } from './types';

/** What the panel is showing: every slide, the slides in no folder, or one folder. */
export type FolderView = 'all' | 'unfiled' | number;

const MAX_NAME = 60;

const ROW =
  'group flex min-h-11 w-full items-center gap-2 rounded-md border-l-2 px-3 py-2 text-left text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';
const COUNT = 'rounded-full border border-fg/15 bg-panel px-2 py-0.5 font-mono text-xs tabular-nums';
const ICON_BTN =
  'grid size-7 shrink-0 place-items-center rounded text-fg/60 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';

/** A name field that creates or renames a folder. Enter saves, Escape cancels; a refused name (a duplicate) is shown under the field. */
function NameForm({
  initial,
  label,
  onSubmit,
  onCancel,
}: {
  initial: string;
  label: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
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
          className="h-9 min-w-0 flex-1 rounded-md border border-fg/20 bg-panel-2 px-2.5 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent"
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
 * The Whiteboard's library: All slides, each folder, and Unfiled. Folders are made, renamed and deleted here, and a slide dragged from the
 * grid onto a folder (or Unfiled) moves into it. Deleting a folder keeps its slides.
 */
export function FolderRail({
  folders,
  total,
  unfiledCount,
  view,
  dragging,
  onView,
  onCreate,
  onRename,
  onDelete,
  onDropOn,
}: {
  folders: WhiteboardFolder[];
  total: number;
  unfiledCount: number;
  view: FolderView;
  /** True while a slide is being dragged, so the folders show they can take it. */
  dragging: boolean;
  onView: (view: FolderView) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (folder: WhiteboardFolder) => void;
  /** A slide was dropped on a folder (its id) or on Unfiled (null). */
  onDropOn: (folderId: number | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const drop = (key: string, folderId: number | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      setOverKey(key);
    },
    onDragLeave: () => setOverKey((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOverKey(null);
      onDropOn(folderId);
    },
  });

  const rowClass = (active: boolean, key: string) =>
    `${ROW} ${
      overKey === key
        ? 'border-accent bg-accent/25 text-accent ring-2 ring-accent'
        : active
          ? 'border-accent bg-accent/10 text-accent'
          : `border-transparent text-fg/85 hover:bg-fg/[0.06] ${dragging ? 'border-dashed !border-fg/30' : ''}`
    }`;

  return (
    <aside aria-label="Whiteboard library" className="flex max-h-full w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-line p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.2em] text-fg/50 uppercase">Library</span>
        <button
          type="button"
          onClick={() => {
            setRenaming(null);
            setCreating(true);
          }}
          className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-[11px] font-bold tracking-wide text-accent uppercase transition hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <FolderPlus size={13} aria-hidden /> New folder
        </button>
      </div>

      <button type="button" onClick={() => onView('all')} aria-current={view === 'all' ? 'true' : undefined} className={rowClass(view === 'all', 'all')}>
        <Layers size={15} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">All slides</span>
        <span className={COUNT}>{total}</span>
      </button>

      {creating && (
        <NameForm
          initial=""
          label="New folder name"
          onCancel={() => setCreating(false)}
          onSubmit={async (name) => {
            await onCreate(name);
            setCreating(false);
          }}
        />
      )}

      {folders.map((folder) =>
        renaming === folder.id ? (
          <NameForm
            key={folder.id}
            initial={folder.name}
            label={`Rename ${folder.name}`}
            onCancel={() => setRenaming(null)}
            onSubmit={async (name) => {
              await onRename(folder.id, name);
              setRenaming(null);
            }}
          />
        ) : (
          <div key={folder.id} className="group/row relative" {...drop(`f${folder.id}`, folder.id)}>
            <button
              type="button"
              onClick={() => onView(folder.id)}
              aria-current={view === folder.id ? 'true' : undefined}
              className={rowClass(view === folder.id, `f${folder.id}`)}
              title={folder.name}
            >
              <Folder size={15} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className={`${COUNT} transition group-focus-within/row:opacity-0 group-hover/row:opacity-0`}>{folder.count}</span>
            </button>
            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 gap-0.5 opacity-0 transition group-focus-within/row:opacity-100 group-hover/row:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setRenaming(folder.id);
                }}
                aria-label={`Rename ${folder.name}`}
                title="Rename"
                className={ICON_BTN}
              >
                <Pencil size={13} aria-hidden />
              </button>
              <button type="button" onClick={() => onDelete(folder)} aria-label={`Delete ${folder.name}`} title="Delete folder" className={`${ICON_BTN} hover:!text-danger`}>
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          </div>
        ),
      )}

      {/* Slides in no folder. Shown once folders exist, so they can be dragged back out. */}
      {folders.length > 0 && (
        <div {...drop('unfiled', null)}>
          <button type="button" onClick={() => onView('unfiled')} aria-current={view === 'unfiled' ? 'true' : undefined} className={rowClass(view === 'unfiled', 'unfiled')}>
            <Inbox size={15} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Unfiled</span>
            <span className={COUNT}>{unfiledCount}</span>
          </button>
        </div>
      )}

      {folders.length === 0 && !creating && (
        <p className="mt-1 rounded-md border border-dashed border-fg/15 p-3 text-xs leading-relaxed text-fg/55">
          Make a folder for each sermon, talk or event. Import a PowerPoint into it to keep its slides together.
        </p>
      )}
    </aside>
  );
}
