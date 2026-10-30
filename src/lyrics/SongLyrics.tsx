import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, ListMusic, Music, Pencil, Play, Plus, Search, Trash2, Type } from 'lucide-react';
import { BACKGROUND_COLORS, sanitizeTextStyle } from '../../shared/text-style.js';
import type { TextStyle } from '../../shared/text-style';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import type { Frame } from '../../shared/live.js';
import { CATEGORIES, LANGUAGES } from '../../shared/lyrics-parser.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { ShowAllVerses } from '../components/ShowAllVerses';
import { RecentlyDeleted } from './RecentlyDeleted';
import { useAnnT } from '../announcements/strings';
import { CreateHymnModal } from './CreateHymnModal';
import { SongCategoriesModal } from './SongCategoriesModal';
import { useLyT } from './strings';
import type { Hymn, HymnCategory, HymnLanguage, HymnSummary, Setlist, SetlistEntry } from './types';

const api = bridge.lyrics;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The short label on a section pill: V1, V2, C, B, O or T. Anything unrecognised shows its first two letters. */
function sectionPill(stanzaType: string): string {
  const m = /^(Verse|Chorus|Bridge|Outro|Tag)\s*(\d*)$/.exec(stanzaType);
  if (!m) return stanzaType.slice(0, 2).toUpperCase();
  const letter: Record<string, string> = { Verse: 'V', Chorus: 'C', Bridge: 'B', Outro: 'O', Tag: 'T' };
  return `${letter[m[1]]}${m[1] === 'Verse' ? m[2] : ''}`;
}

/** The section kind of a stanza, such as Verse or Chorus, used for its colour. */
function sectionKind(stanzaType: string): string {
  return /^(Verse|Chorus|Bridge|Outro|Tag)/.exec(stanzaType)?.[1] ?? 'Tag';
}

/** A colour per section kind, so verses, the chorus, bridges and outros are easy to tell apart at a glance. */
const SECTION_TONE: Record<string, string> = {
  Verse: 'border-info/40 bg-info/10 text-info hover:bg-info/20',
  Chorus: 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20',
  Bridge: 'border-warn/40 bg-warn/10 text-warn hover:bg-warn/20',
  Outro: 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/20',
  Tag: 'border-fg/15 bg-panel-2 text-fg/80 hover:bg-panel',
};

/** The projector frame for one stanza of a hymn, or null when there is no such stanza. */
function stanzaFrame(hymn: Hymn, index: number): Frame | null {
  const stanza = hymn.stanzas[index];
  // The song and the stanza's position let the projector follow an edit to this song while it is live.
  return stanza
    ? { kind: 'lyrics', title: hymn.title, label: stanza.stanzaType, text: stanza.lyricsText, style: hymn.style, key: `song:${hymn.id}`, song: { hymnId: hymn.id, position: index, count: hymn.stanzas.length } }
    : null;
}

/** Today's date in local time (toISOString would give yesterday's date before 08:00 in Manila). */
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** What is being dragged: a library hymn, or a row already in the setlist. */
type DragSource = { kind: 'library'; hymnId: number } | { kind: 'setlist'; index: number };

const selectClass = 'h-9 rounded-md border border-fg/15 bg-panel-2 px-2 text-xs text-fg outline-none focus:border-accent';

