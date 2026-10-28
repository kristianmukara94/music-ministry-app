import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Search, Tag } from 'lucide-react';
import { acceptsTab, fitsSegment, GOSPEL_ACCLAMATION, scriptureAssignment, songAssignment, type PwContent, type PwSegment, type PwType } from '../../shared/pw.js';
import { bridge } from '../live/bridge';
import type { HymnSummary } from '../lyrics/types';
import { pad2 } from './LineupRail';
import { commitSegments, errorText, setPwState, setTag, updateSegment, usePw } from './store';
import { addTicked, toggleTick } from '../../shared/library-ticks.js';
import { usePwT, type PwT } from './strings';

type LibTab = 'song' | 'prayer' | 'scripture';
const TABS: { id: LibTab; key: string }[] = [
  { id: 'song', key: 'lib_songs' },
  { id: 'prayer', key: 'lib_prayers' },
  { id: 'scripture', key: 'lib_scripture' },
];
const TYPE_FOR_TAB: Record<LibTab, PwType> = { song: 'song', prayer: 'prayer', scripture: 'scripture' };

const ADD = 'grid min-h-11 min-w-16 shrink-0 place-items-center rounded-xl border border-line-strong px-4 text-sm font-bold transition hover:border-accent hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40';
const INSERT_BTN = 'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line-strong px-3 text-sm font-semibold transition hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40';
const SEARCH_DELAY_MS = 200;

/** Puts a song into the selected segment: replacing the one marked for Replace, filling a single slot, or adding the next one. */
function assignSong(index: number, segment: PwSegment, hymnId: number, replacing: number | null) {
  const patch = songAssignment(segment, hymnId, replacing);
  if (!patch) return;
  updateSegment(index, patch);
  setPwState({ replacing: null });
}

