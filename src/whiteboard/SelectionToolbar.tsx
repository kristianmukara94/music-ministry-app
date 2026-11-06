import { CheckSquare, FolderInput, Trash2, X } from 'lucide-react';
import { MoveMenu } from './MoveMenu';
import type { WhiteboardFolder } from './types';

const GHOST =
  'flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-bold tracking-wider text-fg/80 uppercase transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The bulk bar over the slide grid. It sticks to the top of the scrolling grid, so its actions stay in reach on a long deck.
 * It is only shown while something is picked.
 */
export function SelectionToolbar({
  count,
  hidden,
  allShown,
  onSelectAll,
  onClear,
  onDelete,
  folders,
  currentFolder,
  moveOpen,
  onMoveOpen,
  onMove,
}: {
  /** How many slides are picked. */
  count: number;
  /** How many of the picked slides the current search hides. They are still deleted with the rest, so the bar says so. */
  hidden: number;
  /** Whether every slide shown is already picked. */
  allShown: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  /** The folders the picked slides can be moved to. With none there is nowhere to move them, so the button is not shown. */
  folders: WhiteboardFolder[];
  /** The folder every picked slide is already in, or undefined when they are spread over several. */
  currentFolder: number | null | undefined;
  moveOpen: boolean;
  onMoveOpen: (open: boolean) => void;
  /** A folder was picked (null for Unfiled). */
  onMove: (folderId: number | null) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Selected slides"
      className="sticky top-0 z-20 -mx-6 mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-line bg-canvas/90 px-6 py-3 shadow-lg shadow-black/30 backdrop-blur-md"
    >
      <div className="flex min-w-0 items-center gap-2" aria-live="polite">
        <span className="flex h-7 items-center gap-1.5 rounded-full border border-accent/60 bg-accent/15 pr-3 pl-2 text-xs font-bold text-accent">
          <span className="size-2 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" aria-hidden />
          <span className="tabular-nums">{count}</span> selected
        </span>
        {allShown && <span className="text-xs text-fg/55">All shown</span>}
        {hidden > 0 && (
          <span className="text-xs text-fg/55">
            <span className="tabular-nums">{hidden}</span> hidden by search
          </span>
        )}
        <span className="hidden text-[11px] text-fg/40 xl:inline">Shift-click to pick a range · Drag onto a folder to file · Esc to clear · Del to delete</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={onSelectAll} disabled={allShown} className={GHOST} title="Select every slide shown (Ctrl+A)">
          <CheckSquare size={13} aria-hidden /> Select all shown
        </button>
        <button type="button" onClick={onClear} className={GHOST} title="Clear the selection (Esc)">
          <X size={13} aria-hidden /> Clear selection
        </button>
        {folders.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => onMoveOpen(!moveOpen)}
              // The menu closes on any mousedown outside it; this keeps the button's own press from closing and reopening it.
              onMouseDown={(e) => moveOpen && e.stopPropagation()}
              aria-haspopup="menu"
              aria-expanded={moveOpen}
              title="Move the selected slides to a folder"
              className="ml-1 flex h-8 items-center gap-1.5 rounded-md border border-accent/60 bg-accent/15 px-3 text-xs font-bold tracking-wider text-accent uppercase transition hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
            >
              <FolderInput size={13} aria-hidden /> Move to folder
            </button>
            {moveOpen && (
              <MoveMenu
                folders={folders}
                current={currentFolder}
                title={`Move ${count} ${count === 1 ? 'slide' : 'slides'} to`}
                className="top-10 right-0"
                onPick={onMove}
                onClose={() => onMoveOpen(false)}
              />
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onDelete}
          title="Delete the selected slides (Del)"
          className="ml-1 flex h-8 items-center gap-1.5 rounded-md border border-danger bg-danger px-3 text-xs font-bold tracking-wider text-canvas uppercase shadow-md shadow-black/40 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"
        >
          <Trash2 size={13} aria-hidden /> Delete selected
        </button>
      </div>
    </div>
  );
}
