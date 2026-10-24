import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ListMusic, Music, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react';
import { BACKGROUND_COLORS, sanitizeTextStyle } from '../../shared/text-style.js';
import type { TextStyle } from '../../shared/text-style';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import { SlidePreview } from '../announcements/TextSlideModal';
import type { Frame } from '../../shared/live.js';
import { CATEGORIES, LANGUAGES } from '../../shared/lyrics-parser.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { useAnnT } from '../announcements/strings';
import { CreateHymnModal } from './CreateHymnModal';
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
  Verse: 'border-sky-400/40 bg-sky-400/10 text-sky-300 hover:bg-sky-400/20',
  Chorus: 'border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20',
  Bridge: 'border-violet-400/40 bg-violet-400/10 text-violet-300 hover:bg-violet-400/20',
  Outro: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20',
  Tag: 'border-line-strong bg-panel-2 text-fg/80 hover:bg-panel',
};

/** The projector frame for one stanza of a hymn, or null when there is no such stanza. */
function stanzaFrame(hymn: Hymn, index: number): Frame | null {
  const stanza = hymn.stanzas[index];
  return stanza ? { kind: 'lyrics', title: hymn.title, label: stanza.stanzaType, text: stanza.lyricsText, style: hymn.style } : null;
}

/** Today's date in local time (toISOString would give yesterday's date before 08:00 in Manila). */
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** What is being dragged: a library hymn, or a row already in the setlist. */
type DragSource = { kind: 'library'; hymnId: number } | { kind: 'setlist'; index: number };

const selectClass = 'h-9 rounded-md border border-line-strong bg-canvas px-2 text-xs text-fg outline-none focus:border-accent';

