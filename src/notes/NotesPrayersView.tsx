import { useMemo, useEffect, useState, type FormEvent } from 'react';
import { Lock, Pencil, Plus, Presentation, Search, Send, Trash2 } from 'lucide-react';
import { NOTE_CATEGORIES } from '../../shared/notes.js';
import { BACKGROUND_COLORS, sanitizeTextStyle, type TextStyle } from '../../shared/text-style.js';
import { bridge } from '../live/bridge';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import { SlidePreview } from '../announcements/TextSlideModal';
import { LowerThirdStage } from '../output/LowerThirdView';
import { addToQueue } from '../planner/plan-api';
import { BLOCKS, type LiturgicalBlock } from '../planner/types';
import { usePlannerT } from '../planner/strings';
import { lowerThirdOf, stagePrayer, takePrayer } from './present';
import type { Note, NoteDisplay, NoteInput } from './types';

const api = bridge.notes;
type Tab = 'operator' | 'prayers';

const DISPLAY_LABEL: Record<NoteDisplay, string> = {
  operator: 'Operator only',
  full: 'Full screen',
  lower: 'Lower third',
};

const MAX_BODY = 4000;
const PILL =
  'flex h-9 shrink-0 items-center gap-2 rounded-md border border-line-strong px-3 text-xs font-bold uppercase hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARY = 'flex h-9 shrink-0 items-center gap-2 rounded-md bg-accent px-4 text-xs font-extrabold uppercase text-on-accent hover:brightness-105 disabled:opacity-40';
const FIELD = 'h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Operator notes are private. Prayers can be shown full screen or as a lower third. */
const inTab = (note: Note, tab: Tab) => (tab === 'operator' ? note.display === 'operator' : note.display !== 'operator');

