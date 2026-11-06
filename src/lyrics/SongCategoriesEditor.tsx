import { useEffect, useState, type FormEvent } from 'react';
import { bridge } from '../live/bridge';
import { useLyT, type LyT } from './strings';
import { DEFAULT_TARGET_MODE, TARGET_MODE_OPTIONS } from './songTaxonomy';
import type { CategoryTargetMode, SongCategory } from './types';

const api = bridge.lyrics;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const field = 'h-10 min-w-[10rem] flex-1 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent';
const button = 'h-10 rounded-md border border-fg/15 px-3 text-xs font-bold whitespace-nowrap uppercase hover:bg-fg/10 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

/** The colour of a mode's badge in the list, so Mass-only and Praise & Worship-only categories are told apart at a glance. */
const BADGE: Record<CategoryTargetMode, string> = {
  HOLY_MASS: 'border-accent/40 bg-accent/10 text-accent',
  PRAISE_AND_WORSHIP: 'border-fg/25 bg-fg/10 text-fg',
  ALL: 'border-fg/15 text-muted',
};

/**
 * The segmented control [ Holy Mass ] [ Praise & Worship ] [ All ]: where a category is offered. A radio group, so the arrow keys move
 * between the three and only the chosen one is a tab stop.
 */
function TargetModeToggle({ t, value, onChange, disabled, idPrefix }: { t: LyT; value: CategoryTargetMode; onChange: (mode: CategoryTargetMode) => void; disabled?: boolean; idPrefix: string }) {
  const move = (step: number) => {
    const i = TARGET_MODE_OPTIONS.findIndex((o) => o.value === value);
    const next = TARGET_MODE_OPTIONS[(i + step + TARGET_MODE_OPTIONS.length) % TARGET_MODE_OPTIONS.length];
    onChange(next.value);
    document.getElementById(`${idPrefix}-${next.value}`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={t('targetModeField')}
      className="inline-flex h-10 shrink-0 overflow-hidden rounded-md border border-fg/15"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(1));
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(-1));
      }}
    >
      {TARGET_MODE_OPTIONS.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            id={`${idPrefix}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`px-3 text-xs font-bold whitespace-nowrap transition focus-visible:relative focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-40 ${
              i > 0 ? 'border-l border-fg/15' : ''
            } ${checked ? 'bg-accent text-on-accent' : 'hover:bg-fg/10'}`}
          >
            {t(o.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The operator's list of song categories: add, edit (name and where it is used) and remove. Each category is for Holy Mass, Praise & Worship
 * or All, and the song dropdowns offer it only there. Renaming also renames the songs that use it; changing the mode leaves those songs as
 * they are. Shared by the dialog in the Song Lyrics library and by the Song lyrics page in Settings. `onChanged` runs after any change.
 */
export function SongCategoriesEditor({ onChanged }: { onChanged?: () => void }) {
  const t = useLyT();
  const [categories, setCategories] = useState<SongCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<CategoryTargetMode>(DEFAULT_TARGET_MODE);
  const [editing, setEditing] = useState<{ id: number; name: string; targetMode: CategoryTargetMode } | null>(null);
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

  // The mode chosen for the last new category stays chosen, so a run of Praise & Worship categories is added without re-picking it.
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.createSongCategory({ name: newName, targetMode: newMode }))) setNewName('');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (await run(() => api.renameSongCategory(editing.id, { name: editing.name, targetMode: editing.targetMode }))) setEditing(null);
  };

  const remove = (category: SongCategory) => {
    if (!window.confirm(t('songCategoryRemoveConfirm', { name: category.name }))) return;
    void run(() => api.deleteSongCategory(category.id));
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-faint">{t('songCategoriesHelp')}</p>

      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          aria-label={t('songCategoryNew')}
          placeholder={t('songCategoryNew')}
          maxLength={40}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className={field}
        />
        <TargetModeToggle t={t} idPrefix="cat-new-mode" value={newMode} onChange={setNewMode} disabled={busy} />
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
                <form onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} className="flex flex-wrap gap-2 rounded-md border border-accent/40 p-2">
                  <input
                    aria-label={t('songCategoryNew')}
                    maxLength={40}
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={field}
                  />
                  <TargetModeToggle
                    t={t}
                    idPrefix={`cat-${category.id}-mode`}
                    value={editing.targetMode}
                    onChange={(targetMode) => setEditing({ ...editing, targetMode })}
                    disabled={busy}
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
              <li key={category.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{category.name}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${BADGE[category.targetMode] ?? BADGE.ALL}`}>
                  {t(`targetMode_${category.targetMode ?? 'ALL'}`)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing({ id: category.id, name: category.name, targetMode: category.targetMode ?? DEFAULT_TARGET_MODE })}
                  className={button}
                >
                  {t('songCategoryEdit')}
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