export function SongLyrics() {
  const t = useLyT();
  const tAnn = useAnnT();
  const openedFromQueue = useRef(false);
  // Whether the hymn on screen came from the Mass Queue. Its takes stay on the queue's account; any other hymn is a direct take.
  const hymnFromQueue = useRef(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [editing, setEditing] = useState<Hymn | null>(null);

  // Library
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HymnCategory | ''>('');
  const [language, setLanguage] = useState<HymnLanguage | ''>('');
  const [hymns, setHymns] = useState<HymnSummary[]>([]);

  // Setlist
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [setlistId, setSetlistId] = useState<number | null>(null);
  const [entries, setEntries] = useState<SetlistEntry[]>([]);
  const [newSetlist, setNewSetlist] = useState(false);
  const [setlistName, setSetlistName] = useState('');
  const [setlistDate, setSetlistDate] = useState(todayIso());
  const [dropAt, setDropAt] = useState<number | null>(null);

  // Cue controller
  const [selected, setSelected] = useState<number | null>(null);
  // Kept for the session only (the UI store is not persisted), so a restart shows one verse at a time again.
  const showAllVerses = useUi((s) => s.showAllVerses);
  // Hidden until opened. Kept for the session in the UI store, shared with the Text Slide editor, and not persisted.
  const styleOpen = useUi((s) => s.slideStyleOpen);
  const [hymn, setHymn] = useState<Hymn | null>(null);
  const [cue, setCue] = useState(-1);
  const liveFrame = useLive((s) => s.state.projector.live);

  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<DragSource | null>(null);
  const fail = (err: unknown) => setError(errorText(err));
  const modalOpen = showCreate || editing !== null;
  const inSetlist = new Set(entries.map((e) => e.hymnId));
  const onAirTitle = liveFrame.kind === 'lyrics' ? liveFrame.title : null;

  // A hymn opened from the Service Queue. Its cues load even if it is not in this setlist.
  const [focusedId, setFocusedId] = useState<number | null>(null);
  // Counts each queue request, so queueing the same song again still reloads it and takes its first stanza.
  const [queueRequest, setQueueRequest] = useState(0);
  const pendingFocus = useUi((s) => s.pendingFocus);
  useEffect(() => {
    if (pendingFocus?.kind !== 'hymn') return;
    setUi({ pendingFocus: null });
    openedFromQueue.current = true;
    setFocusedId(pendingFocus.id);
    setQueueRequest((n) => n + 1);
  }, [pendingFocus]);
  // Choosing a setlist row takes over from the queue request.
  useEffect(() => {
    if (selected !== null) setFocusedId(null);
  }, [selected]);

  // Library search is debounced so typing does not send a request per keystroke.
  const reloadHymns = () => api.listHymns({ search: query, category, language }).then(setHymns).catch(fail);
  useEffect(() => {
    const timer = window.setTimeout(() => void reloadHymns(), 150);
    return () => window.clearTimeout(timer);
  }, [query, category, language]);

  /** Reloads the setlist names and selects `preferId`, or the first setlist when it is null. */
  const reloadSetlists = (preferId: number | null) =>
    api.listSetlists().then((list) => {
      setSetlists(list);
      setSetlistId(preferId ?? list[0]?.id ?? null);
    }).catch(fail);

  useEffect(() => {
    void reloadSetlists(null);
  }, []);

  useEffect(() => {
    setSelected(null);
    setHymn(null);
    setCue(-1);
    if (setlistId == null) {
      setEntries([]);
      return;
    }
    api.getSetlist(setlistId).then(setEntries).catch(fail);
  }, [setlistId]);

  // Load the hymn behind the selected setlist row (or the queue request), and reset the cue position.
  const selectedHymnId = selected == null ? null : entries[selected]?.hymnId ?? null;
  const activeHymnId = focusedId ?? selectedHymnId;
  useEffect(() => {
    setCue(-1);
    hymnFromQueue.current = openedFromQueue.current;
    if (activeHymnId == null) {
      setHymn(null);
      return;
    }
    api
      .getHymn(activeHymnId)
      .then((loaded) => {
        setHymn(loaded);
        // A hymn opened from the Service Queue takes its first stanza live straight away, on the queue's account.
        if (loaded && openedFromQueue.current) {
          openedFromQueue.current = false;
          const frame = stanzaFrame(loaded, 0);
          if (frame) {
            dispatch({ type: 'projector/stage', frame });
            dispatch({ type: 'projector/take', source: 'MASS_QUEUE' });
            setCue(0);
          }
        }
      })
      .catch(fail);
  }, [activeHymnId, queueRequest]);

  /** Stages one stanza. It shows in the staged slot, and the screen does not change until it is taken live. */
  const stage = (index: number) => {
    if (!hymn) return;
    const frame = stanzaFrame(hymn, index);
    if (!frame) return;
    dispatch({ type: 'projector/stage', frame });
    setCue(index);
  };

  /** Sends the staged stanza to the projector and the mirror. */
  const takeLive = () => dispatch({ type: 'projector/take', source: hymnFromQueue.current ? 'MASS_QUEUE' : 'DIRECT_DECK' });

  /** Stages a stanza and takes it live at once. The arrow keys step this way, one stanza at a time. */
  const showNow = (index: number) => {
    stage(index);
    takeLive();
  };

  // Keyboard: Space or Down steps to the next stanza and takes it live, Up steps back, and Enter takes the staged stanza.
  // Ignored while typing or while a dialog is open.
  useEffect(() => {
    if (!hymn || modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (cue + 1 < hymn.stanzas.length) showNow(cue + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (cue > 0) showNow(cue - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (cue >= 0) takeLive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hymn, cue, modalOpen]);

  /** Saves a new order. The setlist is re-read afterwards so the list always matches the database. */
  const applyOrder = async (ids: number[]) => {
    if (setlistId == null) return;
    setError(null);
    try {
      await api.saveSetlist(setlistId, ids);
      setEntries(await api.getSetlist(setlistId));
      setSelected(null);
    } catch (err) {
      fail(err);
    }
  };

  /** `index` is the slot the item lands in, before the item that was there. */
  const dropOnSetlist = (index: number) => {
    const source = dragRef.current;
    dragRef.current = null;
    setDropAt(null);
    if (!source || setlistId == null) return;
    const ids = entries.map((e) => e.hymnId);
    if (source.kind === 'library') {
      ids.splice(index, 0, source.hymnId);
    } else {
      const [moved] = ids.splice(source.index, 1);
      ids.splice(index > source.index ? index - 1 : index, 0, moved);
    }
    void applyOrder(ids);
  };

  /** Moves a setlist row one place up or down, and keeps it selected. Drag and drop does the same for longer moves. */
  const moveEntry = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= entries.length) return;
    const ids = entries.map((e) => e.hymnId);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void applyOrder(ids).then(() => setSelected(to));
  };

  const removeFromSetlist = (index: number) => void applyOrder(entries.filter((_, i) => i !== index).map((e) => e.hymnId));

  const createSetlist = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.createSetlist({ name: setlistName, date: setlistDate });
      setSetlistName('');
      setNewSetlist(false);
      await reloadSetlists(created.id);
    } catch (err) {
      fail(err);
    }
  };

  const deleteSetlist = async () => {
    if (setlistId == null || !window.confirm(t('confirmDeleteSetlist'))) return;
    try {
      await api.deleteSetlist(setlistId);
      await reloadSetlists(null);
    } catch (err) {
      fail(err);
    }
  };

  const deleteHymn = async (summary: HymnSummary) => {
    if (!window.confirm(t('confirmDeleteHymn', { title: summary.title }))) return;
    try {
      await api.deleteHymn(summary.id);
      await reloadHymns();
      if (setlistId != null) setEntries(await api.getSetlist(setlistId));
      if (hymn?.id === summary.id) setSelected(null);
    } catch (err) {
      fail(err);
    }
  };

  /** Opens the edit dialog with the hymn's stored data. */
  const startEdit = async (summary: HymnSummary) => {
    try {
      const full = await api.getHymn(summary.id);
      if (full) setEditing(full);
    } catch (err) {
      fail(err);
    }
  };

  /** After an edit, the stanzas may have changed, so the open cue card is reloaded too. */
  const afterSave = async () => {
    setShowCreate(false);
    setEditing(null);
    await reloadHymns();
    if (setlistId != null) setEntries(await api.getSetlist(setlistId));
    if (hymn) setHymn(await api.getHymn(hymn.id));
  };

  const addToSetlist = (hymnId: number) => void applyOrder([...entries.map((e) => e.hymnId), hymnId]);

  // The song's style, as it will be saved and drawn. Changing it saves the song and updates whatever is on the screen.
  const hymnStyle: TextStyle = hymn?.style ?? {};

  const changeStyle = (patch: TextStyle) => {
    if (!hymn) return;
    const next = sanitizeTextStyle({ ...hymnStyle, ...patch });
    setHymn({ ...hymn, style: next });
    api.setStyle(hymn.id, next).catch(fail);
    // The lyric on the screen or the staged slot picks up the new look straight away.
    if (cue >= 0) {
      const frame = stanzaFrame({ ...hymn, style: next }, cue);
      if (frame) dispatch({ type: isLive(cue) ? 'projector/show' : 'projector/stage', frame });
    }
  };

  const isLive = (index: number) =>
    hymn !== null &&
    liveFrame.kind === 'lyrics' &&
    liveFrame.title === hymn.title &&
    liveFrame.text === hymn.stanzas[index]?.lyricsText;

  return (
    <div className="flex min-h-[calc(100vh-88px)] flex-col">
      <header className="px-5 pt-5 pb-4">
        <div className="text-sm font-semibold tracking-wider text-accent uppercase">{t('eyebrow')}</div>
        <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg/70">{t('subtitle')}</p>
      </header>

      {error && (
        <div role="alert" className="mx-5 mb-4 rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-5 px-5 pb-5 xl:flex-1 xl:grid-cols-[360px_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ── Library ── */}
        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('libraryTitle')}</span>
              <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowCategories(true)} className="h-9 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide whitespace-nowrap uppercase transition hover:bg-fg/10">
                {t('songCategoriesButton')}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-accent bg-accent px-3 text-xs font-extrabold tracking-wide uppercase text-on-accent transition hover:brightness-110"
              >
                <Plus size={14} strokeWidth={2.5} aria-hidden /> {t('createHymn')}
              </button>
              </div>
            </div>
            <label className="relative">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                className="h-10 w-full rounded-md border border-fg/15 bg-panel-2 pr-3 pl-9 text-sm outline-none focus:border-accent"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value as HymnCategory | '')} className={selectClass} aria-label={t('fieldCategory')}>
                <option value="">{t('allCategories')}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat_${c}`)}</option>)}
              </select>
              <select value={language} onChange={(e) => setLanguage(e.target.value as HymnLanguage | '')} className={selectClass} aria-label={t('fieldLanguage')}>
                <option value="">{t('allLanguages')}</option>
                {LANGUAGES.map((l) => <option key={l} value={l}>{t(`lang_${l}`)}</option>)}
              </select>
            </div>
            <p className="text-xs text-fg/60 tabular-nums">{t('hymnCount', { n: hymns.length })}</p>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {hymns.length === 0 && <li className="p-4 text-sm text-fg/60">{t('noHymns')}</li>}
            {hymns.map((h) => (
              <li
                key={h.id}
                draggable
                onDragStart={() => { dragRef.current = { kind: 'library', hymnId: h.id }; }}
                onDragEnd={() => { dragRef.current = null; setDropAt(null); }}
                onDoubleClick={() => setlistId != null && addToSetlist(h.id)}
                title={setlistId != null ? t('dblAddHint') : undefined}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-fg/[0.06]"
              >
                <Music size={14} className="shrink-0 cursor-grab text-faint" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-fg">{h.title}</span>
                    {inSetlist.has(h.id) && <Check size={13} className="shrink-0 text-ok" aria-label={t('inSetlist')} />}
                  </div>
                  <div className="truncate text-[11px] text-fg/60">
                    {[h.composer, h.musicalKey, t(`cat_${h.category}`), t(`lang_${h.language}`), t('stanzaCount', { n: h.stanzaCount })].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addToSetlist(h.id)}
                  disabled={setlistId == null}
                  aria-label={`${t('addToSetlist')}: ${h.title}`}
                  title={t('addToSetlist')}
                  className="grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-canvas hover:text-accent disabled:opacity-30"
                >
                  <Plus size={14} aria-hidden />
                </button>
                <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => void startEdit(h)}
                    aria-label={`${t('editHymnAction')}: ${h.title}`}
                    title={t('editHymnAction')}
                    className="grid size-7 place-items-center rounded text-muted hover:bg-canvas hover:text-fg"
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteHymn(h)}
                    aria-label={`${t('deleteHymnAction')}: ${h.title}`}
                    title={t('deleteHymnAction')}
                    className="grid size-7 place-items-center rounded text-muted hover:text-danger"
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <RecentlyDeleted onRestored={() => void reloadHymns()} />
        </section>

        {/* ── Sunday setlist ── */}
        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="flex items-center gap-2">
              <ListMusic size={16} aria-hidden />
              <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('setlistTitle')}</span>
              {setlistId != null && <span className="rounded-full bg-fg/10 px-2 py-px font-mono text-[10px] font-bold text-fg/70 tabular-nums">{entries.length}</span>}
              <button
                type="button"
                onClick={() => setNewSetlist((open) => !open)}
                className="ml-auto h-8 rounded-md border border-fg/15 bg-panel-2 px-2.5 text-[11px] font-semibold tracking-wide uppercase transition hover:bg-fg/10"
              >
                {newSetlist ? t('cancel') : t('newSetlist')}
              </button>
            </div>

            {setlists.length > 0 ? (
              <div className="flex gap-2">
                <select
                  value={setlistId ?? ''}
                  onChange={(e) => setSetlistId(Number(e.target.value))}
                  className={`${selectClass} min-w-0 flex-1`}
                  aria-label={t('setlistLabel')}
                >
                  {setlists.map((s) => (
                    <option key={s.id} value={s.id}>{s.date} · {s.name}</option>
                  ))}
                </select>
                <button type="button" onClick={deleteSetlist} aria-label={t('deleteSetlist')} title={t('deleteSetlist')} className="grid size-9 place-items-center rounded-md border border-fg/15 text-muted hover:text-danger">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ) : (
              !newSetlist && <p className="text-sm text-muted">{t('setlistEmpty')}</p>
            )}

            {newSetlist && (
              <form onSubmit={createSetlist} className="flex flex-col gap-2">
                <input
                  required
                  maxLength={120}
                  value={setlistName}
                  onChange={(e) => setSetlistName(e.target.value)}
                  placeholder={t('setlistName')}
                  className="h-9 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent"
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    required
                    aria-label={t('date')}
                    value={setlistDate}
                    onChange={(e) => setSetlistDate(e.target.value)}
                    className="h-9 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm outline-none focus:border-accent"
                  />
                  <button type="submit" disabled={!setlistName.trim()} className="h-9 flex-1 rounded-md bg-accent text-xs font-extrabold uppercase text-on-accent disabled:opacity-40">
                    {t('create')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {setlistId != null && (
            <ol className="min-h-0 flex-1 overflow-y-auto p-2" onDragLeave={() => setDropAt(null)}>
              {entries.length === 0 && <li className="grid min-h-40 place-items-center rounded-[10px] border-2 border-dashed border-fg/20 p-6 text-center text-sm text-fg/60">{t('dropHere')}</li>}
              {entries.map((entry, i) => (
                <li
                  key={`${entry.position}-${entry.hymnId}`}
                  draggable
                  onDragStart={() => { dragRef.current = { kind: 'setlist', index: i }; }}
                  onDragEnd={() => { dragRef.current = null; setDropAt(null); }}
                  onDragOver={(e) => {
                    if (!dragRef.current) return;
                    e.preventDefault();
                    setDropAt(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOnSetlist(i);
                  }}
                  className={`group flex items-center gap-2 rounded-lg border-t-2 border-l-[3px] px-2 py-2 transition ${
                    dropAt === i ? 'border-t-accent' : 'border-t-transparent'
                  } ${selected === i ? 'border-l-accent bg-gradient-to-r from-accent/20 to-accent/5' : 'border-l-transparent hover:bg-fg/[0.06]'}`}
                >
                  <span className="w-6 shrink-0 text-center font-mono text-xs text-fg/50">{onAirTitle === entry.title ? <span className="mx-auto block size-2 animate-pulse rounded-full bg-ok" title={t('live')} /> : i + 1}</span>
                  <button type="button" onClick={() => setSelected(i)} className="min-w-0 flex-1 text-left" aria-current={selected === i}>
                    <div className={`truncate text-sm font-semibold ${selected === i ? 'text-accent' : 'text-fg'}`}>{entry.title}</div>
                    {entry.deleted && <div className="text-[11px] text-danger">{t('deletedHymnStatus')}</div>}
                    <div className="truncate text-[11px] text-muted">{[entry.composer, t(`cat_${entry.category}`)].filter(Boolean).join(' · ')}</div>
                  </button>
                  <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => moveEntry(i, -1)} disabled={i === 0} aria-label={t('moveUp')} title={t('moveUp')} className="grid size-7 place-items-center rounded text-fg/60 hover:text-fg disabled:opacity-30">
                      <ArrowUp size={13} aria-hidden />
                    </button>
                    <button type="button" onClick={() => moveEntry(i, 1)} disabled={i === entries.length - 1} aria-label={t('moveDown')} title={t('moveDown')} className="grid size-7 place-items-center rounded text-fg/60 hover:text-fg disabled:opacity-30">
                      <ArrowDown size={13} aria-hidden />
                    </button>
                  </div>
                  <button type="button" onClick={() => removeFromSetlist(i)} aria-label={t('removeHymn', { title: entry.title })} className="grid size-7 shrink-0 place-items-center rounded text-muted hover:text-danger">
                    <Trash2 size={13} aria-hidden />
                  </button>
                </li>
              ))}
              <li
                onDragOver={(e) => {
                  if (!dragRef.current) return;
                  e.preventDefault();
                  setDropAt(entries.length);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOnSetlist(entries.length);
                }}
                className={`h-12 rounded-md border-t-2 ${dropAt === entries.length ? 'border-accent' : 'border-transparent'}`}
              />
            </ol>
          )}
        </section>

        {/* ── Live cue controller ── */}
        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel xl:min-h-0">
          <div className="shrink-0 border-b border-line p-4">
            <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('cuesTitle')}</span>
            {hymn ? (
              <>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">{hymn.title}</h2>
                <p className="text-xs text-muted">{[hymn.composer, hymn.musicalKey, t(`cat_${hymn.category}`), t(`lang_${hymn.language}`)].filter(Boolean).join(' · ')}</p>
              </>
            ) : (
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-muted">{t('noHymn')}</h2>
            )}
          </div>

          {hymn ? (
            <>
              {/* Section pills: one press takes a whole section live. */}
              <div role="toolbar" aria-label="Sections" className="flex shrink-0 flex-wrap gap-1.5 border-b border-line p-3">
                {hymn.stanzas.map((stanza, i) => (
                  <button
                    key={stanza.id}
                    type="button"
                    onClick={() => showNow(i)}
                    aria-label={`Take live: ${stanza.stanzaType}`}
                    title={stanza.stanzaType}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors ${SECTION_TONE[sectionKind(stanza.stanzaType)]} ${
                      isLive(i) ? 'ring-2 ring-accent' : ''
                    }`}
                  >
                    {sectionPill(stanza.stanzaType)}
                  </button>
                ))}
              </div>

              {/* Fixed top: the Style button. Its open state is kept for the session, as in the Text Slide editor. */}
              <div className="flex shrink-0 items-center border-b border-line p-3">
                <button
                  type="button"
                  aria-expanded={styleOpen}
                  aria-controls="lyr-style-panel"
                  onClick={() => setUi({ slideStyleOpen: !styleOpen })}
                  className="flex h-9 w-fit items-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide uppercase transition hover:bg-fg/10"
                >
                  <Type size={14} aria-hidden /> {t('styleToggle')}
                </button>
              </div>

              {/* The middle scrolls: the style panel, the preview, the checkbox and the verse list. The bar below stays fixed. */}
              <div className="flex min-h-0 flex-col overflow-y-auto max-h-[50vh] xl:max-h-none xl:flex-1">
                <div id="lyr-style-panel" hidden={!styleOpen} className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
                  <StyleToolbar style={hymnStyle} onChange={changeStyle} />
                  <ColorField
                    label="Background colour"
                    prefix="Background"
                    value={hymnStyle.bgColor}
                    presets={BACKGROUND_COLORS}
                    onChange={(hex) => changeStyle({ bgColor: hex })}
                    clearLabel="No colour"
                  />
                </div>

              {/* By default the list shows the live verse and the next one. The checkbox lists them all. The projector is unchanged. */}
              <div className="flex shrink-0 items-center border-b border-line px-3 py-2">
                <ShowAllVerses label={t('showAllVerses')} />
              </div>

              <ol className="p-3">
                {hymn.stanzas.map((stanza, i) => {
                  const live = isLive(i);
                  // The selected verse is the one the operator picked (the cue). It stays selected until another is picked.
                  const selected = cue === i;
                  const next = i === cue + 1;
                  // One verse at a time: the selected verse, the live verse and the next one. Before the first cue, the first verse is the next one.
                  if (!showAllVerses && !live && !next && !selected) return null;
                  return (
                    <li key={stanza.id} className="mb-2">
                      <button
                        type="button"
                        onClick={() => showNow(i)}
                        aria-pressed={live}
                        aria-current={selected ? 'true' : undefined}
                        className={`w-full rounded-lg border p-4 text-left transition ${
                          selected
                            ? 'border-accent bg-accent/15 ring-2 ring-accent'
                            : live
                              ? 'border-ok bg-ok/10'
                              : next
                                ? 'border-dashed border-fg/15 bg-panel-2'
                                : 'border-line bg-panel hover:border-fg/15'
                        }`}
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold tracking-wider text-accent uppercase">{stanza.stanzaType}</span>
                          {live && <span className="rounded bg-ok px-1.5 py-0.5 text-[10px] font-extrabold text-on-accent uppercase">{t('live')}</span>}
                          {next && !live && <span className="text-[10px] font-bold text-muted uppercase">{t('next')}</span>}
                        </div>
                        <p className="line-clamp-4 text-[15px] leading-snug whitespace-pre-line">{stanza.lyricsText}</p>
                      </button>
                    </li>
                  );
                })}
              </ol>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3">
                <p className="min-w-[15rem] flex-1 text-xs text-muted">
                  <span className="kbd">Space</span> / <span className="kbd">↓</span> {t('hintNext')} ·<span className="kbd">↑</span> {t('hintPrev')} ·{' '}
                  <span className="kbd">Enter</span> {tAnn('play')}
                </p>
                <button
                  type="button"
                  onClick={takeLive}
                  disabled={cue < 0}
                  className="ml-auto flex h-10 shrink-0 items-center gap-2 rounded-md border border-ok bg-ok px-5 text-xs font-extrabold tracking-wider text-canvas uppercase shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={14} fill="currentColor" aria-hidden /> {tAnn('play')}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-fg/60">
              <span className="grid size-12 place-items-center rounded-[10px] border border-line text-fg/50">
                <Music size={22} aria-hidden />
              </span>
              <p className="max-w-xs">{t('selectHint')}</p>
            </div>
          )}
        </section>
      </div>

      {showCategories && <SongCategoriesModal onClose={() => setShowCategories(false)} />}
      {showCreate && <CreateHymnModal onClose={() => setShowCreate(false)} onSaved={() => void afterSave()} />}
      {editing && <CreateHymnModal hymn={editing} onClose={() => setEditing(null)} onSaved={() => void afterSave()} />}
    </div>
  );
}