/** Why Add is disabled for this tab, or null when it can add. */
function blockedReason(segment: PwSegment | undefined, tab: LibTab, t: PwT, replacing: boolean): string | null {
  if (!segment) return null;
  if (!acceptsTab(segment, TYPE_FOR_TAB[tab])) return t('wrongType', { type: t(`type_${TYPE_FOR_TAB[tab]}`).toLowerCase() });
  const c = segment.content;
  if (c.kind === 'song' && c.maxSongs > 1 && c.hymnIds.length >= c.maxSongs && !replacing) return t('full');
  return null;
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
  /** Set on a song row: the row can be dragged onto a lineup slot. */
  songId?: number;
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
  const [addNote, setAddNote] = useState<string | null>(null);
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

  const fail = (err: unknown) => setError(errorText(err));
  const replacingHere = replacing?.segment === selected;
  const blocked = blockedReason(segment, tab, t, replacingHere);
  const q = query.trim().toLowerCase();

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
          songId: h.id,
          tickable: true,
          insert: () => segment && assignSong(selected, segment, h.id, replacingHere ? replacing!.hymnId : null),
          added: segment?.content.kind === 'song' && segment.content.hymnIds.includes(h.id),
          extra: segment && (
            <button
              type="button"
              aria-pressed={tagged}
              aria-label={t('tagHint', { title: h.title, segment: segment.name })}
              title={tagged ? t('tagged') : t('tag')}
              onClick={() => setTag(h.id, segment.key, !tagged).catch(fail)}
              className={`grid size-11 shrink-0 place-items-center rounded-xl border transition ${
                tagged ? 'border-accent bg-accent text-on-accent' : 'border-line-strong text-muted hover:border-accent hover:text-fg'
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
          insert: () => {
            updateSegment(selected, { content: { kind: 'prayer', noteId: p.id } });
            setPwState({ replacing: null });
          },
          added: segment?.content.kind === 'prayer' && segment.content.noteId === p.id,
        }));
    }
    const options: { label: string; sub: string; content: PwContent }[] = [
      { label: t('titleSlide'), sub: t('titleCardSub'), content: { kind: 'title' } },
      { label: GOSPEL_ACCLAMATION, sub: t('fromLectionary'), content: { kind: 'lectionary', readingType: GOSPEL_ACCLAMATION } },
    ];
    return options
      .filter((o) => !q || o.label.toLowerCase().includes(q))
      .map((o): Row => ({
        key: `scripture-${o.content.kind}`,
        title: o.label,
        sub: o.sub,
        insert: () => {
          const patch = segment && scriptureAssignment(segment, o.content);
          if (patch) updateSegment(selected, patch);
        },
        added: JSON.stringify(segment?.content) === JSON.stringify(o.content),
      }));
    // `t` changes identity every render, so it is left out; the language switch re-renders the rows anyway.
  }, [tab, songs, prayers, tags, segment, selected, q, replacingHere, replacing]);

  const active = rows.find((r) => r.key === activeKey) ?? null;
  const canInsert = (row: Row | null) => Boolean(row && segment && !blocked && !row.added);

  const activate = (row: Row) => setActiveKey(row.key);


  /** Adds this tab's ticked items to the empty slots of their type, in the order they were ticked. Ticks of this tab are cleared. */
  const addSelected = () => {
    if (!segment) return;
    const result = addTicked(session.segments, ticked, tab);
    commitSegments(result.segments);
    setTicked(ticked.filter((k) => !k.startsWith(`${tab}-`)));
    const parts = [`${result.added} added.`];
    if (result.skipped) parts.push(`${result.skipped} already in the lineup.`);
    if (result.left) parts.push(`${result.left} not added: no empty slot left.`);
    setAddNote(parts.join(' '));
  };

  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, row: Row, i: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rowButtons.current[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canInsert(row)) row.insert();
    }
  };

  return (
    <section aria-labelledby="pw-library-heading" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="pw-library-heading" className="text-lg font-bold">{t('library')}</h2>
        {segment && <span className="text-sm text-muted">{t('addsTo', { n: pad2(selected + 1) })}</span>}
      </div>

      <label className="flex h-12 items-center gap-3 rounded-xl border border-line-strong bg-canvas/40 px-4 focus-within:border-accent">
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
            className={`-mb-px min-h-11 border-b-2 px-3 text-[15px] font-semibold transition ${
              tab === x.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t(x.key)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={INSERT_BTN} disabled={!canInsert(active)} onClick={() => active?.insert()}>
          {t('insertInto')}
        </button>
      </div>

      {(tab === 'song' || tab === 'prayer') && (
        <div className="flex flex-wrap items-center gap-3 px-1">
          <button type="button" className={INSERT_BTN} disabled={!segment || ticked.every((k) => !k.startsWith(`${tab}-`))} onClick={addSelected}>
            Add selected
          </button>
          {addNote && <p role="status" className="text-sm text-muted">{addNote}</p>}
        </div>
      )}
      {blocked && <p className="px-1 text-sm text-muted">{blocked}</p>}
      {error && <p role="alert" className="px-1 text-sm text-danger">{error}</p>}

      <ul id="pw-lib-panel" role="tabpanel" aria-labelledby={`pw-lib-tab-${tab}`} className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
        {rows.length === 0 && tab === 'song' && <li className="p-3 text-sm text-muted">{t('noSongs')}</li>}
        {rows.length === 0 && tab === 'prayer' && <li className="p-3 text-sm text-muted">{t('noPrayers')}</li>}
        {rows.map((row, i) => (
          <li
            key={row.key}
            onMouseEnter={() => activate(row)}
            className={`flex items-center gap-2 rounded-xl border p-2 ${row.key === activeKey ? 'border-accent bg-panel-2' : 'border-line bg-canvas/30'}`}
          >
            {row.tickable && (
              <input
                type="checkbox"
                checked={ticked.includes(row.key)}
                onChange={() => setTicked(toggleTick(ticked, row.key))}
                aria-label={`Select ${row.title}`}
                className="size-5 shrink-0"
              />
            )}
            <button
              ref={(el) => {
                rowButtons.current[i] = el;
              }}
              type="button"
              onFocus={() => activate(row)}
              onClick={() => activate(row)}
              onKeyDown={(e) => onRowKey(e, row, i)}
              draggable={row.songId != null}
              onDragStart={(e) => {
                if (row.songId == null) return;
                // A song is copied into a slot, not moved out of the list.
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', row.title);
                setPwState({ songDrag: row.songId });
              }}
              onDragEnd={() => setPwState({ songDrag: null })}
              aria-describedby="pw-lib-keys"
              className="flex min-h-11 min-w-0 flex-1 flex-col rounded-lg px-2 py-1 text-left"
            >
              {row.fits && <span className="text-[10px] font-extrabold tracking-[0.18em] text-ok uppercase">{t('fits')}</span>}
              <span className="w-full truncate font-semibold">{row.title}</span>
              <span className="w-full truncate text-xs text-muted">{row.sub}</span>
            </button>
            {row.extra}
            <button
              type="button"
              className={ADD}
              disabled={!canInsert(row)}
              aria-label={segment ? t('addTo', { title: row.title, segment: segment.name }) : t('add')}
              onClick={row.insert}
            >
              {replacingHere && tab === 'song' ? t('replace') : t('add')}
            </button>
          </li>
        ))}
      </ul>

      <p className="px-1 text-xs leading-relaxed text-muted">{t('libraryFootnote')}</p>
    </section>
  );
}
