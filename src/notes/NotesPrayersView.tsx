import { useMemo, useEffect, useRef, useState } from 'react';
import {
  BookOpenText, ChevronDown, ChevronLeft, ChevronRight, Church, FileText, Lock, Megaphone, MonitorPlay, PanelBottom, Pencil, Plus, Presentation,
  Search, Send, Trash2, Eye, type LucideIcon,
} from 'lucide-react';
import { NOTE_CATEGORIES, noteCategoryLabel, sectionOfCategory, typeOfSection, type NoteSection } from '../../shared/notes.js';
import { BACKGROUND_COLORS, sanitizeTextStyle, type TextStyle } from '../../shared/text-style.js';
import { bridge } from '../live/bridge';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import { SlidePreview } from '../announcements/TextSlideModal';
import { LowerThirdStage } from '../output/LowerThirdView';
import { addToQueue } from '../planner/plan-api';
import { BLOCKS, type LiturgicalBlock } from '../planner/types';
import { usePlannerT } from '../planner/strings';
import { lowerThirdOf, prayerOfKey, prayerRemovedWhileLive, refreshLivePrayer, stagePrayer, takePrayer } from './present';
import { fitsScreen, normalizeSplit, placeBreak, screenPagesOf, splitSummaryOf, type PrayerSplit } from '../../shared/prayer-screen.js';
import { useLive } from '../live/store';
import { useUi } from '../state/ui';
import type { Note, NoteDisplay, NoteInput } from './types';
import { useNotesChanged } from './useNotes';
import { slotById } from '../../shared/mass-slots.js';
import { AddSlotNotePrayerModal } from '../golive/AddSlotNotePrayerModal';
import { useGoLiveT } from '../golive/strings';

/** "Slot 12 · Prayers of the Faithful" for a note written for a Holy Mass slot in Go Live, or null. */
const slotTag = (note: Note) => {
  const slot = slotById(note.slot);
  return slot ? `Slot ${slot.position} · ${slot.name}` : null;
};

const api = bridge.notes;

/** The Hub's three content sections. A note's section follows from its category (shared/notes.js). */
const SECTIONS: { id: NoteSection; label: string; hint: string; icon: LucideIcon; empty: string }[] = [
  { id: 'prayers', label: 'Prayers & Intentions', hint: 'Novenas, consecrations, intercessions, Holy Mass intentions', icon: BookOpenText, empty: 'No prayers or intentions yet.' },
  { id: 'massFlow', label: 'Holy Mass Flow & Ordinaries', hint: 'Creed, Gloria, Kyrie, Sanctus, Agnus Dei, Prefaces', icon: Church, empty: 'No Holy Mass flow texts yet.' },
  { id: 'announcements', label: 'Public Announcements & Notices', hint: 'Pastoral notices, bulletin, events, emergencies', icon: Megaphone, empty: 'No announcements yet.' },
];

/** Who can see an entry: everything, what the congregation sees, or what stays in the booth. */
type Visibility = 'all' | 'public' | 'operator';
const VISIBILITY: { id: Visibility; label: string }[] = [
  { id: 'all', label: 'All Items' },
  { id: 'public', label: 'Public Projection' },
  { id: 'operator', label: 'Operator Booth Cues' },
];
const visibleTo = (note: Note, v: Visibility) => v === 'all' || (v === 'operator' ? note.display === 'operator' : note.display !== 'operator');

const DISPLAY_LABEL: Record<NoteDisplay, string> = {
  operator: 'Booth cue',
  full: 'Full screen',
  lower: 'Lower 3rd',
};

/**
 * One-click looks for a full-screen slide. Each sets only the background and text colours, so a font or size the operator chose stays.
 * A note with neither colour set looks like Standard Dark on the projector.
 */
const THEMES: { id: string; label: string; bg: string; fg: string }[] = [
  { id: 'standard', label: 'Standard Dark', bg: '#000000', fg: '#FFFFFF' },
  { id: 'gold', label: 'Litho Gold', bg: '#1F1806', fg: '#ECC98A' },
  { id: 'crimson', label: 'Liturgical Crimson', bg: '#4A0E14', fg: '#FAF6E9' },
];
const themeOf = (style: TextStyle | null) =>
  THEMES.find((th) => (style?.bgColor ?? '#000000') === th.bg && (style?.textColor ?? '#FFFFFF') === th.fg)?.id ?? null;

