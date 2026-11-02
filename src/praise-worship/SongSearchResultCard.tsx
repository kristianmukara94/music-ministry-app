import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { AlertTriangle, Radio, Zap } from 'lucide-react';
import type { LibraryDrag } from '../../shared/pw-attach.js';
import type { QuickLiveNotice } from './useQuickLiveController';

/** One library result. The row's text is a button: pointing at it or focusing it previews it, Enter inserts it. */
export interface LibraryRow {
  key: string;
  title: string;
  sub: string;
  fits?: boolean;
  /** What the row carries when it is dragged onto a lineup card. Every row can be dragged. */
  drag?: LibraryDrag;
  /** Set on a song or prayer row: the row has a tick box for multi-add. */
  tickable?: boolean;
  /** Set on a song row: the song can go straight to the projector, without being in the lineup. */
  hymnId?: number;
  insert: () => void;
  added: boolean;
  extra?: ReactNode;
}

/** What the card shows about the quick Go Live of its own song. */
export interface QuickLiveView {
  isLive: boolean;
  armed: boolean;
  pending: boolean;
  notice: QuickLiveNotice | null;
}

const ADD = 'grid h-9 min-w-16 shrink-0 place-items-center rounded-md border border-fg/15 bg-panel-2 px-4 text-xs font-bold tracking-wide uppercase text-fg/85 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';
const GO_LIVE = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-extrabold tracking-wide uppercase transition focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60';

interface Props {
  row: LibraryRow;
  selected: boolean;
  dragging: boolean;
  /** The label of the Add button: Add, or Replace while a song is being swapped. */
  addLabel: string;
  addAria: string;
  canAdd: boolean;
  quick: QuickLiveView | null;
  buttonRef: Ref<HTMLButtonElement>;
  onActivate: () => void;
  onCardClick: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onRowKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  /** `immediate` skips the confirm click. */
  onGoLive: (immediate: boolean) => void;
  labels: { fits: string; live: string; goLive: string; confirm: string; showing: string };
}

/**
 * A library result card. A song card has two actions: Add (quiet, queues it in the open lineup card) and Go Live (loud, shows stanza 1 on the
 * projector now). The song on the projector wears a pulsing badge and a glow, so the operator sees what the congregation sees.
 */
export function SongSearchResultCard({ row, selected, dragging, addLabel, addAria, canAdd, quick, buttonRef, onActivate, onCardClick, onDragStart, onDragEnd, onRowKey, onGoLive, labels }: Props) {
  const isLive = quick?.isLive ?? false;
  const notice = quick?.notice ?? null;
  return (
    <li
      onMouseEnter={onActivate}
      onClick={onCardClick}
      draggable={row.drag != null}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-live={isLive || undefined}
      className={`group flex cursor-grab select-none flex-wrap items-center gap-2 rounded-lg border border-l-4 p-2 transition-all active:cursor-grabbing ${dragging ? 'opacity-75' : ''} ${
        isLive
          ? 'border-danger/70 border-l-danger bg-danger/10 shadow-[0_0_14px_rgba(239,68,68,0.45)]'
          : selected
            ? 'border-l-accent border-accent/60 bg-accent/10'
            : 'border-l-transparent border-line bg-panel-2 hover:border-fg/25 hover:bg-fg/[0.07]'
      }`}
    >
      <button
        ref={buttonRef}
        type="button"
        onFocus={onActivate}
        onKeyDown={onRowKey}
        // Space is Go Live on a song, so the browser's own click on Space is held back, on both key events.
        onKeyUp={(e) => row.hymnId != null && e.key === ' ' && e.preventDefault()}
        aria-pressed={row.tickable ? selected : undefined}
        aria-describedby="pw-lib-keys"
        className="flex min-h-11 min-w-0 flex-1 flex-col rounded-lg px-2 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold tracking-[0.18em] text-danger uppercase">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-danger" />
            {labels.live}
          </span>
        )}
        {!isLive && row.fits && <span className="text-[10px] font-extrabold tracking-[0.18em] text-ok uppercase">{labels.fits}</span>}
        <span className="w-full truncate font-semibold">{row.title}</span>
        <span className="w-full truncate text-xs text-muted">{row.sub}</span>
      </button>
      {row.extra}
      {/* Add goes straight to the open lineup card and leaves the selection as it is. It shows on hover, and on focus for the keyboard. */}
      <button
        type="button"
        className={`${ADD} opacity-70 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100`}
        disabled={!canAdd}
        aria-label={addAria}
        title={addAria}
        onClick={(e) => {
          e.stopPropagation();
          row.insert();
        }}
      >
        {addLabel}
      </button>
      {quick && (
        <button
          type="button"
          disabled={quick.pending}
          aria-label={`${labels.goLive}: ${row.title}`}
          title={quick.armed ? labels.confirm : `${labels.goLive} (Shift + Enter)`}
          onClick={(e) => {
            e.stopPropagation();
            // Shift + click is the deliberate click: it skips the confirm.
            onGoLive(e.shiftKey);
          }}
          className={`${GO_LIVE} ${
            isLive
              ? 'border-danger/60 bg-danger/15 text-danger hover:bg-danger/25'
              : quick.armed
                ? 'animate-pulse border-warn bg-warn text-on-accent'
                : 'border-danger bg-danger text-white hover:brightness-110'
          }`}
        >
          {isLive ? <Radio size={14} aria-hidden /> : <Zap size={14} aria-hidden />}
          {isLive ? labels.showing : quick.armed ? labels.confirm : labels.goLive}
        </button>
      )}
      {notice && (
        <p role="alert" className={`flex basis-full items-center gap-1.5 px-2 text-xs ${notice.kind === 'screen' ? 'text-warn' : 'text-danger'}`}>
          <AlertTriangle size={13} aria-hidden className="shrink-0" />
          {notice.text}
        </p>
      )}
    </li>
  );
}