export function SongLyrics() {
  const t = useLyT();
  const tAnn = useAnnT();
  const openedFromQueue = useRef(false);
  // Whether the hymn on screen came from the Mass Queue. Its takes stay on the queue's account; any other hymn is a direct take.
  const hymnFromQueue = useRef(false);
  const [showCreate, setShowCreate] = useState(false);
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
  const [hymn, setHymn] = useState<Hymn | null>(null);
  const [cue, setCue] = useState(-1);
  const liveFrame = useLive((s) => s.state.projector.live);

  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<DragSource | null>(null);
  const fail = (err: unknown) => setError(errorText(err));
  const modalOpen = showCreate || editing !== null;

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
  const checked = sanitizeTextStyle(hymnStyle);
  const previewText = hymn ? (hymn.stanzas[cue >= 0 ? cue : 0]?.lyricsText ?? '') : '';

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
      <header className="border-b border-line px-6 pt-5 pb-4">
        <div className="eyebrow text-fg">{t('eyebrow')}</div>
        <h1 className="mt-1 text-[56px] leading-none font-black uppercase condensed">{t('title')}</h1>
        <p className="mt-2 text-[15px] text-muted">{t('subtitle')}</p>
      </header>

      {error && (
        <div role="alert" className="border-b border-crimson/40 bg-crimson/10 px-6 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ── Library ── */}
        <section className="flex min-h-[420px] flex-col border-r border-line">
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="flex items-center justify-between">
              <span className="eyebrow text-fg">{t('libraryTitle')}</span>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-extrabold uppercase text-on-accent hover:brightness-105"
              >
                <Plus size={14} strokeWidth={2.5} aria-hidden /> {t('createHymn')}
              </button>
            </div>
            <label className="relative">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                className="h-10 w-full rounded-md border border-line-strong bg-canvas pr-3 pl-9 text-sm outline-none focus:border-accent"
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
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {hymns.length === 0 && <li className="p-4 text-sm text-muted">{t('noHymns')}</li>}
            {hymns.map((h) => (
              <li
                key={h.id}
                draggable
                onDragStart={() => { dragRef.current = { kind: 'library', hymnId: h.id }; }}
                onDragEnd={() => { dragRef.current = null; setDropAt(null); }}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-2"
              >
                <Music size={14} className="shrink-0 cursor-grab text-faint" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{h.title}</div>
                  <div className="truncate text-[11px] text-muted">
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
                <div className="hidden shrink-0 items-center group-hover:flex">
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
        </section>

        {/* ── Sunday setlist ── */}
        <section className="flex min-h-[420px] flex-col border-r border-line">
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="flex items-center gap-2">
              <ListMusic size={16} aria-hidden />
              <span className="eyebrow text-fg">{t('setlistTitle')}</span>
              <button
                type="button"
                onClick={() => setNewSetlist((open) => !open)}
                className="ml-auto h-8 rounded-md border border-line-strong px-2.5 text-[11px] font-bold uppercase hover:bg-panel-2"
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
                <button type="button" onClick={deleteSetlist} aria-label={t('deleteSetlist')} title={t('deleteSetlist')} className="grid size-9 place-items-center rounded-md border border-line-strong text-muted hover:text-danger">
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
                  className="h-9 rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent"
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    required
                    aria-label={t('date')}
                    value={setlistDate}
                    onChange={(e) => setSetlistDate(e.target.value)}
                    className="h-9 rounded-md border border-line-strong bg-canvas px-2 text-sm outline-none focus:border-accent"
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
              {entries.length === 0 && <li className="p-4 text-sm text-muted">{t('dropHere')}</li>}
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
                  className={`flex items-center gap-2 rounded-md border-t-2 px-2 py-2 ${
                    dropAt === i ? 'border-accent' : 'border-transparent'
                  } ${selected === i ? 'bg-panel-2' : 'hover:bg-panel-2'}`}
                >
                  <span className="w-6 shrink-0 font-mono text-xs text-faint">{i + 1}</span>
                  <button type="button" onClick={() => setSelected(i)} className="min-w-0 flex-1 text-left" aria-current={selected === i}>
                    <div className="truncate text-sm font-semibold">{entry.title}</div>
                    <div className="truncate text-[11px] text-muted">{[entry.composer, t(`cat_${entry.category}`)].filter(Boolean).join(' · ')}</div>
                  </button>
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
        <section className="flex min-h-[420px] flex-col">
          <div className="border-b border-line p-4">
            <span className="eyebrow text-fg">{t('cuesTitle')}</span>
            {hymn ? (
              <>
                <h2 className="mt-1 text-2xl font-black uppercase condensed">{hymn.title}</h2>
                <p className="text-xs text-muted">{[hymn.composer, hymn.musicalKey, t(`cat_${hymn.category}`), t(`lang_${hymn.language}`)].filter(Boolean).join(' · ')}</p>
              </>
            ) : (
              <h2 className="mt-1 text-2xl font-black uppercase condensed text-muted">{t('noHymn')}</h2>
            )}
          </div>

          {hymn ? (
            <>
              {/* Section pills: one press takes a whole section live. */}
              <div role="toolbar" aria-label="Sections" className="flex flex-wrap gap-1.5 border-b border-line p-3">
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

              {/* The styling toolbar sits above the preview. The look is saved with the song. */}
              <div className="flex flex-col gap-2 border-b border-line p-3">
                <StyleToolbar style={hymnStyle} onChange={changeStyle} />
                <ColorField
                  label="Background colour"
                  prefix="Background"
                  value={hymnStyle.bgColor}
                  presets={BACKGROUND_COLORS}
                  onChange={(hex) => changeStyle({ bgColor: hex })}
                  clearLabel="No colour"
                />
                <SlidePreview text={previewText} bgSrc={null} style={checked} className="aspect-video w-full rounded-md border border-line" />
              </div>

              <ol className="min-h-0 flex-1 overflow-y-auto p-3">
                {hymn.stanzas.map((stanza, i) => {
                  const live = isLive(i);
                  const next = i === cue + 1;
                  return (
                    <li key={stanza.id} className="mb-2">
                      <button
                        type="button"
                        onClick={() => stage(i)}
                        aria-pressed={live}
                        className={`w-full rounded-lg border p-4 text-left transition ${
                          live
                            ? 'border-accent bg-accent/10 ring-1 ring-accent'
                            : next
                              ? 'border-line-strong bg-panel-2'
                              : 'border-line bg-panel hover:border-line-strong'
                        }`}
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold tracking-wider text-accent uppercase">{stanza.stanzaType}</span>
                          {live && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold text-on-accent uppercase">{t('live')}</span>}
                          {next && !live && <span className="text-[10px] font-bold text-muted uppercase">{t('next')}</span>}
                        </div>
                        <p className="line-clamp-4 text-[15px] leading-snug whitespace-pre-line">{stanza.lyricsText}</p>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="text-xs text-muted">
                  <span className="kbd">Space</span> / <span className="kbd">↓</span> {t('hintNext')} ·<span className="kbd">↑</span> {t('hintPrev')} ·{' '}
                  <span className="kbd">Enter</span> {tAnn('play')}
                </p>
                <button
                  type="button"
                  onClick={takeLive}
                  disabled={cue < 0}
                  className="flex shrink-0 items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-bold tracking-wider text-white uppercase shadow-md transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={14} fill="currentColor" aria-hidden /> {tAnn('play')}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sm text-muted">
              <p>{t('selectHint')}</p>
            </div>
          )}
        </section>
      </div>

      {showCreate && <CreateHymnModal onClose={() => setShowCreate(false)} onSaved={() => void afterSave()} />}
      {editing && <CreateHymnModal hymn={editing} onClose={() => setEditing(null)} onSaved={() => void afterSave()} />}
    </div>
  );
}
