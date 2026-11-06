import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Asks before every Unfiled slide is deleted. Cancel has focus first, so Enter alone never deletes. Escape or a click outside cancels,
 * except while the delete is running.
 */
export function ClearUnfiledDialog({ count, busy, onConfirm, onCancel }: { count: number; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !busy && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-unfiled-title"
        aria-describedby="clear-unfiled-message"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-danger/40 bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-danger/40 bg-danger/15 text-danger">
            <Trash2 size={20} aria-hidden />
          </span>
          <h2 id="clear-unfiled-title" className="text-lg font-bold tracking-tight text-fg">
            Clear All Unfiled Slides?
          </h2>
        </div>
        <p id="clear-unfiled-message" className="text-sm text-fg/80">
          Are you sure you want to delete all <strong className="font-semibold text-fg tabular-nums">{count}</strong> unfiled {count === 1 ? 'slide' : 'slides'}? This action cannot
          be undone.
        </p>
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
            className="flex h-10 items-center gap-2 rounded-lg border border-danger/60 bg-danger/20 px-4 text-xs font-bold tracking-wider text-danger uppercase hover:bg-danger/30 focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none disabled:opacity-60"
          >
            <Trash2 size={14} aria-hidden /> {busy ? 'Deleting…' : 'Delete All'}
          </button>
        </div>
      </div>
    </div>
  );
}
