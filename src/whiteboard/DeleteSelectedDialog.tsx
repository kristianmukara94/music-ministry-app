import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Asks before the picked slides are deleted. Cancel has focus first, so a quick Enter never deletes, and Tab stays inside the dialog.
 * Escape or a click outside cancels, except while the delete is running.
 */
export function DeleteSelectedDialog({
  titles,
  busy,
  onConfirm,
  onCancel,
}: {
  /** The titles of the slides about to go, in the order shown. Its length is the count. */
  titles: string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const count = titles.length;
  const one = count === 1;

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  /** Keeps Tab and Shift+Tab cycling between the dialog's own buttons. */
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(boxRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const shown = titles.slice(0, 4);
  const more = count - shown.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => !busy && onCancel()}>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-selected-title"
        aria-describedby="delete-selected-message"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-danger/40 bg-canvas p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-danger/40 bg-danger/15 text-danger">
            <Trash2 size={20} aria-hidden />
          </span>
          <h2 id="delete-selected-title" className="text-lg font-bold tracking-tight text-fg">
            Delete <span className="tabular-nums">{count}</span> Selected {one ? 'Slide' : 'Slides'}?
          </h2>
        </div>
        <div id="delete-selected-message" className="flex flex-col gap-3 text-sm text-fg/80">
          <p>
            Are you sure you want to permanently delete {one ? 'this slide' : <>these <strong className="font-semibold text-fg tabular-nums">{count}</strong> slides</>}? This action cannot be
            undone.
          </p>
          <ul className="flex flex-col gap-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-fg/75">
            {shown.map((title, i) => (
              <li key={i} className="truncate">
                {title || 'Untitled slide'}
              </li>
            ))}
            {more > 0 && <li className="text-faint">and {more} more…</li>}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-lg border border-fg/20 bg-panel-2 px-4 text-xs font-bold tracking-wider text-fg uppercase hover:border-fg/40 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex h-10 items-center gap-2 rounded-lg border border-danger bg-danger px-4 text-xs font-bold tracking-wider text-canvas uppercase shadow-md shadow-black/40 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none disabled:opacity-60"
          >
            <Trash2 size={14} aria-hidden /> {busy ? 'Deleting…' : one ? 'Delete slide' : `Delete ${count} slides`}
          </button>
        </div>
      </div>
    </div>
  );
}
