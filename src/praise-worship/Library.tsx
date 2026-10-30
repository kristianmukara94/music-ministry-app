import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Search, Tag } from 'lucide-react';
import { fitsSegment, GOSPEL_ACCLAMATION, holdsItem, songAssignment, songsOf, type PwSegment } from '../../shared/pw.js';
import { attachMany, describeAttach, type LibraryDrag, type LibraryDragBatch } from '../../shared/pw-attach.js';
import { bridge } from '../live/bridge';
import type { HymnSummary } from '../lyrics/types';
import { pad2 } from './LineupRail';
import { commitSegments, errorText, setPwState, setTag, updateSegment, usePw } from './store';
import { clickTick } from '../../shared/library-ticks.js';
import { usePwT } from './strings';

type LibTab = 'song' | 'prayer' | 'scripture';
const TABS: { id: LibTab; key: string }[] = [
  { id: 'song', key: 'lib_songs' },
  { id: 'prayer', key: 'lib_prayers' },
  { id: 'scripture', key: 'lib_scripture' },
];

const ADD = 'grid h-9 min-w-16 shrink-0 place-items-center rounded-md border border-fg/15 bg-panel-2 px-4 text-xs font-bold tracking-wide uppercase text-fg/85 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARY_BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-4 text-xs font-extrabold tracking-wide uppercase text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const INSERT_BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-xs font-semibold tracking-wide uppercase text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const SEARCH_DELAY_MS = 200;

