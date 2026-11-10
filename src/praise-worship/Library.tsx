import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Search, Tag } from 'lucide-react';
import { fitsSegment, GOSPEL_ACCLAMATION, holdsItem, songAssignment, songsOf, type PwSegment } from '../../shared/pw.js';
import { attachMany, describeAttach, type LibraryDrag } from '../../shared/pw-attach.js';
import { CategorySelectGroup } from '../lyrics/CategorySelectGroup';
import { useSongFilter } from '../lyrics/useSongFilter';
import { useLyT } from '../lyrics/strings';
import { pad2 } from './LineupRail';
import { commitSegments, errorText, setPwState, setTag, updateSegment, usePw } from './store';
import { clickTick } from '../../shared/library-ticks.js';
import { usePwT } from './strings';
import { LibrarySearchContainer, type LibrarySearchHandle } from './LibrarySearchContainer';
import type { LibraryRow as Row } from './SongSearchResultCard';
import type { QuickLive } from './useQuickLiveController';
import { QuickCuePanel } from './QuickCuePanel';
import { isGoLiveCopy } from '../notes/slideCopies';

type LibTab = 'song' | 'prayer' | 'scripture';
const TABS: { id: LibTab; key: string }[] = [
  { id: 'song', key: 'lib_songs' },
  { id: 'prayer', key: 'lib_prayers' },
  { id: 'scripture', key: 'lib_scripture' },
];

const PRIMARY_BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-4 text-xs font-extrabold tracking-wide uppercase text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const INSERT_BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-xs font-semibold tracking-wide uppercase text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';

/** Puts a song into the selected segment: replacing the one marked for Replace, filling a single slot, or adding the next one. */
function assignSong(index: number, segment: PwSegment, hymnId: number, replacing: number | null) {
  const patch = songAssignment(segment, hymnId, replacing);
  if (!patch) return;
  updateSegment(index, patch);
  setPwState({ replacing: null });
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

export function Library({ quick, focused = false }: { quick: QuickLive; focused?: boolean }) {
  const t = usePwT();
  const session = usePw((s) => s.session)!;
  const selected = usePw((s) => s.selected);
  const prayers = usePw((s) => s.prayers);
  const tags = usePw((s) => s.tags);
  const replacing = usePw((s) => s.replacing);
  const libraryRevision = usePw((s) => s.libraryRevision);
  const segment = session.segments[selected];
  const [tab, setTab] = useState<LibTab>('song');
  // The search and the scope. It starts on General, which shows every song, so the library looks as it did until the operator narrows it.
  const filter = useSongFilter({ refreshKey: libraryRevision });
  const { query, hymns: songs } = filter;
  const lt = useLyT();
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  // The row a Shift + click range starts from: the last one clicked to select.
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);
  const results = useRef<LibrarySearchHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  // The tab follows the selected segment's type, so Add is ready for it.
  useEffect(() => {
    if (segment) setTab(segment.type === 'prayer' ? 'prayer' : segment.type === 'scripture' ? 'scripture' : 'song');
  }, [segment?.type, selected]);


  // A new tab or a new search is a new list of rows, so a range cannot start from an old position.
  useEffect(() => setLastSelectedIndex(null), [tab, query]);

  // Ctrl + F (Cmd + F) jumps to the search box while the Library is open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          hymnId: h.id,
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
      // The library offers Hub entries only: a card's own Go Live copy stays on that card.
      return prayers
        .filter((p) => !isGoLiveCopy(p) && (!q || `${p.title} ${p.body}`.toLowerCase().includes(q)))
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
          ref={searchInput}
          type="search"
          value={query}
          onChange={(e) => filter.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              results.current?.focusRow(0);
            } else if (e.key === 'Enter') {
              // Enter adds the song under the pointer or focus, or the first result. Shift + Enter puts a song on the projector.
              const row = active ?? rows[0] ?? null;
              if (!row) return;
              e.preventDefault();
              if (e.shiftKey && row.hymnId != null) quick.goLive(row.hymnId, row.title, true);
              else if (canInsert(row)) row.insert();
            }
          }}
          placeholder={t('search')}
          aria-describedby="pw-lib-keys"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
        />
      </label>
      {tab === 'song' && (
        <CategorySelectGroup
          t={lt}
          mode="filter"
          compact
          scopeOnly
          idPrefix="pw-lib"
          scope={filter.scope}
          onScope={filter.setScope}
          songCategory={filter.songCategory}
          onSongCategory={filter.setSongCategory}
          categories={filter.categories}
        />
      )}
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
      {(error ?? filter.error) && <p role="alert" className="px-1 text-sm text-danger">{error ?? filter.error}</p>}

      <LibrarySearchContainer
        ref={results}
        rows={rows}
        tab={tab}
        ticked={ticked}
        quick={quick}
        t={t}
        replacing={replacingHere && tab === 'song'}
        segmentName={segment?.name ?? null}
        canInsert={canInsert}
        onActivate={activate}
        onCardClick={handleCardClick}
      />
      {/* In the Go Live focus view the cues are drawn in the takeover instead, so they are never mounted twice. */}
      {!focused && <QuickCuePanel quick={quick} t={t} />}
      {quick.toast && <p role="status" className="px-1 text-sm font-semibold text-ok">{quick.toast}</p>}
      {quick.offPlan.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted" title={quick.offPlan.map((x) => x.title).join(', ')}>
            {t('offPlan', { n: quick.offPlan.length })}
          </p>
          {quick.canResume && (
            <button type="button" className={INSERT_BTN} onClick={() => quick.resumeLineup()}>
              {t('backToLineup')}
            </button>
          )}
        </div>
      )}

      <p className="px-1 text-xs leading-relaxed text-muted">{t('libraryFootnote')}</p>
    </section>
  );
}
