import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardCopy, Undo2 } from 'lucide-react';
import { bridge } from '../live/bridge';
import { SongCategoriesEditor } from '../lyrics/SongCategoriesEditor';
import { useLyT } from '../lyrics/strings';
import type { DeletedHymn, HymnSummary } from '../lyrics/types';
import { SlideTextCard } from './SlideTextCard';
import { Bar, Card, PageHeader, SECONDARY, Stat, SUB } from './settingsUi';

const api = bridge.lyrics;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Deleted songs are kept this long, then removed for good. The same number the library keeps (RECYCLE_DAYS in electron/lyrics.js). */
const RECYCLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const LANGUAGE_NAME: Record<string, string> = { EN: 'English', TL: 'Tagalog', CEB: 'Cebuano' };

/** What is in the library right now: how many songs, in which languages and Mass categories, and what still needs filling in. */
function LibraryOverview({ version }: { version: number }) {
  const [hymns, setHymns] = useState<HymnSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .listHymns({})
      .then((list) => current && (setHymns(list), setError(null)))
      .catch((err) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [version]);

  const stats = useMemo(() => {
    const list = hymns ?? [];
    const byLanguage = ['EN', 'TL', 'CEB'].map((code) => ({ code, count: list.filter((h) => h.language === code).length }));
    const byCategory = new Map<string, number>();
    for (const h of list) byCategory.set(h.songCategory.trim(), (byCategory.get(h.songCategory.trim()) ?? 0) + 1);
    const uncategorised = byCategory.get('') ?? 0;
    byCategory.delete('');
    return {
      total: list.length,
      stanzas: list.reduce((sum, h) => sum + h.stanzaCount, 0),
      byLanguage,
      categories: [...byCategory.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      uncategorised,
      noKey: list.filter((h) => h.musicalKey.trim() === '').length,
    };
  }, [hymns]);

  return (
    <Card id="lyrics-overview" title="Song library" detail="What is in the library now. It updates as songs are added, edited or deleted.">
      {error ? (
        <p role="alert" className="text-sm text-danger">The library could not be read. {error}</p>
      ) : hymns === null ? (
        <p className={SUB}>Loading the library…</p>
      ) : hymns.length === 0 ? (
        <p className="text-sm text-fg/70">No songs yet. Add the first one from Song Lyrics in the sidebar, by pasting lyrics or importing a file.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Songs" value={stats.total} />
            <Stat label="Stanzas" value={stats.stanzas} />
            <Stat label="Without a Mass category" value={stats.uncategorised} tone="warn" />
            <Stat label="Without a musical key" value={stats.noKey} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">By language</h3>
              <ul className="flex flex-col gap-1.5">
                {stats.byLanguage.map(({ code, count }) => (
                  <Bar key={code} name={LANGUAGE_NAME[code]} count={count} total={stats.total} />
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">By Mass category</h3>
              <ul className="flex flex-col gap-1.5">
                {stats.categories.map(([name, count]) => (
                  <Bar key={name} name={name} count={count} total={stats.total} />
                ))}
                {stats.uncategorised > 0 && <Bar name="No category" count={stats.uncategorised} total={stats.total} warn />}
                {stats.categories.length === 0 && stats.uncategorised === 0 && <li className={SUB}>No categories in use.</li>}
              </ul>
            </div>
          </div>

          {stats.uncategorised > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg/80">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              {stats.uncategorised} {stats.uncategorised === 1 ? 'song has' : 'songs have'} no Mass category. Open {stats.uncategorised === 1 ? 'it' : 'each'} in Song Lyrics and choose one, so it can be found when planning a Mass.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** Whole days left before a deleted song is removed for good, never below zero. */
const daysLeft = (deletedAt: string, now = Date.now()) => Math.max(0, Math.ceil((new Date(deletedAt).getTime() + RECYCLE_DAYS * DAY_MS - now) / DAY_MS));

/** Songs deleted in the last 30 days, each with the time it has left and a Restore button. A restored song comes back with its plans whole. */
function RecentlyDeletedCard({ onRestored, version }: { onRestored: () => void; version: number }) {
  const t = useLyT();
  const [items, setItems] = useState<DeletedHymn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(
    () =>
      api
        .listDeletedHymns()
        .then((list) => {
          setItems(list);
          setError(null);
        })
        .catch(() => setError(t('deletedLoadFailed'))),
    [],
  );

  useEffect(() => {
    void load();
  }, [version]);

  const restore = async (hymn: DeletedHymn) => {
    setRestoring(hymn.id);
    setError(null);
    try {
      await api.undoDeleteHymn(hymn.id);
      await load();
      onRestored();
    } catch {
      setError(t('undoFailed'));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Card id="lyrics-deleted" title="Recently deleted" detail={t('recentlyDeletedNote')}>
      {items === null && !error && <p className={SUB}>Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-fg/70">{t('noRecentlyDeleted')}</p>}
      {items && items.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {items.map((h) => {
            const left = daysLeft(h.deletedAt);
            return (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">{h.title}</div>
                  <div className={`text-xs ${left <= 3 ? 'text-warn' : 'text-fg/60'}`}>
                    {t('deletedOn', { date: new Date(h.deletedAt).toLocaleDateString() })} · {left === 0 ? 'removed today' : `${left} ${left === 1 ? 'day' : 'days'} left`}
                  </div>
                </div>
                <button type="button" aria-label={t('undoDeleteLabel', { title: h.title })} onClick={() => void restore(h)} disabled={restoring !== null} className={SECONDARY}>
                  <Undo2 size={14} aria-hidden /> {t('undoDelete')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Card>
  );
}

const EXAMPLE = `[V1]
Amazing grace, how sweet the sound
That saved a wretch like me

[C]
My chains are gone, I've been set free
My God, my Savior has ransomed me

[V2]
'Twas grace that taught my heart to fear
And grace my fears relieved`;

const TAGS: [string, string][] = [
  ['[V1] [V2] …', 'Verse'],
  ['[C]', 'Chorus (Refrain works too)'],
  ['[B]', 'Bridge'],
  ['[T]', 'Tag'],
  ['[O]', 'Outro'],
];

/** How lyrics are read when pasted or imported. Written from the parser, so what it says is what the library does. */
function FormatGuide() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(EXAMPLE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the example can still be selected and copied by hand */
    }
  };

  return (
    <Card id="lyrics-format" title="Writing lyrics" detail="How pasted or imported lyrics are split into slides.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 text-sm text-fg/80">
          <p>Put a tag on its own line to start each part. The lines under it belong to that part, and each part becomes its own slide.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {TAGS.map(([tag, name]) => (
              <div key={tag} className="contents">
                <dt className="font-mono text-xs font-bold text-accent">{tag}</dt>
                <dd className="text-xs">{name}</dd>
              </div>
            ))}
          </dl>
          <ul className="list-disc space-y-1 pl-5 text-xs text-fg/70">
            <li>Words such as “Verse 1”, “Chorus” or “Bridge:” on their own line work the same as tags.</li>
            <li>With no tags at all, a blank line starts the next verse.</li>
            <li>A song can have up to 40 parts. An empty part is skipped, with a warning.</li>
          </ul>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <pre className="overflow-x-auto rounded-lg border border-line bg-panel p-3 font-mono text-xs leading-relaxed text-fg/90" aria-label="Example lyrics">{EXAMPLE}</pre>
          <button type="button" onClick={() => void copy()} className={`${SECONDARY} self-start`}>
            {copied ? <Check size={14} aria-hidden /> : <ClipboardCopy size={14} aria-hidden />} {copied ? 'Copied' : 'Copy example'}
          </button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Settings for the Song Lyrics module: what is in the library, how slide text looks, the Mass song categories, songs deleted
 * in the last 30 days, and how lyrics are written. The sections that change data save at once, like the rest of Settings.
 */
export function LyricsSettings() {
  // Bumped when something here changes the library, and when a song changes anywhere, so the overview and the deleted list follow.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => api.onChanged(refresh), [refresh]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Content" title="Song lyrics" description="Manage the song library, how lyrics look on the projector, and the categories used when planning a Mass." />

      <LibraryOverview version={version} />
      <SlideTextCard
        id="lyrics-text"
        sample={['Amazing grace, how sweet the sound', 'That saved a wretch like me']}
        note="A song with its own font, set in the song editor, keeps that font. The Live panel has the same size buttons for use during Mass."
      />
      <Card id="lyrics-categories" title="Song categories for the Mass">
        <SongCategoriesEditor onChanged={refresh} />
      </Card>
      <RecentlyDeletedCard version={version} onRestored={refresh} />
      <FormatGuide />
    </div>
  );
}
