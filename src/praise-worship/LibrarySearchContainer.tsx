import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useArmedLive } from '../planner/useArmedLive';
import { textCaseClass, usePlannerTextCase } from '../planner/textCase';
import type { LibraryDragBatch } from '../../shared/pw-attach.js';
import { setPwState } from './store';
import { isTextEntry } from './textEntry';
import { SongSearchResultCard, type LibraryRow } from './SongSearchResultCard';
import { SongLyricsPreview } from './SongLyricsPreview';
import type { QuickLive } from './useQuickLiveController';
import type { PwT } from './strings';

export interface LibrarySearchHandle {
  /** Moves keyboard focus to a result, so the arrow keys carry on from there. */
  focusRow(index: number): void;
}

interface Props {
  rows: LibraryRow[];
  tab: string;
  ticked: string[];
  quick: QuickLive;
  t: PwT;
  replacing: boolean;
  /** The open lineup card's name, or null when there is none. */
  segmentName: string | null;
  canInsert: (row: LibraryRow | null) => boolean;
  onActivate: (row: LibraryRow) => void;
  onCardClick: (e: MouseEvent, index: number, row: LibraryRow) => void;
  /** The search as typed, marked inside an open lyrics preview. */
  query?: string;
  /** Opens the Edit Hymn form for a song, over the planner. */
  onEditSong?: (hymnId: number) => void;
  /** The Song Category the list is filtered by: that badge is highlighted on each song card. Empty for all categories. */
  activeCategory?: string;
}

/** A small label to drag in place of the card when several are dragged together. */
function dragBadge(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.className = 'rounded-lg border border-accent/60 bg-panel-2 px-3 py-1.5 text-sm font-bold text-accent';
  el.style.position = 'fixed';
  el.style.top = '-1000px';
  document.body.appendChild(el);
  // The browser takes its picture of the element when the drag starts, so it can go straight after.
  window.setTimeout(() => el.remove(), 0);
  return el;
}

/**
 * The list of library results, with the keyboard rules in one place:
 * Arrow Up / Down move between results, Enter adds the one under focus, and Shift + Enter or Space puts a song on the projector at once.
 * It also draws each song's Go Live state from the quick-live controller.
 */
