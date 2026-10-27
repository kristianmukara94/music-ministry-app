import { useEffect, useState } from 'react';
import { bridge } from '../live/bridge';
import { useLyT } from './strings';
import type { DeletedHymn } from './types';

const api = bridge.lyrics;

/** Hymns deleted in the last 30 days, under the library. Each can be undone: it comes back with the same id, and its plans are whole again. */
export function RecentlyDeleted({ onRestored }: { onRestored: () => void }) {
  const t = useLyT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DeletedHymn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listDeletedHymns().then(setItems).catch(() => setError(t('deletedLoadFailed')));

  useEffect(() => {
    // Reloads each time the section opens, so the list is current.
    if (open) void load();
  }, [open]);

  const undo = async (id: number) => {
    setError(null);
    try {
      await api.undoDeleteHymn(id);
      await load();
      onRestored();
    } catch {
      setError(t('undoFailed'));
    }
  };

  return (
    <section aria-label={t('recentlyDeletedTitle')} className="mt-2 border-t border-line pt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="w-full px-2 py-2 text-left text-xs font-bold uppercase text-muted hover:text-accent">
        {t('recentlyDeletedTitle')}
      </button>
      {open && (
        <div className="px-2 pb-2">
          <p className="pb-1 text-xs text-muted">{t('recentlyDeletedNote')}</p>
          <ul>
            {items.length === 0 && !error && <li className="py-2 text-sm text-muted">{t('noRecentlyDeleted')}</li>}
            {items.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-sm">
                  {h.title} <span className="text-xs text-muted">· {t('deletedOn', { date: new Date(h.deletedAt).toLocaleDateString() })}</span>
                </span>
                <button type="button" aria-label={t('undoDeleteLabel', { title: h.title })} onClick={() => void undo(h.id)} className="shrink-0 rounded border border-line-strong px-2 py-1 text-xs font-bold hover:bg-panel-2">
                  {t('undoDelete')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="px-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
