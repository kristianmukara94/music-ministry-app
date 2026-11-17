import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { AlertTriangle, Eye, EyeOff, PenLine } from 'lucide-react';
import { LiveButton } from '../components/LiveButton';
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
  /** Set on a song row: every song category the song is filed under, primary first. Each is badged on the card. */
  categories?: string[];
  /**
   * Set on a prayer or scripture row: LIVE puts it on the projector now, without adding it to the lineup. A song row goes live through
   * `hymnId` and the quick-live controller instead.
   */
  goLive?: () => Promise<void>;
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

// Compact actions: small padding and gaps, so the song title keeps the row's width.
const ADD = 'grid h-8 shrink-0 place-items-center rounded-md border border-fg/15 bg-panel-2 px-2 text-[11px] font-bold tracking-wide uppercase text-fg/85 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';

interface Props {
  row: LibraryRow;
  selected: boolean;
  /** The Song Category the Library is filtered by: its badge is highlighted. Empty when every category is shown. */
  activeCategory?: string;
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
  /** `goLive` is the tooltip (Go Live Now); `liveShort` is the button's own label (LIVE). */
  labels: { fits: string; live: string; goLive: string; liveShort: string; confirm: string; showing: string };
  /** A prayer or scripture row's LIVE state: armed for a second press, or showing. Null for a row without LIVE. */
  direct?: { armed: boolean; pending: boolean; onPress: (immediate: boolean) => void } | null;
  /**
   * Song rows only: the Show Lyrics toggle and the Edit Song button, and the preview drawn under the card while it is open. Neither button
   * ticks the card or adds the song.
   */
  lyrics?: { open: boolean; onToggle: () => void; onEdit: () => void; labels: { show: string; hide: string; edit: string }; preview: ReactNode };
}

/**
 * A library result card. A song card has two actions: Add (quiet, queues it in the open lineup card) and Go Live (loud, shows stanza 1 on the
 * projector now). The song on the projector wears a pulsing badge and a glow, so the operator sees what the congregation sees.
 */
const ICON_BTN =
  'grid size-8 shrink-0 place-items-center rounded-lg border transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none';

export function SongSearchResultCard({ row, selected, activeCategory = '', dragging, addLabel, addAria, canAdd, quick, buttonRef, onActivate, onCardClick, onDragStart, onDragEnd, onRowKey, onGoLive, labels, lyrics, direct = null }: Props) {
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
        // The title block takes the room the actions leave, and never less than 9rem: on a narrow (split-screen) panel the actions move to a
        // line of their own rather than squeezing the title to a letter or two.
        className="flex min-h-11 min-w-0 flex-[1_1_9rem] flex-col rounded-lg px-2 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold tracking-[0.18em] text-danger uppercase">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-danger" />
            {labels.live}
          </span>
        )}
        {!isLive && row.fits && <span className="text-[10px] font-extrabold tracking-[0.18em] text-ok uppercase">{labels.fits}</span>}
        <span data-row-title className="line-clamp-2 w-full break-words font-semibold leading-snug">{row.title}</span>
        <span className="line-clamp-2 w-full break-words text-xs text-muted">{row.sub}</span>
        {row.categories && row.categories.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {row.categories.map((c) => (
              <span
                key={c}
                data-active-category={c.toLowerCase() === activeCategory.toLowerCase() || undefined}
                className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${
                  c.toLowerCase() === activeCategory.toLowerCase() ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line-strong bg-surface-2 text-fg/80'
                }`}
              >
                {c}
              </span>
            ))}
          </span>
        )}
      </button>
      <div data-row-actions className="ml-auto flex shrink-0 items-center gap-1">
      {lyrics && (
        <>
          <button
            type="button"
            aria-expanded={lyrics.open}
            aria-label={`${lyrics.open ? lyrics.labels.hide : lyrics.labels.show}: ${row.title}`}
            title={lyrics.open ? lyrics.labels.hide : lyrics.labels.show}
            onClick={(e) => {
              e.stopPropagation();
              lyrics.onToggle();
            }}
            className={`${ICON_BTN} ${lyrics.open ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 text-muted hover:border-accent hover:text-fg'}`}
          >
            {lyrics.open ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </button>
          <button
            type="button"
            aria-label={`${lyrics.labels.edit}: ${row.title}`}
            title={lyrics.labels.edit}
            onClick={(e) => {
              e.stopPropagation();
              lyrics.onEdit();
            }}
            className={`${ICON_BTN} border-fg/15 text-muted hover:border-accent hover:text-fg`}
          >
            <PenLine size={14} aria-hidden />
          </button>
        </>
      )}
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
      {/* LIVE: the song (or the prayer or reading) on the projector now. Shift + click is the deliberate click: it skips the confirm. */}
      {quick && (
        <LiveButton
          title={row.title}
          labels={{ live: labels.liveShort, hint: labels.goLive, confirm: labels.confirm, showing: labels.showing }}
          armed={quick.armed}
          pending={quick.pending}
          isLive={isLive}
          onPress={onGoLive}
        />
      )}
      {!quick && direct && (
        <LiveButton
          title={row.title}
          labels={{ live: labels.liveShort, hint: labels.goLive, confirm: labels.confirm }}
          armed={direct.armed}
          pending={direct.pending}
          onPress={direct.onPress}
        />
      )}
      </div>
      {lyrics?.open && lyrics.preview}
      {notice && (
        <p role="alert" className={`flex basis-full items-center gap-1.5 px-2 text-xs ${notice.kind === 'screen' ? 'text-warn' : 'text-danger'}`}>
          <AlertTriangle size={13} aria-hidden className="shrink-0" />
          {notice.text}
        </p>
      )}
    </li>
  );
}