export const LibrarySearchContainer = forwardRef<LibrarySearchHandle, Props>(function LibrarySearchContainer(
  { rows, tab, ticked, quick, t, replacing, segmentName, canInsert, onActivate, onCardClick, query = '', onEditSong, activeCategory = '' },
  ref,
) {
  const rowButtons = useRef<(HTMLButtonElement | null)[]>([]);
  // The rows being dragged, so they can show it.
  const [draggingKeys, setDraggingKeys] = useState<string[]>([]);
  // The song cards whose lyrics are open, by row key. Each opens and closes on its own.
  const [openLyrics, setOpenLyrics] = useState<string[]>([]);
  const toggleLyrics = (key: string) => setOpenLyrics((open) => (open.includes(key) ? open.filter((k) => k !== key) : [...open, key]));

  // LIVE on a prayer or scripture row: armed first while a Holy Mass or Praise & Worship slide is on air (see useArmedLive).
  const runDirect = useCallback(async (key: string) => {
    await rows.find((r) => r.key === key)?.goLive?.();
  }, [rows]);
  const direct = useArmedLive(runDirect);
  // The Planner's text case for the inline lyrics drawers (on screen only).
  const caseClass = textCaseClass(usePlannerTextCase((s) => s.mode));

  useImperativeHandle(ref, () => ({ focusRow: (index) => rowButtons.current[index]?.focus() }), []);

  const goLive = (row: LibraryRow, immediate: boolean) => {
    if (row.hymnId == null) return;
    // The song already on screen: its button brings the cue panel back into view instead of showing stanza 1 again.
    if (row.hymnId === quick.liveHymnId && !immediate) quick.focusCue();
    else quick.goLive(row.hymnId, row.title, immediate);
  };

  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, row: LibraryRow, i: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rowButtons.current[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (row.hymnId != null && ((e.key === 'Enter' && e.shiftKey) || (e.key === ' ' && !isTextEntry(e.target)))) {
      // The keyboard is the deliberate path: no confirm click. Space only counts on the card itself: in a text field it is a space.
      e.preventDefault();
      if (!e.repeat) {
        goLive(row, true);
        // Focus leaves the list, so the arrow keys and Space step through the song's stanzas from here on.
        e.currentTarget.blur();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canInsert(row)) row.insert();
    }
  };

  return (
    // Stacked, the list is capped at 60% of the window. In the pinned two-column panel it takes the room the locked controls leave, and only it
    // scrolls; overscroll-contain keeps a scroll at its end from moving the page behind it.
    <ul
      id="pw-lib-panel"
      role="tabpanel"
      aria-labelledby={`pw-lib-tab-${tab}`}
      className="flex max-h-[60vh] min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1 @4xl/pw:max-h-none @4xl/pw:min-h-40"
    >
      {rows.length === 0 && tab === 'song' && <li className="p-3 text-sm text-muted">{t('noSongs')}</li>}
      {rows.length === 0 && tab === 'prayer' && <li className="p-3 text-sm text-muted">{t('noPrayers')}</li>}
      {rows.map((row, i) => {
        const hymnId = row.hymnId;
        const lyricsOpen = openLyrics.includes(row.key);
        const edit = () => hymnId != null && onEditSong?.(hymnId);
        return (
          <SongSearchResultCard
            key={row.key}
            row={row}
            selected={ticked.includes(row.key)}
            activeCategory={activeCategory}
            dragging={draggingKeys.includes(row.key)}
            addLabel={replacing && tab === 'song' ? t('replace') : t('add')}
            addAria={segmentName ? t('addTo', { title: row.title, segment: segmentName }) : t('add')}
            canAdd={canInsert(row)}
            quick={
              hymnId == null
                ? null
                : {
                    isLive: quick.liveHymnId === hymnId,
                    armed: quick.armedId === hymnId,
                    pending: quick.pendingId === hymnId,
                    notice: quick.notice?.hymnId === hymnId ? quick.notice : null,
                  }
            }
            buttonRef={(el) => {
              rowButtons.current[i] = el;
            }}
            onActivate={() => onActivate(row)}
            onCardClick={(e) => onCardClick(e, i, row)}
            onDragStart={(e) => {
              if (!row.drag) return;
              // A card in the selection drags the whole selection, in the order it is listed. Any other card drags alone.
              const dragged = row.tickable && ticked.includes(row.key) ? rows.filter((r) => r.drag && ticked.includes(r.key)) : [row];
              const payload: LibraryDragBatch = {
                type: row.drag.type,
                items: dragged.flatMap((r) => (r.drag ? [{ id: r.drag.id, title: r.drag.title }] : [])),
              };
              // The items are copied onto a card, not moved out of the Library.
              e.dataTransfer.setData('application/json', JSON.stringify(payload));
              e.dataTransfer.setData('text/plain', dragged.map((r) => r.title).join('\n'));
              e.dataTransfer.effectAllowed = 'copy';
              // One label stands for the batch, so a single card does not look like the whole of it.
              if (dragged.length > 1) e.dataTransfer.setDragImage(dragBadge(t('itemsCount', { n: dragged.length })), 12, 12);
              setPwState({ libDrag: payload });
              setDraggingKeys(dragged.map((r) => r.key));
            }}
            onDragEnd={() => {
              setPwState({ libDrag: null });
              setDraggingKeys([]);
            }}
            onRowKey={(e) => onRowKey(e, row, i)}
            onGoLive={(immediate) => goLive(row, immediate)}
            labels={{ fits: t('fits'), live: t('currentlyLive'), goLive: t('goLiveNow'), liveShort: t('liveShort'), confirm: t('goLiveConfirm'), showing: t('onScreen') }}
            direct={
              hymnId == null && row.goLive
                ? { armed: direct.armed === row.key, pending: direct.pending === row.key, onPress: (immediate) => direct.press(row.key, immediate) }
                : null
            }
            lyrics={
              hymnId == null || !onEditSong
                ? undefined
                : {
                    open: lyricsOpen,
                    onToggle: () => toggleLyrics(row.key),
                    onEdit: edit,
                    labels: { show: t('showLyrics'), hide: t('hideLyrics'), edit: t('editSong') },
                    preview: lyricsOpen ? (
                      <div className={`basis-full ${caseClass}`}>
                        <SongLyricsPreview hymnId={hymnId} query={query} t={t} canAdd={canInsert(row)} onAdd={() => row.insert()} onEdit={edit} />
                      </div>
                    ) : null,
                  }
            }
          />
        );
      })}
    </ul>
  );
});
