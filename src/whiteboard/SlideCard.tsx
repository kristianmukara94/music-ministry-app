import { type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { Copy, Folder, FolderInput, GripVertical, ListPlus, Monitor, Pencil, Trash2, Type } from 'lucide-react';

export interface SlideCardActions {
  project: () => void;
  /** Only for a PowerPoint slide: puts its deck, from this slide on, into a service flow. */
  addToGoLive?: () => void;
  /** Only when there are folders to move to. */
  move?: () => void;
  /** Absent where the slide's library cannot rename it. */
  rename?: () => void;
  /** Only for a slide made here: a PowerPoint slide is a picture, so there is no text or design to edit or copy. */
  edit?: () => void;
  duplicate?: () => void;
  remove: () => void;
}

/**
 * One slide in the deck grid, for an announcement and a Whiteboard slide alike. The top band holds the tick and the slide's number, with the
 * actions fading in on hover or focus. The preview starts below that band (`pt-10`), so no control ever covers the slide's own text.
 */
export function SlideCard({
  title,
  preview,
  index,
  checked,
  focused,
  live,
  staged = false,
  folderLabel,
  kindIcon,
  reorderable = false,
  moveOpen,
  dense = false,
  dragging = false,
  onCheck,
  onFocus,
  onDragStart,
  onDragEnd,
  actions,
}: {
  title: string;
  /** The slide as it will look: a picture, a designed slide or a text slide, drawn to fill a 16:9 box. */
  preview: ReactNode;
  /** The slide's number in the list shown (1-based). */
  index: number;
  /** Picked for a bulk action. */
  checked: boolean;
  /** The slide last clicked (staged), which Enter projects. */
  focused: boolean;
  live: boolean;
  /** Waiting in the staged slot, not yet live. */
  staged?: boolean;
  /** The folder's name, shown on the preview when the grid mixes folders. */
  folderLabel: string | null;
  /** A small mark beside the title for the kind of slide (a text slide, a PowerPoint picture). */
  kindIcon?: ReactNode;
  /** The card can be dragged to a new place in the grid, so it shows a grip. */
  reorderable?: boolean;
  moveOpen: boolean;
  /** A narrow card (the 6-column grid): the hover tools are smaller and wrap instead of being cut off. */
  dense?: boolean;
  /** This card is part of the drag under way, so it is dimmed. */
  dragging?: boolean;
  /** The tick was clicked; `shift` says whether Shift was held, for a range. */
  onCheck: (shift: boolean) => void;
  onFocus: () => void;
  /** The card is being dragged (to a folder in the library, or to a new place in the grid). It sets the drag's data. */
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  actions: SlideCardActions;
}) {
  const name = title || 'Untitled slide';
  const tools: { label: string; icon: typeof Monitor; run?: () => void; danger?: boolean; menu?: boolean }[] = [
    { label: 'Project', icon: Monitor, run: actions.project },
    { label: 'Add to Go Live', icon: ListPlus, run: actions.addToGoLive },
    { label: 'Move to folder', icon: FolderInput, run: actions.move, menu: true },
    { label: 'Rename', icon: Type, run: actions.rename },
    { label: 'Edit', icon: Pencil, run: actions.edit },
    { label: 'Duplicate', icon: Copy, run: actions.duplicate },
    { label: 'Delete', icon: Trash2, run: actions.remove, danger: true },
  ];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`relative cursor-grab overflow-hidden rounded-lg border bg-panel-2 transition-all duration-150 active:cursor-grabbing ${dragging ? 'opacity-40' : ''} ${
        checked
          ? 'scale-[0.99] border-accent ring-2 ring-accent shadow-[0_0_18px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]'
          : focused
            ? 'border-accent/70 ring-1 ring-accent/50'
            : 'border-line hover:border-accent/40'
      }`}
    >
      {/* A plain block layout: the preview keeps its 16:9 shape instead of collapsing inside a flex button. */}
      <button
        type="button"
        onClick={onFocus}
        onDoubleClick={actions.project}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.stopPropagation();
          actions.project();
        }}
        aria-pressed={focused}
        aria-label={`${name}. Click to stage, double-click or press Enter to project.`}
        className="block w-full text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset"
      >
        {/* The top padding is the control band's room: the slide is drawn below it, never under it. */}
        <div className="bg-black pt-10">
          <div className="relative aspect-video w-full overflow-hidden">
            <div className="absolute inset-0">{preview}</div>
            {live && (
              <span className="absolute top-2 left-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase shadow shadow-black/50">
                Live
              </span>
            )}
            {!live && staged && (
              <span className="absolute top-2 left-2 rounded bg-amber px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase shadow shadow-black/50">
                Staged
              </span>
            )}
            {folderLabel && (
              <span className="absolute right-2 bottom-2 flex max-w-[60%] items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white/90">
                <Folder size={10} className="shrink-0" aria-hidden />
                <span className="truncate">{folderLabel}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5">
          {reorderable && <GripVertical size={14} className="shrink-0 text-faint" aria-hidden />}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{name}</span>
          {kindIcon}
        </div>
      </button>

      {/* The control band. It lets clicks through to the card except on its own controls. */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex justify-between gap-2 ${dense ? 'min-h-10 items-start py-1.5' : 'h-10 items-center'} bg-gradient-to-b from-black/80 via-black/40 to-transparent px-2`}>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          <label
            className="grid size-7 cursor-pointer place-items-center rounded-md transition hover:bg-white/15"
            title="Select this slide (Shift-click to select a range)"
            // Shift-click would otherwise also select the page's text between the two clicks.
            onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onCheck((e.nativeEvent as MouseEvent).shiftKey === true)}
              aria-label={`Select ${name}`}
              className="size-4 cursor-pointer accent-accent"
            />
          </label>
          <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${checked ? 'bg-accent text-on-accent' : 'bg-black/60 text-white/90'}`}>{index}</span>
        </div>
        <div className={`pointer-events-auto flex min-w-0 opacity-0${dense ? ' flex-wrap justify-end gap-0.5' : ' gap-1'} transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100`}>
          {tools
            .filter((tool) => tool.run)
            .map(({ label, icon: Icon, run, danger, menu }) => (
              <button
                key={label}
                type="button"
                onClick={run}
                aria-label={`${label} ${name}`}
                aria-haspopup={menu ? 'menu' : undefined}
                aria-expanded={menu ? moveOpen : undefined}
                title={label}
                className={`grid ${dense ? 'size-6' : 'size-7'} place-items-center rounded-md bg-black/60 text-white/90 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                  danger ? 'hover:bg-danger hover:text-canvas' : 'hover:bg-white/20 hover:text-accent'
                }`}
              >
                <Icon size={dense ? 12 : 13} aria-hidden />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