export function NotesPrayersView() {
  const pt = usePlannerT();
  const [notes, setNotes] = useState<Note[]>([]);
  const [tab, setTab] = useState<Tab>('prayers');
  const [query, setQuery] = useState('');
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
    return notes.filter((n) => inTab(n, tab) && (!q || `${n.title} ${n.category} ${n.body}`.toLowerCase().includes(q)));
  }, [notes, tab, query]);

  const current = visible.find((n) => n.id === selectedId) ?? visible[0] ?? null;
  const projectable = current !== null && current.display !== 'operator';

  const save = async (input: NoteInput) => {
    setError(null);
    try {
      const saved = await api.save(input);
      setEditing(null);
      await reload(saved.id);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async (note: Note) => {
    if (!window.confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
    try {
      await api.remove(note.id);
      await reload(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** A style change is saved on the note, so the next stage or take uses it. */
  const changeStyle = (note: Note, patch: TextStyle) => {
    const style = sanitizeTextStyle({ ...note.style, ...patch }) ?? null;
    void save({ id: note.id, title: note.title, category: note.category, body: note.body, display: note.display, style });
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

  return (
    <section aria-labelledby="notes-heading" className="flex min-h-full flex-col gap-4 p-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="eyebrow text-fg">Notes &amp; Prayers</div>
          <h1 id="notes-heading" className="mt-1 text-[44px] leading-none font-black uppercase condensed">Prayers and notes</h1>
          <p className="mt-2 text-[15px] text-muted">Operator notes stay on your screen. Prayers can be shown to the congregation.</p>
        </div>
        <button type="button" onClick={() => setEditing('new')} className={PRIMARY}>
          <Plus size={14} aria-hidden /> Add Note / Prayer
        </button>
      </header>

      {error && <div role="alert" className="rounded-md border border-danger/40 bg-panel px-4 py-2 text-sm text-danger">{error}</div>}
      {notice && !error && <div role="status" className="rounded-md border border-line bg-panel px-4 py-2 text-sm text-muted">{notice}</div>}

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
              className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase ${tab === id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative min-w-[16rem] flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, category or text"
            aria-label="Search notes"
            className={`${FIELD} pl-9`}
          />
        </label>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* The list. Each row shows what the note is and where it can go. */}
        <ul className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto rounded-xl border border-line bg-panel p-2">
          {visible.length === 0 && <li className="p-4 text-sm text-muted">{query ? 'Nothing matches that search.' : 'Nothing here yet.'}</li>}
          {visible.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setSelectedId(n.id)}
                aria-current={current?.id === n.id ? 'true' : undefined}
                className={`flex w-full flex-col gap-1 rounded-lg border-l-2 p-3 text-left transition ${
                  current?.id === n.id ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel-2'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-fg">{n.title}</span>
                  <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[10px] font-bold text-muted uppercase">{DISPLAY_LABEL[n.display]}</span>
                </span>
                <span className="text-[11px] font-bold tracking-wider text-accent/80 uppercase">{n.category}</span>
                {n.body && <span className="truncate text-xs text-muted">{n.body}</span>}
              </button>
            </li>
          ))}
        </ul>

        {/* The detail: the note, its editing controls, and for prayers the preview with staging. */}
        {current === null ? (
          <div className="rounded-xl border border-dashed border-line-strong p-8 text-sm text-muted">Choose a note, or add one.</div>
        ) : (
          <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold tracking-widest text-accent/80 uppercase">{current.category}</div>
                <h2 className="mt-1 text-2xl font-black break-words">{current.title}</h2>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setEditing(current)} className={PILL}>
                  <Pencil size={13} aria-hidden /> Edit
                </button>
                <button type="button" onClick={() => remove(current)} className={PILL} aria-label={`Delete ${current.title}`}>
                  <Trash2 size={13} aria-hidden /> Delete
                </button>
              </div>
            </div>

            {!projectable ? (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-xs font-bold text-muted uppercase">
                  <Lock size={13} aria-hidden /> Private. Never sent to the projector.
                </p>
                <p className="whitespace-pre-line text-base leading-relaxed text-fg/90">{current.body || 'No text yet.'}</p>
              </div>
            ) : (
              <>
                <p className="text-xs font-bold tracking-wider text-muted uppercase">Shown as: {DISPLAY_LABEL[current.display]}</p>

                {/* The shared styling toolbar sits above the preview, so it is the same look the screen gets. */}
                <StyleToolbar style={current.style ?? {}} onChange={(patch) => changeStyle(current, patch)} />
                <ColorField
                  label="Background colour"
                  value={current.style?.bgColor}
                  presets={BACKGROUND_COLORS}
                  onChange={(hex) => changeStyle(current, { bgColor: hex })}
                  clearLabel="No colour"
                />

                {current.display === 'full' ? (
                  <SlidePreview
                    text={current.body}
                    headline={current.title}
                    bgSrc={null}
                    style={sanitizeTextStyle(current.style)}
                    className="aspect-video w-full rounded-lg border border-line"
                  />
                ) : (
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-black [container-type:inline-size]">
                    <LowerThirdStage value={lowerThirdOf(current)} />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <button type="button" onClick={() => stagePrayer(current)} className={PILL}>
                    Stage
                  </button>
                  <button type="button" onClick={() => takePrayer(current)} className={PRIMARY}>
                    <Presentation size={14} aria-hidden /> Take live
                  </button>
                  <span className="mx-1 h-6 w-px bg-line" aria-hidden />
                  <label className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
                    {pt('blockLabel')}
                    <select value={block} onChange={(e) => setBlock(e.target.value as LiturgicalBlock)} className="h-9 rounded-md border border-line-strong bg-canvas px-2 text-sm text-fg outline-none focus:border-accent">
                      {BLOCKS.map((b) => (
                        <option key={b.id} value={b.id}>{pt(b.titleKey)}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => pushToQueue(current)} className={PILL}>
                    <Send size={13} aria-hidden /> Push to queue
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ id: note?.id, title, category, body, display, style: note?.style ?? null });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={note ? 'Edit note' : 'Add note or prayer'} className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-xl flex-col gap-4 rounded-xl border border-line-strong bg-panel p-5 shadow-2xl">
        <h2 className="text-lg font-black uppercase">{note ? 'Edit note' : 'Add note or prayer'}</h2>

        <label className="flex flex-col gap-1.5 text-xs font-bold text-muted uppercase">
          Title
          <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-bold text-muted uppercase">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD}>
            {NOTE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-bold text-muted uppercase">Target display</legend>
          <div role="radiogroup" className="grid grid-cols-3 gap-1.5">
            {(['operator', 'full', 'lower'] as NoteDisplay[]).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={display === d}
                onClick={() => setDisplay(d)}
                className={`rounded-md border px-2 py-2 text-xs font-bold ${display === d ? 'border-accent bg-accent/15 text-accent' : 'border-line-strong text-muted hover:text-fg'}`}
              >
                {DISPLAY_LABEL[d]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-xs font-bold text-muted uppercase">
          <span className="flex justify-between">
            Body
            <span className={`font-mono tabular-nums ${body.length > MAX_BODY * 0.9 ? 'text-amber-400' : ''}`}>
              {body.length} / {MAX_BODY}
            </span>
          </span>
          <textarea
            rows={7}
            maxLength={MAX_BODY}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm leading-relaxed normal-case outline-none focus:border-accent"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={PILL}>Cancel</button>
          <button type="submit" disabled={!title.trim()} className={PRIMARY}>Save</button>
        </div>
      </form>
    </div>
  );
}
