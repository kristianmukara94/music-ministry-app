import { useEffect, useState, type FormEvent } from 'react';
import { bridge } from '../live/bridge';
import { useLyT } from './strings';
import type { SongCategory } from './types';

const api = bridge.lyrics;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const field = 'h-10 min-w-0 flex-1 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent';
const button = 'h-10 rounded-md border border-fg/15 px-3 text-xs font-bold whitespace-nowrap uppercase hover:bg-fg/10 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

/**
 * The operator's list of song categories for the Mass: add, rename and remove. Renaming also renames the songs that use it.
 * Shared by the dialog in the Song Lyrics library and by the Song lyrics page in Settings. `onChanged` runs after any change.
 */
export function SongCategoriesEditor({ onChanged }: { onChanged?: () => void }) {
  const t = useLyT();
  const [categories, setCategories] = useState<SongCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .listSongCategories()
      .then((list) => {
        setCategories(list);
        setLoaded(true);
      })
      .catch((err) => setError(errorText(err)));

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
      onChanged?.();
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
    <div className="flex flex-col gap-4">
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

      {loaded && categories.length === 0 ? (
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
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: category.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
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

      <p role="alert" className="min-h-5 text-sm text-danger">
        {error ?? ''}
      </p>
    </div>
  );
}
