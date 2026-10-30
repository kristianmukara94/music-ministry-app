import { useMemo, useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FileText, Lock, Pencil, Plus, Presentation, Search, Send, Trash2, X } from 'lucide-react';
import { NOTE_CATEGORIES } from '../../shared/notes.js';
import { BACKGROUND_COLORS, sanitizeTextStyle, type TextStyle } from '../../shared/text-style.js';
import { bridge } from '../live/bridge';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import { SlidePreview } from '../announcements/TextSlideModal';
import { LowerThirdStage } from '../output/LowerThirdView';
import { addToQueue } from '../planner/plan-api';
import { BLOCKS, type LiturgicalBlock } from '../planner/types';
import { usePlannerT } from '../planner/strings';
import { lowerThirdOf, prayerRemovedWhileLive, refreshLivePrayer, stagePrayer, takePrayer } from './present';
import { fitsScreen, normalizeSplit, placeBreak, screenPagesOf, splitSummaryOf, type PrayerSplit } from '../../shared/prayer-screen.js';
import { useLive } from '../live/store';
import type { Note, NoteDisplay, NoteInput } from './types';

const api = bridge.notes;
type Tab = 'operator' | 'prayers';

const DISPLAY_LABEL: Record<NoteDisplay, string> = {
  operator: 'Operator only',
  full: 'Full screen',
  lower: 'Lower third',
};

const MAX_BODY = 4000;
// The same surfaces as the dashboard: cards on the panel colour, hairline borders, dark ghost buttons, an accent focus ring.
const CARD = 'rounded-[10px] border border-line bg-panel';
const LABEL = 'text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
const PILL =
  'flex h-9 shrink-0 items-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide text-fg/85 uppercase transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const ICON =
  'grid size-8 shrink-0 place-items-center rounded-md border border-fg/15 bg-panel-2 text-fg/80 transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARY =
  'flex h-9 shrink-0 items-center gap-2 rounded-md border border-accent bg-accent px-4 text-xs font-extrabold tracking-wider text-on-accent uppercase transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const LIVE_BUTTON =
  'flex h-10 shrink-0 items-center gap-2 rounded-md border border-ok bg-ok px-5 text-xs font-extrabold tracking-wider text-canvas uppercase shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const FIELD =
  'h-10 w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Operator notes are private. Prayers can be shown full screen or as a lower third. */
const inTab = (note: Note, tab: Tab) => (tab === 'operator' ? note.display === 'operator' : note.display !== 'operator');

