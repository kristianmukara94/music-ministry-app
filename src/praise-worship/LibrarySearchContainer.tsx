import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { LibraryDragBatch } from '../../shared/pw-attach.js';
import { setPwState } from './store';
import { isTextEntry } from './textEntry';
import { SongSearchResultCard, type LibraryRow } from './SongSearchResultCard';
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
  { rows, tab, ticked, quick, t, replacing, segmentName, canInsert, onActivate, onCardClick },
  ref,
) {
  const rowButtons = useRef<(HTMLButtonElement | null)[]>([]);
  // The rows being dragged, so they can show it.
  const [draggingKeys, setDraggingKeys] = useState<string[]>([]);

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
    <ul id="pw-lib-panel" role="tabpanel" aria-labelledby={`pw-lib-tab-${tab}`} className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
      {rows.length === 0 && tab === 'song' && <li className="p-3 text-sm text-muted">{t('noSongs')}</li>}
      {rows.length === 0 && tab === 'prayer' && <li className="p-3 text-sm text-muted">{t('noPrayers')}</li>}
      {rows.map((row, i) => {
        const hymnId = row.hymnId;
        return (
          <SongSearchResultCard
            key={row.key}
            row={row}
            selected={ticked.includes(row.key)}
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
            labels={{ fits: t('fits'), live: t('currentlyLive'), goLive: t('goLiveNow'), confirm: t('goLiveConfirm'), showing: t('onScreen') }}
          />
        );
      })}
    </ul>
  );
});