// The same surfaces as the dashboard: cards on the panel colour, hairline borders, dark ghost buttons, an accent focus ring.
const CARD = 'rounded-[10px] border border-line bg-panel';
const LABEL = 'text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
const PILL =
  'flex h-9 shrink-0 items-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide text-fg/85 uppercase transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const ICON =
  'grid size-8 shrink-0 place-items-center rounded-md border border-fg/15 bg-panel-2 text-fg/80 transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
// The Hub's own gold, fixed so the add button reads the same on every theme.
const ADD_BUTTON =
  'flex h-10 shrink-0 items-center gap-2 rounded-md border border-[#ecc98a] bg-[#ecc98a] px-4 text-xs font-extrabold tracking-wider text-[#1a1408] uppercase shadow-md shadow-black/20 transition hover:brightness-110';
const LIVE_BUTTON =
  'flex h-10 shrink-0 items-center gap-2 rounded-md border border-[#10b981] bg-[#10b981] px-5 text-xs font-extrabold tracking-wider text-[#04140d] uppercase shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const FIELD =
  'h-10 w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';
const KBD = 'rounded border border-current/30 px-1 py-px font-mono text-[9px] font-semibold tracking-normal normal-case opacity-75';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The fields a quick save (style, split, default display) sends back unchanged. The slot is left out, so the note keeps it. */
/** The text to show for a note. A sealed Holy Mass intention this laptop cannot read says why, instead of looking empty. */
const bodyText = (note: Note) =>
  note.sealed === 'locked'
    ? 'Locked. Enter the parish passphrase in Settings, Backup & restore, to read this Holy Mass intention.'
    : note.sealed === 'damaged'
      ? 'This Holy Mass intention failed its integrity check and cannot be shown. Rewrite it or delete it.'
      : note.body || 'No text yet.';

const inputOf = (note: Note): NoteInput => ({ id: note.id, title: note.title, category: note.category, body: note.body, display: note.display, style: note.style, split: note.split });

/**
 * The Liturgical Content Hub: the one place prayers, Mass flow texts and parish announcements are written, kept and projected. Everything is a
 * row in the notes table, so the Liturgical Plan's library and Go Live read the same entries (and hear notes:changed when one is saved).
 */
