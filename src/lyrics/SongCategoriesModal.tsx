import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLyT } from './strings';
import type { SongCategory } from './types';

const api = bridge.lyrics;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const field = 'h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';
const button = 'h-10 rounded-md border border-line-strong px-3 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';

/** The operator's list of song categories for the Mass: add, rename and remove. Renaming also renames the songs that use it. */
export function SongCategoriesModal({ onClose }: { onClose: () => void }) {
  const t = useLyT();
  const [categories, setCategories] = useState<SongCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listSongCategories().then(setCategories).catch((err) => setError(errorText(err)));

  useEffect(() => {
    void load();
  }, []);

  /** Runs one change, then reloads the list. Returns true when it was saved. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.createSongCategory({ name: newName }))) setNewName('');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (await run(() => api.renameSongCategory(editing.id, { name: editing.name }))) setEditing(null);
  };

  const remove = (category: SongCategory) => {
    if (!window.confirm(t('songCategoryRemoveConfirm', { name: category.name }))) return;
    void run(() => api.deleteSongCategory(category.id));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-label={t('songCategoriesTitle')}>
      <div className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel">
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-2xl font-black uppercase condensed">{t('songCategoriesTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('close')} className="text-muted hover:text-fg">
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6">
          <p className="text-xs text-faint">{t('songCategoriesHelp')}</p>

          <form onSubmit={add} className="flex gap-2">
            <input
              aria-label={t('songCategoryNew')}
              placeholder={t('songCategoryNew')}
              maxLength={40}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={field}
            />
            <button type="submit" disabled={busy || !newName.trim()} className={button}>
              {t('songCategoryAdd')}
            </button>
          </form>

          {categories.length === 0 ? (
            <p className="text-sm text-muted">{t('songCategoriesEmpty')}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {categories.map((category) =>
                editing?.id === category.id ? (
                  <li key={category.id}>
                    <form onSubmit={save} className="flex gap-2">
                      <input
                        aria-label={t('songCategoryNew')}
                        maxLength={40}
                        value={editing.name}
                        onChange={(e) => setEditing({ id: category.id, name: e.target.value })}
                        className={field}
                      />
                      <button type="submit" disabled={busy || !editing.name.trim()} className={button}>
                        {t('songCategorySave')}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={button}>
                        {t('cancel')}
                      </button>
                    </form>
                  </li>
                ) : (
                  <li key={category.id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{category.name}</span>
                    <button type="button" disabled={busy} onClick={() => setEditing({ id: category.id, name: category.name })} className={button}>
                      {t('songCategoryRename')}
                    </button>
                    <button type="button" disabled={busy} onClick={() => remove(category)} className={button}>
                      {t('songCategoryRemove')}
                    </button>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>

        <footer className="border-t border-line px-6 py-3">
          <p role="alert" className="min-h-5 text-sm text-danger">
            {error ?? ''}
          </p>
        </footer>
      </div>
    </div>
  );
}