export function NotesPrayersView() {
  const pt = usePlannerT();
  const [notes, setNotes] = useState<Note[]>([]);
  const [tab, setTab] = useState<Tab>('prayers');
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

  // Real-time filter: title, category and body, as the operator types.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => inTab(n, tab) && (!category || n.category === category) && (!q || `${n.title} ${n.category} ${n.body}`.toLowerCase().includes(q)));
  }, [notes, tab, query, category]);

  const current = visible.find((n) => n.id === selectedId) ?? visible[0] ?? null;
  const projectable = current !== null && current.display !== 'operator';
  // A prayer on the screen is shown slide by slide. Previous and Next move the screen too, when this prayer is the one on it.
  const onAir = useLive((s) => s.state.projector.live);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [current?.id]);
  const screen = useMemo(() => (current && current.display === 'full' ? screenPagesOf(current) : []), [current]);
  const shown = Math.min(page, Math.max(screen.length - 1, 0));
  const shownHere = current !== null && onAir.kind === 'text' && onAir.title === current.title && onAir.page !== undefined;
  const tooLong = current !== null && screen.some((p) => !fitsScreen(p.text, current.title, p.fontPx));
  const goTo = (index: number) => {
    if (!current) return;
    setPage(index);
    if (shownHere) takePrayer(current, undefined, index);
  };

  const save = async (input: NoteInput) => {
    setError(null);
    try {
      const saved = await api.save(input);
      refreshLivePrayer(saved);
      setEditing(null);
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
  const changeStyle = (note: Note, patch: TextStyle) => {
    const style = sanitizeTextStyle({ ...note.style, ...patch }) ?? null;
    void save({ id: note.id, title: note.title, category: note.category, body: note.body, display: note.display, style, split: note.split });
  };

  /** The split is saved on the note, so the next stage or take uses it. */
  const changeSplit = (note: Note, split: PrayerSplit | null) => {
    void save({ id: note.id, title: note.title, category: note.category, body: note.body, display: note.display, style: note.style, split });
  };

  const pushToQueue = async (note: Note) => {
    setError(null);
    try {
      await addToQueue([{ block, module: 'notes', sourceId: String(note.id), label: note.title }]);
      setNotice(`"${note.title}" added to the Service Queue.`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const counts = { prayers: notes.filter((n) => inTab(n, 'prayers')).length, operator: notes.filter((n) => inTab(n, 'operator')).length };
  const live = shownHere;

  return (
    <section aria-labelledby="notes-heading" className="flex min-h-full flex-col gap-5 p-5 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold tracking-wider text-accent uppercase">Notes &amp; Prayers</div>
          <h1 id="notes-heading" className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">Prayers and notes</h1>
          <p className="mt-1 text-sm text-fg/70">Operator notes stay on your screen. Prayers can be shown to the congregation.</p>
        </div>
        <button type="button" onClick={() => setEditing('new')} className={PRIMARY}>
          <Plus size={15} aria-hidden /> Add Note / Prayer
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger">{error}</div>}
      {notice && !error && <div role="status" className="rounded-lg border border-ok/50 bg-ok/10 px-4 py-2 text-sm text-ok">{notice}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Note type" className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {([
            ['prayers', 'Prayers & Intentions'],
            ['operator', 'Operator Notes (Private)'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold uppercase transition ${
                tab === id ? 'bg-accent text-on-accent' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
              }`}
            >
              {label}
              <span className={`rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums ${tab === id ? 'bg-on-accent/15' : 'bg-fg/10'}`}>{counts[id]}</span>
            </button>
          ))}
        </div>
        <label className="relative min-w-[16rem] flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg/60" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, category or text"
            aria-label="Search notes"
            className={`${FIELD} pl-9`}
          />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" className="h-10 min-w-44 rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent/40">
          <option value="">All categories</option>
          {NOTE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* The list. Each row shows what the note is, where it can go, and whether it is on the screen now. */}
        <ul aria-label="Notes" className={`${CARD} flex max-h-[calc(100vh-17rem)] flex-col gap-1 overflow-y-auto p-2`}>
          {visible.length === 0 && (
            <li className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <span className="grid size-11 place-items-center rounded-[10px] border border-line text-fg/50">
                <FileText size={20} aria-hidden />
              </span>
              <p className="text-sm text-fg/70">
                {query || category ? 'Nothing matches that search.' : tab === 'prayers' ? 'No prayers yet.' : 'No private notes yet.'}
              </p>
              {!query && !category && (
                <button type="button" onClick={() => setEditing('new')} className={PILL}>
                  <Plus size={13} aria-hidden /> Add one
                </button>
              )}
            </li>
          )}
          {visible.map((n) => {
            const active = current?.id === n.id;
            const onScreen = onAir.kind === 'text' && onAir.title === n.title;
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
                    {onScreen ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full border border-ok/60 bg-ok/15 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-ok uppercase">
                        <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
                        Live
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-fg/20 bg-fg/[0.06] px-2 py-0.5 text-[10px] font-bold text-fg/60 uppercase">{DISPLAY_LABEL[n.display]}</span>
                    )}
                  </span>
                  <span className="text-[11px] font-semibold tracking-wider text-fg/60 uppercase">{n.category}</span>
                  {n.body && <span className="line-clamp-2 text-xs text-fg/60">{n.body}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {/* The detail: the note, its editing controls, and for prayers the preview with staging. */}
        {current === null ? (
          <div className="grid min-h-48 place-items-center rounded-[10px] border-2 border-dashed border-fg/20 p-8 text-center text-sm text-fg/60">
            Choose a note on the left, or add a new one.
          </div>
        ) : (
          <article className={`${CARD} flex min-w-0 flex-col gap-5 p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase">{current.category}</span>
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

            {!projectable ? (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2 rounded-lg border border-line bg-fg/[0.04] px-3 py-2 text-xs font-semibold text-fg/70 uppercase">
                  <Lock size={13} aria-hidden /> Private. Never sent to the projector.
                </p>
                <p className="rounded-lg border border-line bg-panel-2 p-4 text-base leading-relaxed whitespace-pre-line text-fg/90">{current.body || 'No text yet.'}</p>
              </div>
            ) : (
              <>
                <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  {/* The text and its controls. The text is edited in the dialog; the style and the breaks fold away. */}
                  <div className="flex min-w-0 flex-col gap-3">
                    <span className={LABEL}>Prayer text · {DISPLAY_LABEL[current.display]}</span>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-panel-2 p-4 text-sm leading-relaxed whitespace-pre-line text-fg/90">
                      {current.body || 'No text yet.'}
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

                    {current.display === 'full' && <SlideSplit note={current} onSplit={(split) => changeSplit(current, split)} />}
                  </div>

                  {/* The preview is what the screen gets. It stays in view while the text on the left scrolls. */}
                  <div className="flex min-w-0 flex-col gap-3 2xl:sticky 2xl:top-5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={LABEL}>Projector preview</span>
                      {current.display === 'full' && screen.length > 0 && <span className="font-mono text-xs text-fg/60 tabular-nums">{shown + 1} / {screen.length}</span>}
                    </div>
                    {current.display === 'full' ? (
                      <SlidePreview
                        text={screen[shown]?.text ?? current.body}
                        headline={current.title}
                        top={screen[shown]?.top ?? null}
                        bgSrc={null}
                        style={{ ...sanitizeTextStyle(current.style), fontSize: screen[shown]?.fontPx }}
                        className="aspect-video w-full rounded-[10px] border border-fg/15"
                      />
                    ) : (
                      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] border border-fg/15 bg-black [container-type:inline-size]">
                        <LowerThirdStage value={lowerThirdOf(current)} />
                      </div>
                    )}
                    {current.display === 'full' && screen.length > 1 && (
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
                    {tooLong && <p role="alert" className="text-sm text-danger">A slide is too long for the screen, even at the smallest size. Split it further.</p>}
                  </div>
                </div>

                {/* The actions stay at the bottom of the window while the page scrolls, so Stage and Take live are never below the fold. */}
                <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-1 flex flex-wrap items-center gap-3 rounded-b-[10px] border-t border-line bg-panel px-5 py-3">
                  <label className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-fg/60 uppercase">
                    {pt('blockLabel')}
                    <select value={block} onChange={(e) => setBlock(e.target.value as LiturgicalBlock)} className="h-9 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg normal-case outline-none focus:border-accent">
                      {BLOCKS.map((b) => (
                        <option key={b.id} value={b.id}>{pt(b.titleKey)}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => pushToQueue(current)} className={PILL} title="Adds this prayer to the Service Queue for the chosen block">
                    <Send size={13} aria-hidden /> Push to queue
                  </button>
                  <span className="mr-auto" />
                  <button type="button" onClick={() => stagePrayer(current, shown)} className={`${PILL} h-10 px-5`} title="Prepares the prayer. Nothing shows on the screen yet.">
                    Stage
                  </button>
                  <button type="button" onClick={() => takePrayer(current, undefined, shown)} className={LIVE_BUTTON} title="Shows the prayer on the projector now">
                    <Presentation size={14} aria-hidden /> Take live
                  </button>
                </div>
              </>
            )}
          </article>
        )}
      </div>

      {editing !== null && (
        <NoteEditor
          note={editing === 'new' ? null : editing}
          tab={tab}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </section>
  );
}

const DISPLAY_HELP: Record<NoteDisplay, string> = {
  operator: 'Private. Stays on your screen and is never sent to the projector.',
  full: 'Shown on the projector as a full-screen slide. Long prayers are split into slides.',
  lower: 'Shown as a banner across the bottom of the screen.',
};

/** The add and edit form. Operator-only notes, Mass intentions and prayers share it; the display mode decides the rest. */
function NoteEditor({ note, tab, onSave, onCancel }: {
  note: Note | null;
  tab: Tab;
  onSave: (input: NoteInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [category, setCategory] = useState(note?.category ?? (tab === 'operator' ? 'Presider Note' : 'Mass Intention'));
  const [display, setDisplay] = useState<NoteDisplay>(note?.display ?? (tab === 'operator' ? 'operator' : 'full'));
  const [body, setBody] = useState(note?.body ?? '');
  const changed = title !== (note?.title ?? '') || body !== (note?.body ?? '') || category !== (note?.category ?? category) || display !== (note?.display ?? display);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    // The split marks lines, so an edited text starts again as one slide rather than keeping breaks in the wrong places.
    const split = note && body === note.body ? note.split ?? null : null;
    onSave({ id: note?.id, title, category, body, display, style: note?.style ?? null, split });
  };

  // Esc closes the dialog, and Ctrl+Enter saves it from inside the text box. Unsaved typing asks before it is thrown away.
  const close = () => {
    if (!changed || window.confirm('Discard what you typed?')) onCancel();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const label = 'flex flex-col gap-1.5 text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
  return (
    <div role="dialog" aria-modal="true" aria-label={note ? 'Edit note' : 'Add note or prayer'} className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-[10px] border border-line bg-panel p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <h2 className="text-xl font-bold tracking-tight text-fg">{note ? 'Edit note' : 'Add note or prayer'}</h2>
          <button type="button" onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-md text-fg/60 transition hover:bg-fg/10 hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </div>

        <label className={label}>
          Title
          <input required autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prayer for the Sick" className={`${FIELD} normal-case`} />
        </label>

        <label className={label}>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${FIELD} normal-case`}>
            {NOTE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[11px] font-semibold tracking-wider text-fg/60 uppercase">Target display</legend>
          <div role="radiogroup" className="grid grid-cols-3 gap-1.5">
            {(['operator', 'full', 'lower'] as NoteDisplay[]).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={display === d}
                onClick={() => setDisplay(d)}
                className={`rounded-md border px-2 py-2 text-xs font-semibold transition ${
                  display === d ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 bg-panel-2 text-fg/75 hover:text-fg'
                }`}
              >
                {DISPLAY_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg/60">{DISPLAY_HELP[display]}</p>
        </fieldset>

        <label className={label}>
          <span className="flex justify-between">
            Body
            <span className={`font-mono tabular-nums ${body.length > MAX_BODY * 0.9 ? 'text-warn' : ''}`}>
              {body.length} / {MAX_BODY}
            </span>
          </span>
          <textarea
            rows={8}
            maxLength={MAX_BODY}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="rounded-lg border border-fg/15 bg-panel-2 px-3 py-2 text-sm leading-relaxed normal-case text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40"
          />
        </label>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <span className="mr-auto text-xs text-fg/50">Ctrl+Enter to save · Esc to close</span>
          <button type="button" onClick={close} className={PILL}>Cancel</button>
          <button type="submit" disabled={!title.trim()} className={PRIMARY}>Save</button>
        </div>
      </form>
    </div>
  );
}

/** Where a full-screen prayer is split into slides: automatically, by hand between lines, or not at all. It folds away until it is needed. */
function SlideSplit({ note, onSplit }: { note: Note; onSplit: (split: PrayerSplit | null) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const split = normalizeSplit(note.split, note.body);
  const placed = split?.mode === 'manual' ? split.at : [];
  const lines = note.body.split('\n');
  const textAfter = (k: number) => lines.slice(k + 1).some((line) => line.trim());

  const breakAfter = (k: number) => {
    setMessage(null);
    onSplit(placeBreak(note.body, note.split, k).split);
  };

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
            Split here starts a new slide after a line, and that break is kept. A section between your breaks that is too long for one slide is split automatically.
          </p>
          <button type="button" onClick={() => { setMessage(null); onSplit(null); }} disabled={placed.length === 0} className={PILL}>
            Clear manual splits
          </button>
        </div>
        {summary.mode === 'stale' && <p className="text-xs text-danger">The breaks were made for an earlier version of this text, so the automatic split is shown. Place them again.</p>}
        <ol className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-line bg-panel-2 p-3 text-sm leading-relaxed">
          {lines.map((line, k) => (
            <li key={k} className={`flex flex-wrap items-baseline gap-2 ${placed.includes(k) ? 'mb-2 border-b-2 border-accent pb-1' : ''}`}>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-fg/90">{line || ' '}</span>
              {line.trim() && textAfter(k) && (
                <button type="button" onClick={() => breakAfter(k)} className="shrink-0 rounded-md border border-fg/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-fg/80 transition hover:bg-fg/10 hover:text-fg">
                  {placed.includes(k) ? 'Remove split' : 'Split here'}
                </button>
              )}
            </li>
          ))}
        </ol>
        {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      </div>
    </details>
  );
}