export function NotesPrayersView() {
  const pt = usePlannerT();
  const tGoLive = useGoLiveT();
  const [notes, setNotes] = useState<Note[]>([]);
  const [section, setSection] = useState<NoteSection>('prayers');
  const [visibility, setVisibility] = useState<Visibility>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [block, setBlock] = useState<LiturgicalBlock>('word');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Reloads every note. `preferId` selects one afterwards; omit it to keep the current selection. */
  const reload = (preferId?: number | null) =>
    api
      .list()
      .then((list) => {
        setNotes(list);
        if (preferId !== undefined) setSelectedId(preferId);
      })
      .catch((err) => setError(errorText(err)));

  useEffect(() => {
    void reload();
  }, []);
  // An entry written or edited elsewhere (Go Live, another window) shows here straight away. The selection stays.
  useNotesChanged(() => void reload());

  const inSection = useMemo(() => notes.filter((n) => sectionOfCategory(n.category) === section), [notes, section]);
  const sectionCategories = useMemo(() => NOTE_CATEGORIES.filter((c) => sectionOfCategory(c) === section), [section]);
  useEffect(() => setCategory(''), [section]);

  // Real-time filter: visibility, category, and title, category or text as the operator types.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inSection.filter(
      (n) => visibleTo(n, visibility) && (!category || n.category === category) && (!q || `${n.title} ${n.category} ${noteCategoryLabel(n.category)} ${n.body}`.toLowerCase().includes(q)),
    );
  }, [inSection, visibility, query, category]);

  const current = visible.find((n) => n.id === selectedId) ?? visible[0] ?? null;
  const projectable = current !== null && current.display !== 'operator';

  // The output this entry goes to on the next Stage or Take live. It starts on the entry's default and can be switched on the fly without
  // saving; "Make default" saves it.
  const [target, setTarget] = useState<Exclude<NoteDisplay, 'operator'>>('full');
  useEffect(() => {
    if (current && current.display !== 'operator') setTarget(current.display);
  }, [current?.id, current?.display]);
  const outgoing = useMemo<Note | null>(() => (current && projectable ? { ...current, display: target } : null), [current, projectable, target]);

  // A full-screen entry is shown slide by slide. Previous and Next move the screen too, when this entry is the one on it.
  const onAir = useLive((s) => s.state.projector.live);
  const bannerLive = useLive((s) => s.state.lowerThird.live);
  const isOnScreen = (n: Note) => (onAir.kind === 'text' && prayerOfKey(onAir.key)?.id === n.id) || (bannerLive !== null && bannerLive.line1 === n.title);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [current?.id]);
  const screen = useMemo(() => (outgoing && outgoing.display === 'full' ? screenPagesOf(outgoing) : []), [outgoing]);
  const shown = Math.min(page, Math.max(screen.length - 1, 0));
  const slideLive = current !== null && onAir.kind === 'text' && onAir.key === `prayer:${current.id}` && onAir.page !== undefined;
  const tooLong = outgoing !== null && screen.some((p) => !fitsScreen(p.text, outgoing.title, p.fontPx));
  const goTo = (index: number) => {
    if (!outgoing) return;
    setPage(index);
    if (slideLive && outgoing.display === 'full') takePrayer(outgoing, undefined, index);
  };

  const stage = () => {
    if (!outgoing) return;
    stagePrayer(outgoing, shown);
    setNotice(`"${outgoing.title}" is staged in the preview. Take live to show it.`);
  };
  const takeLive = () => {
    if (!outgoing) return;
    takePrayer(outgoing, undefined, shown);
    setNotice(null);
  };

  // Ctrl+Shift+S stages and Ctrl+Enter takes the chosen entry live. Not while a dialog or the command palette is open, or while typing text.
  const keys = useRef({ stage, takeLive });
  keys.current = { stage, takeLive };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.repeat) return;
      const ui = useUi.getState();
      if (ui.capturingHotkey || ui.paletteOpen || document.querySelector('[aria-modal="true"]')) return;
      if ((e.target as HTMLElement | null)?.closest?.('textarea, [contenteditable="true"]')) return;
      if (e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        keys.current.stage();
      } else if (!e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        keys.current.takeLive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Saves a change made in place (style, split, default display). The editor dialog saves the rest. */
  const quickSave = async (input: NoteInput) => {
    setError(null);
    try {
      const saved = await api.save(input);
      refreshLivePrayer(saved);
      await reload(saved.id);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async (note: Note) => {
    if (!window.confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
    try {
      prayerRemovedWhileLive(note);
      await api.remove(note.id);
      await reload(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** A style change is saved on the note, so the next stage or take uses it. */
  const changeStyle = (note: Note, patch: TextStyle) => void quickSave({ ...inputOf(note), style: sanitizeTextStyle({ ...note.style, ...patch }) ?? null });

  /** The split is saved on the note, so the next stage or take uses it. */
  const changeSplit = (note: Note, split: PrayerSplit | null) => void quickSave({ ...inputOf(note), split });

  const pushToQueue = async (note: Note) => {
    setError(null);
    try {
      await addToQueue([{ block, module: 'notes', sourceId: String(note.id), label: note.title }]);
      setNotice(`"${note.title}" added to the active service plan.`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** After the editor saves: the entry is shown in its section, with any filter that would hide it cleared. */
  const afterSave = (message: string, saved: Note) => {
    setEditing(null);
    setNotice(message);
    refreshLivePrayer(saved);
    setSection(sectionOfCategory(saved.category));
    if (!visibleTo(saved, visibility)) setVisibility('all');
    setQuery('');
    void reload(saved.id);
  };

  const counts = Object.fromEntries(SECTIONS.map((s) => [s.id, notes.filter((n) => sectionOfCategory(n.category) === s.id).length])) as Record<NoteSection, number>;
  const sectionInfo = SECTIONS.find((s) => s.id === section)!;
  const live = current !== null && isOnScreen(current);

  return (
    <section aria-labelledby="hub-heading" className="flex min-h-full flex-col gap-5 p-5 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 id="hub-heading" className="text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">Liturgical Content Hub</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg/70">Central database for creating, managing, and projecting prayers, Holy Mass flow sequences, and parish announcements.</p>
        </div>
        <button type="button" onClick={() => setEditing('new')} className={ADD_BUTTON}>
          <Plus size={15} aria-hidden /> Add new entry
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger">{error}</div>}
      {notice && !error && <div role="status" className="rounded-lg border border-ok/50 bg-ok/10 px-4 py-2 text-sm text-ok">{notice}</div>}

      {/* The three content sections. */}
      <div role="tablist" aria-label="Content section" className="grid gap-2 md:grid-cols-3">
        {SECTIONS.map(({ id, label, hint, icon: Icon }) => {
          const on = section === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSection(id)}
              className={`flex min-w-0 items-center gap-3 rounded-[10px] border px-4 py-3 text-left transition ${
                on ? 'border-accent bg-gradient-to-br from-accent/20 to-accent/5' : 'border-line bg-panel hover:border-fg/25 hover:bg-fg/[0.04]'
              }`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${on ? 'border-accent/60 text-accent' : 'border-line text-fg/60'}`}>
                <Icon size={18} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`truncate text-xs font-extrabold tracking-wider uppercase ${on ? 'text-accent' : 'text-fg/85'}`}>{label}</span>
                <span className="truncate text-[11px] text-fg/55">{hint}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums ${on ? 'bg-accent text-on-accent' : 'bg-fg/10 text-fg/70'}`}>{counts[id]}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar: who sees it, then search and category. */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Visibility" className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {VISIBILITY.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={visibility === id}
              onClick={() => setVisibility(id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap uppercase transition ${
                visibility === id ? 'bg-accent text-on-accent' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
              }`}
            >
              {id === 'public' && <Eye size={12} aria-hidden />}
              {id === 'operator' && <Lock size={12} aria-hidden />}
              {label}
            </button>
          ))}
        </div>
        <label className="relative min-w-[14rem] flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg/60" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, category or text" aria-label="Search entries" className={`${FIELD} pl-9`} />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="h-10 min-w-44 rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
        >
          <option value="">All categories</option>
          {sectionCategories.map((c) => (
            <option key={c} value={c}>{noteCategoryLabel(c)}</option>
          ))}
        </select>
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* The list. Each row shows what the entry is, where it goes, and whether it is on screen now. */}
        <ul aria-label={sectionInfo.label} className={`${CARD} flex max-h-[calc(100vh-22rem)] min-h-48 flex-col gap-1 overflow-y-auto p-2`}>
          {visible.length === 0 && (
            <li className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <span className="grid size-11 place-items-center rounded-[10px] border border-line text-fg/50">
                <FileText size={20} aria-hidden />
              </span>
              <p className="text-sm text-fg/70">{query || category || visibility !== 'all' ? 'Nothing matches these filters.' : sectionInfo.empty}</p>
              {!query && !category && visibility === 'all' && (
                <button type="button" onClick={() => setEditing('new')} className={PILL}>
                  <Plus size={13} aria-hidden /> Add one
                </button>
              )}
            </li>
          )}
          {visible.map((n) => {
            const active = current?.id === n.id;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex w-full flex-col gap-1 rounded-lg border-l-[3px] p-3 text-left transition ${
                    active ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5' : 'border-transparent hover:bg-fg/[0.06]'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm font-semibold ${active ? 'text-accent' : 'text-fg'}`}>{n.title}</span>
                    {isOnScreen(n) ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full border border-ok/60 bg-ok/15 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-ok uppercase">
                        <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
                        Live
                      </span>
                    ) : (
                      <span
                        className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                          n.display === 'operator' ? 'border-cyan-500/50 bg-cyan-500/10 text-fg/75' : 'border-fg/20 bg-fg/[0.06] text-fg/60'
                        }`}
                      >
                        {n.display === 'operator' && <Lock size={9} aria-hidden />}
                        {DISPLAY_LABEL[n.display]}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11px] font-semibold tracking-wider text-fg/60 uppercase">
                    {noteCategoryLabel(n.category)}
                    {slotTag(n) && <span className="text-accent/80"> · {slotTag(n)}</span>}
                  </span>
                  {(n.body || n.sealed) && <span className="line-clamp-2 text-xs text-fg/60">{bodyText(n)}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {/* The detail: the entry, its editing controls, and for projectable entries the projection engine. */}
        {current === null ? (
          <div className="grid min-h-48 place-items-center rounded-[10px] border-2 border-dashed border-fg/20 p-8 text-center text-sm text-fg/60">
            Choose an entry on the left, or add a new one.
          </div>
        ) : (
          <article className={`${CARD} flex min-w-0 flex-col gap-5 p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">{noteCategoryLabel(current.category)}</span>
                  {slotTag(current) && (
                    <span className="rounded-full border border-fg/20 bg-fg/[0.06] px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-fg/70 uppercase">{slotTag(current)}</span>
                  )}
                  {live && (
                    <span className="flex items-center gap-1.5 rounded-full border border-ok/60 bg-ok/15 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-ok uppercase">
                      <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
                      Live
                    </span>
                  )}
                </div>
                <h2 className="mt-2 text-2xl font-bold tracking-tight break-words text-fg">{current.title}</h2>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setEditing(current)} className={PILL}>
                  <Pencil size={13} aria-hidden /> Edit
                </button>
                <button type="button" onClick={() => remove(current)} className={`${PILL} hover:!border-danger/60 hover:!text-danger`} aria-label={`Delete ${current.title}`}>
                  <Trash2 size={13} aria-hidden /> Delete
                </button>
              </div>
            </div>

            {!projectable || !outgoing ? (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-fg/80 uppercase">
                  <Lock size={13} aria-hidden /> Operator booth cue. Never sent to the projector.
                </p>
                <p className="rounded-lg border border-line bg-panel-2 p-4 text-base leading-relaxed whitespace-pre-line text-fg/90">{bodyText(current)}</p>
              </div>
            ) : (
              <>
                <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  {/* The text and its controls. The text is edited in the dialog; the style and the breaks fold away. */}
                  <div className="flex min-w-0 flex-col gap-3">
                    <span className={LABEL}>Content</span>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-panel-2 p-4 text-sm leading-relaxed whitespace-pre-line text-fg/90">
                      {bodyText(current)}
                    </div>

                    <details className="group rounded-lg border border-line bg-fg/[0.03]">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className={LABEL}>Slide style</span>
                        <ChevronDown size={16} className="text-fg/60 transition group-open:rotate-180" aria-hidden />
                      </summary>
                      <div className="flex flex-col gap-3 border-t border-line p-3">
                        <StyleToolbar style={current.style ?? {}} onChange={(patch) => changeStyle(current, patch)} />
                        <ColorField
                          label="Background colour"
                          value={current.style?.bgColor}
                          presets={BACKGROUND_COLORS}
                          onChange={(hex) => changeStyle(current, { bgColor: hex })}
                          clearLabel="No colour"
                        />
                      </div>
                    </details>

                    {target === 'full' && <SlideSplit note={current} onSplit={(split) => changeSplit(current, split)} />}
                  </div>

                  {/* The live sanctuary projection engine: output target, theme, the 16:9 canvas and its slides. */}
                  <div className="flex min-w-0 flex-col gap-3 2xl:sticky 2xl:top-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={LABEL}>Sanctuary projection</span>
                      <div role="radiogroup" aria-label="Output target" className="flex gap-1 rounded-lg border border-line bg-panel-2 p-0.5">
                        {(
                          [
                            ['full', MonitorPlay, 'Full Screen Slide', 'Congregation projector'],
                            ['lower', PanelBottom, 'Lower 3rd Banner', 'Live stream / confidence monitor'],
                          ] as const
                        ).map(([id, Icon, label, title]) => (
                          <button
                            key={id}
                            type="button"
                            role="radio"
                            aria-checked={target === id}
                            onClick={() => setTarget(id)}
                            title={title}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap uppercase transition ${
                              target === id ? 'bg-accent text-on-accent' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
                            }`}
                          >
                            <Icon size={13} aria-hidden /> {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {target !== current.display && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-fg/60">
                        This take only. The default is {DISPLAY_LABEL[current.display].toLowerCase()}.
                        <button type="button" onClick={() => void quickSave({ ...inputOf(current), display: target })} className="font-semibold text-accent underline-offset-2 hover:underline">
                          Make default
                        </button>
                      </p>
                    )}

                    {target === 'full' && (
                      <div role="radiogroup" aria-label="Slide theme" className="flex flex-wrap gap-1.5">
                        {THEMES.map((th) => {
                          const on = themeOf(current.style) === th.id;
                          return (
                            <button
                              key={th.id}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              onClick={() => changeStyle(current, { bgColor: th.bg, textColor: th.fg })}
                              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                                on ? 'border-accent bg-accent/15 text-fg' : 'border-fg/15 bg-panel-2 text-fg/75 hover:border-fg/30 hover:text-fg'
                              }`}
                            >
                              <span aria-hidden className="grid size-4 place-items-center rounded-sm border border-fg/20 text-[9px] font-black" style={{ background: th.bg, color: th.fg }}>
                                A
                              </span>
                              {th.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-fg/55">{target === 'full' ? 'Congregation projector · 16:9' : 'Live stream / confidence monitor · 16:9'}</span>
                      {target === 'full' && screen.length > 0 && <span className="font-mono text-xs text-fg/60 tabular-nums">{shown + 1} / {screen.length}</span>}
                    </div>
                    {target === 'full' ? (
                      <SlidePreview
                        text={screen[shown]?.text ?? current.body}
                        headline={current.title}
                        top={screen[shown]?.top ?? null}
                        bgSrc={null}
                        style={{ ...sanitizeTextStyle(current.style), fontSize: screen[shown]?.fontPx }}
                        className={`aspect-video w-full rounded-[10px] border ${slideLive ? 'border-ok ring-2 ring-ok/40' : 'border-fg/15'}`}
                      />
                    ) : (
                      <div className={`relative aspect-video w-full overflow-hidden rounded-[10px] border bg-black [container-type:inline-size] ${live ? 'border-ok ring-2 ring-ok/40' : 'border-fg/15'}`}>
                        <LowerThirdStage value={lowerThirdOf(current)} />
                      </div>
                    )}
                    {target === 'full' && screen.length > 1 && (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => goTo(shown - 1)} disabled={shown === 0} aria-label="Previous slide" className={ICON}>
                          <ChevronLeft size={14} aria-hidden />
                        </button>
                        <div role="group" aria-label="Slides" className="flex flex-1 flex-wrap justify-center gap-1.5">
                          {screen.map((_, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => goTo(i)}
                              aria-current={i === shown ? 'true' : undefined}
                              className={`grid size-8 place-items-center rounded-md border font-mono text-xs font-bold tabular-nums transition ${
                                i === shown ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 bg-panel-2 text-fg/75 hover:border-accent/50 hover:text-accent'
                              }`}
                            >
                              {i + 1}
                            </button>
                          ))}
                        </div>
                        <button type="button" onClick={() => goTo(shown + 1)} disabled={shown >= screen.length - 1} aria-label="Next slide" className={ICON}>
                          <ChevronRight size={14} aria-hidden />
                        </button>
                      </div>
                    )}
                    {target === 'full' && tooLong && <p role="alert" className="text-sm text-danger">A slide is too long for the screen, even at the smallest size. Split it further.</p>}
                  </div>
                </div>

                {/* The sanctuary dock stays at the bottom of the window while the page scrolls, so Stage and Take live are never below the fold. */}
                <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-1 flex flex-wrap items-center gap-3 rounded-b-[10px] border-t border-line bg-panel px-5 py-3">
                  <label className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-fg/60 uppercase">
                    {tGoLive('blockLabel')}
                    <select value={block} onChange={(e) => setBlock(e.target.value as LiturgicalBlock)} className="h-9 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg normal-case outline-none focus:border-accent">
                      {BLOCKS.map((b) => (
                        <option key={b.id} value={b.id}>{pt(b.titleKey)}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => pushToQueue(current)} className={PILL} title="Appends this entry to the active service plan, in the chosen block">
                    <Send size={13} aria-hidden /> Push to queue
                  </button>
                  {/* Stage and Take live wrap as one group, so Take live never sits alone on a line of its own. */}
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button type="button" onClick={stage} className={`${PILL} h-10 px-4`} title="Preloads the slide into the operator preview. Nothing shows on the screen yet. (Ctrl+Shift+S)">
                      Stage <kbd className={`${KBD} hidden 2xl:inline`}>Ctrl+Shift+S</kbd>
                    </button>
                    <button type="button" onClick={takeLive} className={LIVE_BUTTON} title="Shows it on the sanctuary screens now (Ctrl+Enter)">
                      <Presentation size={14} aria-hidden /> Take live <kbd className={`${KBD} hidden 2xl:inline`}>Ctrl+Enter</kbd>
                    </button>
                  </div>
                </div>
              </>
            )}
          </article>
        )}
      </div>

      {editing !== null && (
        <AddSlotNotePrayerModal
          t={tGoLive}
          placement={false}
          note={editing === 'new' ? null : editing}
          defaultType={typeOfSection(section)}
          onClose={() => setEditing(null)}
          onDone={afterSave}
        />
      )}
    </section>
  );
}

/** Where a full-screen entry is split into slides: automatically, by hand between lines, or not at all. It folds away until it is needed. */
function SlideSplit({ note, onSplit }: { note: Note; onSplit: (split: PrayerSplit | null) => void }) {
  const split = normalizeSplit(note.split, note.body);
  const placed = split?.mode === 'manual' ? split.at : [];
  const lines = note.body.split('\n');
  const textAfter = (k: number) => lines.slice(k + 1).some((line) => line.trim());

  const summary = splitSummaryOf(note);
  const automatic = summary.automaticSlides > 0 ? `${summary.automaticSlides} more` : 'none needed';
  const label =
    summary.mode === 'stale'
      ? `Automatic · ${summary.slides} slides`
      : summary.manualBreaks > 0
        ? `Manual: ${summary.manualBreaks} · Automatic: ${automatic} · ${summary.slides} slides`
        : summary.slides > 1
          ? `Automatic: ${summary.slides} slides`
          : 'One slide';

  return (
    <details className="group rounded-lg border border-line bg-fg/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className={LABEL}>Slide breaks · {label}</span>
        <ChevronDown size={16} className="shrink-0 text-fg/60 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-fg/60">
            Split here starts a new slide after a line, and that break is kept. A `---` line typed in the editor does the same. A section between your breaks that is too long for one slide is
            split automatically.
          </p>
          <button type="button" onClick={() => onSplit(null)} disabled={placed.length === 0} className={PILL}>
            Clear manual splits
          </button>
        </div>
        {summary.mode === 'stale' && <p className="text-xs text-danger">The breaks were made for an earlier version of this text, so the automatic split is shown. Place them again.</p>}
        <ol className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-line bg-panel-2 p-3 text-sm leading-relaxed">
          {lines.map((line, k) => (
            <li key={k} className={`flex flex-wrap items-baseline gap-2 ${placed.includes(k) ? 'mb-2 border-b-2 border-accent pb-1' : ''}`}>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-fg/90">{line || ' '}</span>
              {line.trim() && textAfter(k) && (
                <button
                  type="button"
                  onClick={() => onSplit(placeBreak(note.body, note.split, k).split)}
                  className="shrink-0 rounded-md border border-fg/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-fg/80 transition hover:bg-fg/10 hover:text-fg"
                >
                  {placed.includes(k) ? 'Remove split' : 'Split here'}
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
