import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, NotebookText, PanelRightClose, Pencil } from 'lucide-react';
import { NOTES_SIZES, parseNotesSize } from '../../shared/deck-presets.js';
import type { AnnT } from '../announcements/strings';

/** Where the notes text size and the drawer's width are kept between sessions. */
const SIZE_KEY = 'apccmma.deck.notesSize';
const WIDTH_KEY = 'apccmma.deck.notesWidth';
const MIN_WIDTH = 260;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 320;
/** How long typing pauses before the notes save. */
const SAVE_DELAY = 700;

const clampWidth = (n: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
const readStored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice still holds for this session.
  }
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const TOOL =
  'grid h-7 min-w-7 place-items-center rounded px-1.5 text-xs font-bold text-fg/70 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35';

/**
 * Operator-only drawer on the right of the deck: the staged slide's preview and its speaker notes, large enough to read from the lectern.
 * The projector never receives this component, so the notes stay off the congregation screens. Collapsed, it is a thin tab on the edge.
 *
 * Edit turns the notes into a field that saves as the operator types (and when they move to another slide or close the editor). A− and A+
 * step the text size from extra small to extra large, teleprompter style, and the left edge can be dragged to widen the drawer.
 */
export function SpeakerNotesDrawer({
  tr,
  open,
  onToggle,
  slideKey,
  title,
  preview,
  notes,
  onSave,
}: {
  tr: AnnT;
  open: boolean;
  onToggle: () => void;
  /** The staged slide's item key, or null when no slide is staged. A draft belongs to one slide and is saved before another is shown. */
  slideKey: string | null;
  /** The staged slide's title, or null when no slide is staged. */
  title: string | null;
  preview: ReactNode;
  notes: string | null;
  /** Saves a slide's notes. Absent where they cannot be saved (the browser preview). */
  onSave?: (slideKey: string, notes: string) => Promise<void>;
}) {
  const text = notes?.trim() ?? '';
  const [size, setSize] = useState(() => parseNotesSize(readStored(SIZE_KEY)));
  const [width, setWidth] = useState(() => {
    const stored = Number(readStored(WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_WIDTH;
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? '');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // The draft as last typed, and what is known to be stored, read from timers and cleanups without going stale.
  const pending = useRef<{ key: string | null; draft: string; stored: string }>({ key: slideKey, draft: notes ?? '', stored: notes ?? '' });
  const timer = useRef<number | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  /** Saves the draft now when it differs from what is stored. */
  const flush = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const { key, draft: value, stored } = pending.current;
    const save = saveRef.current;
    if (!save || key == null || value === stored) return;
    pending.current = { ...pending.current, stored: value };
    setSaveState('saving');
    setSaveError(null);
    save(key, value).then(
      () => {
        // Only the slide still being edited reports back; an earlier one saved in the background.
        if (pending.current.key === key) setSaveState('saved');
      },
      (err: unknown) => {
        if (pending.current.key === key) {
          pending.current = { ...pending.current, stored: '\u0000' };
          setSaveState('error');
          setSaveError(err instanceof Error ? err.message : String(err));
        }
      },
    );
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Another slide is staged: the last one's draft is saved, and the new slide's notes are shown.
  useEffect(() => {
    pending.current = { key: slideKey, draft: notes ?? '', stored: notes ?? '' };
    setDraft(notes ?? '');
    setSaveState('idle');
    setSaveError(null);
    return () => flushRef.current();
    // The notes are read only when the slide changes; while editing, the draft is the truth.
  }, [slideKey]);

  // Notes changed elsewhere (another window, a reload) show at once while the operator is only reading.
  useEffect(() => {
    if (editing) return;
    pending.current = { ...pending.current, draft: notes ?? '', stored: notes ?? '' };
    setDraft(notes ?? '');
  }, [notes, editing]);

  // Closing the drawer or leaving the deck saves what was typed.
  useEffect(() => () => flushRef.current(), []);
  useEffect(() => {
    if (!open) flushRef.current();
  }, [open]);

  const type = (value: string) => {
    setDraft(value);
    pending.current = { ...pending.current, draft: value };
    setSaveState('idle');
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), SAVE_DELAY);
  };

  const finishEditing = () => {
    flush();
    setEditing(false);
  };

  const pickSize = (next: number) => {
    const value = Math.min(NOTES_SIZES.length - 1, Math.max(0, next));
    setSize(value);
    writeStored(SIZE_KEY, String(value));
  };

  // The drawer's left edge: dragged to widen or narrow it, or nudged with the arrow keys.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (ev: PointerEvent) => {
      latest = clampWidth(startWidth + (startX - ev.clientX));
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.removeProperty('cursor');
      writeStored(WIDTH_KEY, String(latest));
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudgeWidth = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const next = clampWidth(width + (e.key === 'ArrowLeft' ? 20 : -20));
    setWidth(next);
    writeStored(WIDTH_KEY, String(next));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-label={`Show ${tr('notesTitle')}`}
        title={`Show ${tr('notesTitle')}`}
        className="flex w-10 shrink-0 flex-col items-center gap-3 border-l border-line bg-panel py-4 text-muted transition hover:bg-fg/[0.06] hover:text-accent"
      >
        <NotebookText size={16} aria-hidden />
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase [writing-mode:vertical-rl]">{tr('notesTitle')}</span>
        {text && <span className="size-2 rounded-full bg-accent" aria-label="This slide has notes" />}
      </button>
    );
  }

  const canEdit = slideKey != null && onSave != null;
  const sizeClass = NOTES_SIZES[size];
  const status =
    saveState === 'saving' ? tr('notesSaving') : saveState === 'saved' ? tr('notesSaved') : saveState === 'error' ? (saveError ?? 'Not saved') : '';

  return (
    <aside aria-label={tr('notesTitle')} style={{ width }} className="relative flex shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-4">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={tr('notesResize')}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        title={tr('notesResize')}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={nudgeWidth}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
      />

      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-[11px] font-semibold tracking-wider text-accent uppercase">{tr('notesTitle')}</h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => pickSize(size - 1)} disabled={size === 0} aria-label={tr('notesSmaller')} title={tr('notesSmaller')} className={TOOL}>
            A−
          </button>
          <button type="button" onClick={() => pickSize(size + 1)} disabled={size === NOTES_SIZES.length - 1} aria-label={tr('notesLarger')} title={tr('notesLarger')} className={`${TOOL} text-sm`}>
            A+
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => (editing ? finishEditing() : setEditing(true))}
              aria-pressed={editing}
              className={`ml-1 flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-bold tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                editing ? 'border-accent bg-accent text-on-accent' : 'border-fg/20 text-fg/80 hover:border-accent/50 hover:text-accent'
              }`}
            >
              {editing ? <Check size={12} aria-hidden /> : <Pencil size={12} aria-hidden />}
              {editing ? tr('notesDone') : tr('notesEdit')}
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            aria-label={`Hide ${tr('notesTitle')}`}
            title={`Hide ${tr('notesTitle')}`}
            className="ml-1 grid size-7 place-items-center rounded text-muted transition hover:bg-fg/10 hover:text-fg"
          >
            <PanelRightClose size={15} aria-hidden />
          </button>
        </div>
      </div>

      {title != null && (
        <>
          <div className="relative aspect-video w-full overflow-hidden rounded-md border border-line bg-black/80">{preview}</div>
          <p className="truncate text-sm font-semibold text-fg" title={title || 'Untitled slide'}>
            {title || 'Untitled slide'}
          </p>
        </>
      )}

      {editing && canEdit ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => type(e.target.value)}
            onBlur={flush}
            onKeyDown={(e) => {
              // Escape leaves the editor (after saving) without the deck clearing the pick.
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishEditing();
              }
            }}
            maxLength={4000}
            placeholder={tr('notesPlaceholder')}
            aria-label={`${tr('notesTitle')}: ${title || 'Untitled slide'}`}
            className={`min-h-[200px] w-full flex-1 resize-y rounded-md border border-fg/20 bg-panel-2 p-3 leading-relaxed text-fg outline-none placeholder:text-sm placeholder:text-faint focus:border-accent ${sizeClass}`}
          />
          <p role="status" aria-live="polite" className={`min-h-4 text-right text-[11px] ${saveState === 'error' ? 'text-danger' : 'text-muted'}`}>
            {status}
          </p>
        </div>
      ) : text ? (
        <p aria-live="polite" className={`min-h-[160px] leading-relaxed whitespace-pre-line text-fg [overflow-wrap:anywhere] ${sizeClass}`}>
          {text}
        </p>
      ) : (
        <p className="text-sm text-muted">
          {title == null ? tr('notesNothing') : tr('notesEmpty')}
        </p>
      )}
    </aside>
  );
}