/** Puts a song into the selected segment: replacing the one marked for Replace, filling a single slot, or adding the next one. */
function assignSong(index: number, segment: PwSegment, hymnId: number, replacing: number | null) {
  const patch = songAssignment(segment, hymnId, replacing);
  if (!patch) return;
  updateSegment(index, patch);
  setPwState({ replacing: null });
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

/** Arrow keys move between the tabs, as a tab list should. */
function onTabKey(e: KeyboardEvent, current: LibTab, set: (tab: LibTab) => void) {
  const at = TABS.findIndex((x) => x.id === current);
  const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : null;
  if (to === null) return;
  e.preventDefault();
  const next = TABS[(to + TABS.length) % TABS.length].id;
  set(next);
  document.getElementById(`pw-lib-tab-${next}`)?.focus();
}

/** One library result. The row's text is a button: pointing at it or focusing it previews it, Enter inserts it. */
interface Row {
  key: string;
  title: string;
  sub: string;
  fits?: boolean;
  /** What the row carries when it is dragged onto a lineup card. Every row can be dragged. */
  drag?: LibraryDrag;
  /** Set on a song or prayer row: the row has a tick box for multi-add. */
  tickable?: boolean;
  insert: () => void;
  added: boolean;
  extra?: ReactNode;
}

export function Library() {
  const t = usePwT();
  const session = usePw((s) => s.session)!;
  const selected = usePw((s) => s.selected);
  const prayers = usePw((s) => s.prayers);
  const tags = usePw((s) => s.tags);
  const replacing = usePw((s) => s.replacing);
  const libraryRevision = usePw((s) => s.libraryRevision);
  const segment = session.segments[selected];
  const [tab, setTab] = useState<LibTab>('song');
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<HymnSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  // The row a Shift + click range starts from: the last one clicked to select.
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);
  // The row being dragged, so it can show it.
  const [draggingKeys, setDraggingKeys] = useState<string[]>([]);
  const rowButtons = useRef<(HTMLButtonElement | null)[]>([]);

  // The tab follows the selected segment's type, so Add is ready for it.
  useEffect(() => {
    if (segment) setTab(segment.type === 'prayer' ? 'prayer' : segment.type === 'scripture' ? 'scripture' : 'song');
  }, [segment?.type, selected]);

  // Songs come from the Song Lyrics library: title, composer, key and lyrics are searched as the operator types.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      bridge.lyrics
        .listHymns({ search: query })
        .then((rows) => !cancelled && (setSongs(rows), setError(null)))
        .catch((err) => !cancelled && setError(errorText(err)));
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, libraryRevision]);

  // A new tab or a new search is a new list of rows, so a range cannot start from an old position.
  useEffect(() => setLastSelectedIndex(null), [tab, query]);

  const fail = (err: unknown) => setError(errorText(err));
  const replacingHere = replacing?.segment === selected;
  const q = query.trim().toLowerCase();

  /** Attaches one item to the selected card and reports it. A refused attach changes nothing and says why. */
  const attach = (drag: LibraryDrag) => {
    if (!segment) return;
    const result = attachMany(segment, [drag]);
    if (result.segment !== segment) commitSegments(session.segments.map((s, i) => (i === selected ? result.segment : s)));
    setPwState({ replacing: null });
    setAddNote(describeAttach(segment.name, drag.type, result));
  };

  const rows = useMemo<Row[]>(() => {
    if (tab === 'song') {
      const list = songs.map((h) => ({ h, fits: segment ? fitsSegment(h, segment, tags) : false }));
      // Songs that fit the selected segment come first; the rest keep the library's title order.
      return [...list.filter((r) => r.fits), ...list.filter((r) => !r.fits)].map(({ h, fits }): Row => {
        const tagged = Boolean(segment) && tags.some((x) => x.hymnId === h.id && x.segmentKey === segment.key);
        return {
          key: `song-${h.id}`,
          title: h.title,
          sub: [h.category, h.language, h.musicalKey].filter(Boolean).join(' · '),
          fits,
          drag: { type: 'song', id: h.id, title: h.title },
          tickable: true,
          // Replace swaps a song out. Otherwise the song joins the card's songs.
          insert: () => segment && (replacingHere ? assignSong(selected, segment, h.id, replacing!.hymnId) : attach({ type: 'song', id: h.id, title: h.title })),
          added: segment ? songsOf(segment).includes(h.id) : false,
          extra: segment && (
            <button
              type="button"
              aria-pressed={tagged}
              aria-label={t('tagHint', { title: h.title, segment: segment.name })}
              title={tagged ? t('tagged') : t('tag')}
              onClick={(e) => {
                e.stopPropagation();
                setTag(h.id, segment.key, !tagged).catch(fail);
              }}
              className={`grid size-11 shrink-0 place-items-center rounded-lg border transition ${
                tagged ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 text-muted hover:border-accent hover:text-fg'
              }`}
            >
              <Tag size={16} aria-hidden />
            </button>
          ),
        };
      });
    }
    if (tab === 'prayer') {
      return prayers
        .filter((p) => !q || `${p.title} ${p.body}`.toLowerCase().includes(q))
        .map((p): Row => ({
          key: `prayer-${p.id}`,
          tickable: true,
          title: p.title,
          sub: p.category,
          drag: { type: 'prayer', id: p.id, title: p.title },
          // An empty prayer slot takes the prayer; a card that already has one chains it after the last item.
          insert: () => attach({ type: 'prayer', id: p.id, title: p.title }),
          added: Boolean(segment && holdsItem(segment, { kind: 'prayer', noteId: p.id, minutes: 0 })),
        }));
    }
    // The title slide replaces the first item and keeps the chain. A reading fills a title-only card, and otherwise chains.
    const options = [
      { id: 'title', label: t('titleSlide'), sub: t('titleCardSub') },
      { id: GOSPEL_ACCLAMATION, label: GOSPEL_ACCLAMATION, sub: t('fromLectionary') },
    ];
    return options
      .filter((o) => !q || o.label.toLowerCase().includes(q))
      .map((o): Row => ({
        key: `scripture-${o.id}`,
        title: o.label,
        sub: o.sub,
        drag: { type: 'scripture', id: o.id, title: o.label },
        insert: () => attach({ type: 'scripture', id: o.id, title: o.label }),
        added: o.id === 'title' ? segment?.content.kind === 'title' : Boolean(segment && holdsItem(segment, { kind: 'lectionary', readingType: o.id, minutes: 0 })),
      }));
    // `t` changes identity every render, so it is left out; the language switch re-renders the rows anyway.
  }, [tab, songs, prayers, tags, segment, selected, q, replacingHere, replacing]);

  const active = rows.find((r) => r.key === activeKey) ?? null;
  const canInsert = (row: Row | null) => Boolean(row && segment && !row.added);

  const activate = (row: Row) => setActiveKey(row.key);

  /**
   * A click anywhere on a card. A plain click selects only this card. Ctrl or Cmd + click toggles this card and keeps the rest. Shift + click
   * adds every card from the last one clicked to this one. The rule is `clickTick`, in shared/library-ticks.js.
   */
  const handleCardClick = (e: MouseEvent, index: number, row: Row) => {
    activate(row);
    if (!row.tickable) return;
    // Shift + click would otherwise highlight the text between the two rows.
    if (e.shiftKey) e.preventDefault();
    const next = clickTick(
      ticked,
      rows.map((r) => r.key),
      lastSelectedIndex,
      index,
      { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey },
    );
    setTicked(next.ticked);
    setLastSelectedIndex(next.anchor);
  };

  /** Attaches this tab's ticked items to the selected card, in the order they were ticked. Ticks of this tab are cleared. */
  const addSelected = () => {
    if (!segment || tab === 'scripture') return;
    const prefix = `${tab}-`;
    const drags = ticked.filter((k) => k.startsWith(prefix)).map((k): LibraryDrag => ({ type: tab, id: Number(k.slice(prefix.length)), title: '' }));
    const result = attachMany(segment, drags);
    if (result.segment !== segment) commitSegments(session.segments.map((s, i) => (i === selected ? result.segment : s)));
    setTicked(ticked.filter((k) => !k.startsWith(prefix)));
    setAddNote(describeAttach(segment.name, tab, result));
  };

  const onRowKey =(e: KeyboardEvent<HTMLButtonElement>, row: Row, i: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rowButtons.current[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canInsert(row)) row.insert();
    }
  };

  return (
    <section aria-labelledby="pw-library-heading" className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="pw-library-heading" className="text-lg font-bold tracking-tight text-fg">{t('library')}</h2>
        {segment && (
          <span className="inline-flex max-w-full items-center rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <span className="truncate">{t('addsTo', { n: pad2(selected + 1) })} · {segment.name}</span>
          </span>
        )}
      </div>

      <label className="flex h-10 items-center gap-3 rounded-lg border border-fg/15 bg-panel-2 px-3 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40">
        <Search size={18} className="shrink-0 text-muted" aria-hidden />
        <span className="sr-only">{t('search')}</span>
        <input
          id="pw-library-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              rowButtons.current[0]?.focus();
            }
          }}
          placeholder={t('search')}
          aria-describedby="pw-lib-keys"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
        />
      </label>
      <p id="pw-lib-keys" className="sr-only">{t('resultKeys')}</p>

      <div role="tablist" aria-label={t('library')} className="flex border-b border-line">
        {TABS.map((x) => (
          <button
            key={x.id}
            id={`pw-lib-tab-${x.id}`}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            aria-controls="pw-lib-panel"
            tabIndex={tab === x.id ? 0 : -1}
            onClick={() => setTab(x.id)}
            onKeyDown={(e) => onTabKey(e, tab, setTab)}
            className={`-mb-px min-h-11 border-b-2 px-3 text-[15px] font-semibold transition-all duration-300 ${
              tab === x.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t(x.key)}
            {tab === x.id && <span className="ml-2 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">{rows.length}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={INSERT_BTN} disabled={!canInsert(active)} onClick={() => active?.insert()}>
          {t('insertInto')}
        </button>
        {(tab === 'song' || tab === 'prayer') && (
          <button type="button" className={PRIMARY_BTN} disabled={!segment || ticked.every((k) => !k.startsWith(`${tab}-`))} onClick={addSelected}>
            Add selected{ticked.some((k) => k.startsWith(`${tab}-`)) ? ` (${ticked.filter((k) => k.startsWith(`${tab}-`)).length})` : ''}
          </button>
        )}
      </div>
      {addNote && <p role="status" className="px-1 text-sm text-muted">{addNote}</p>}
      {error && <p role="alert" className="px-1 text-sm text-danger">{error}</p>}

      <ul id="pw-lib-panel" role="tabpanel" aria-labelledby={`pw-lib-tab-${tab}`} className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
        {rows.length === 0 && tab === 'song' && <li className="p-3 text-sm text-muted">{t('noSongs')}</li>}
        {rows.length === 0 && tab === 'prayer' && <li className="p-3 text-sm text-muted">{t('noPrayers')}</li>}
        {rows.map((row, i) => {
          const selected = ticked.includes(row.key);
          return (
            <li
              key={row.key}
              onMouseEnter={() => activate(row)}
              onClick={(e) => handleCardClick(e, i, row)}
              draggable={row.drag != null}
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
              className={`group flex cursor-grab select-none items-center gap-2 rounded-lg border border-l-4 p-2 transition-all active:cursor-grabbing ${draggingKeys.includes(row.key) ? 'opacity-75' : ''} ${
                selected
                  ? 'border-l-accent border-accent/60 bg-accent/10'
                  : 'border-l-transparent border-line bg-panel-2 hover:border-fg/25 hover:bg-fg/[0.07]'
              }`}
            >
              <button
                ref={(el) => {
                  rowButtons.current[i] = el;
                }}
                type="button"
                onFocus={() => activate(row)}
                onKeyDown={(e) => onRowKey(e, row, i)}
                aria-pressed={row.tickable ? selected : undefined}
                aria-describedby="pw-lib-keys"
                className="flex min-h-11 min-w-0 flex-1 flex-col rounded-lg px-2 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                {row.fits && <span className="text-[10px] font-extrabold tracking-[0.18em] text-ok uppercase">{t('fits')}</span>}
                <span className="w-full truncate font-semibold">{row.title}</span>
                <span className="w-full truncate text-xs text-muted">{row.sub}</span>
              </button>
              {row.extra}
              {/* Add goes straight to the open lineup card and leaves the selection as it is. It shows on hover, and on focus for the keyboard. */}
              <button
                type="button"
                className={`${ADD} opacity-70 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100`}
                disabled={!canInsert(row)}
                aria-label={segment ? t('addTo', { title: row.title, segment: segment.name }) : t('add')}
                onClick={(e) => {
                  e.stopPropagation();
                  row.insert();
                }}
              >
                {replacingHere && tab === 'song' ? t('replace') : t('add')}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="px-1 text-xs leading-relaxed text-muted">{t('libraryFootnote')}</p>
    </section>
  );
}
