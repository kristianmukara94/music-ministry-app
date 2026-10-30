import { useEffect, useMemo, useState } from 'react';
import { Check, DatabaseBackup, FolderOpen, Globe2, Loader2, Palette, Search, ShieldAlert } from 'lucide-react';
import { DatabaseSettings } from './DatabaseSettings';
import { bridge } from '../live/bridge';
import { setUi } from '../state/ui';
import { RosarySettings } from './RosarySettings';
import { ProjectorSettingsPanel } from './ProjectorSettings';
import { LowerThirdSettings } from './LowerThirdSettings';
import { WelcomeScreenSettings } from './WelcomeScreenSettings';
import { RemoteViewSettings } from './RemoteViewSettings';
import { CloudSyncSettings } from './CloudSyncSettings';
import { RegionSettings } from './RegionSettings';
import { ThemeView } from './ThemeView';
import { UpdatesPanel } from './UpdatesSettings';
import { AboutLicensing } from './AboutLicensing';
import type { ConfigState, Language, MigrationProgress } from './types';

const api = bridge.config;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ceb', label: 'Cebuano' },
];

type SectionKey =
  | 'theme' | 'language' | 'region'
  | 'projector' | 'lower3rd' | 'cast' | 'welcome'
  | 'rosary' | 'lectionary' | 'lyrics'
  | 'remote'
  | 'cloud'
  | 'backup' | 'updates' | 'about';

interface NavItem {
  key: SectionKey;
  label: string;
  /** True when the feature is not built yet. Shown honestly rather than with a fake control. */
  soon?: boolean;
}

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Appearance',
    items: [
      { key: 'theme', label: 'Theme' },
      { key: 'language', label: 'Language' },
      { key: 'region', label: 'Region' },
    ],
  },
  {
    title: 'Output',
    items: [
      { key: 'projector', label: 'Projector' },
      { key: 'lower3rd', label: 'Lower 3rd & OBS' },
      { key: 'cast', label: 'Cast', soon: true },
      { key: 'welcome', label: 'Welcome screen' },
    ],
  },
  {
    title: 'Content',
    items: [
      { key: 'rosary', label: 'Rosary' },
      { key: 'lectionary', label: 'Lectionary', soon: true },
      { key: 'lyrics', label: 'Song lyrics', soon: true },
    ],
  },
  {
    title: 'Connections',
    items: [
      { key: 'remote', label: 'Remote view' },
      { key: 'cloud', label: 'Cloud sync' },
    ],
  },
  {
    title: 'System',
    items: [
      { key: 'backup', label: 'Backup & restore' },
      { key: 'updates', label: 'Updates' },
      { key: 'about', label: 'About & Licensing' },
    ],
  },
];

const button =
  'flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="mb-4 border-b border-line pb-2 text-xl font-bold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <section className="rounded-xl border border-dashed border-fg/15 bg-panel p-8 text-center">
      <h2 className="text-2xl font-bold tracking-tight">{label}</h2>
      <p className="mt-2 text-sm text-muted">This setting is not built yet. It will appear here when it is.</p>
    </section>
  );
}

/** Progress for a database move: a bar and a count of files copied so far. */
function MoveProgress({ progress }: { progress: MigrationProgress | null }) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-canvas p-4" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 size={15} className="animate-spin text-accent" aria-hidden />
        {total > 0
          ? `Moving database and media assets... [${done} / ${total} files]`
          : 'Moving database and media assets... preparing'}
      </div>
      <div
        role="progressbar"
        aria-label="Database move progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-panel-2"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
      {progress?.current && <p className="truncate font-mono text-[11px] text-muted">{progress.current}</p>}
      <p className="text-xs text-muted">Keep APCCMMA open until this finishes. Large media libraries can take several minutes over a network.</p>
    </div>
  );
}

export function Settings() {
  const [state, setState] = useState<ConfigState | null>(null);
  const [active, setActive] = useState<SectionKey>('theme');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.get().then(setState).catch((err) => setError(errorText(err)));
  useEffect(() => {
    void reload();
    return api.onMigrationProgress(setProgress);
  }, []);

  // Search filters the sidebar by label. Matching sections stay clickable; nothing is hidden from the content.
  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(q)) })).filter(
      (group) => group.items.length > 0,
    );
  }, [query]);

  /** Changes the language everywhere at once: this session's labels, and the saved default for next launch. */
  const changeLanguage = async (lang: Language) => {
    setError(null);
    setUi({ lang });
    try {
      await api.setLanguage(lang);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const changeLocation = async () => {
    setBusy(true);
    setMoving(true);
    setProgress(null);
    setError(null);
    try {
      const result = await api.changeLocation();
      if (result?.changed) {
        window.alert('Database path updated. Please restart APCCMMA to apply changes.');
        await reload();
      } else if (result && !result.changed) {
        window.alert('That is already the active database location.');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setMoving(false);
      setProgress(null);
      setBusy(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.backup();
      if (result) window.alert(`Backup saved and verified:\n${result.path}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <div className="p-6 text-sm text-muted">{error ?? 'Loading settings…'}</div>;
  }

  const activeLabel = NAV.flatMap((g) => g.items).find((i) => i.key === active)?.label ?? '';

  const content = (() => {
    switch (active) {
      case 'theme':
        return <ThemeView />;

      case 'language':
        return (
          <Card title="Language">
            <label className="flex flex-col gap-2">
              <span className="eyebrow flex items-center gap-2">
                <Globe2 size={14} aria-hidden /> Default language
              </span>
              <select
                value={state.config.default_language}
                onChange={(e) => void changeLanguage(e.target.value as Language)}
                className="h-11 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>{o.label}</option>
                ))}
              </select>
              <span className="text-xs text-muted">Used on every launch. The sidebar switch changes the language for the current session only.</span>
            </label>
          </Card>
        );

      case 'region':
        return <RegionSettings />;

      case 'lower3rd':
        return <LowerThirdSettings />;

      case 'welcome':
        return <WelcomeScreenSettings />;

      case 'projector':
        return <ProjectorSettingsPanel />;

      case 'rosary':
        return <RosarySettings />;

      case 'remote':
        return <RemoteViewSettings />;

      case 'cloud':
        return <CloudSyncSettings />;

      case 'backup':
        return (
          <div className="flex flex-col gap-6">
            {moving && <MoveProgress progress={progress} />}
            <Card title="Database & media">
              <div className="flex flex-col gap-2">
                <span className="eyebrow">Active database</span>
                <code aria-label="Active database path" className="block break-all rounded-md border border-fg/15 bg-panel-2 px-3 py-2 font-mono text-xs text-fg">
                  {state.databasePath}
                </code>
                <span className="eyebrow mt-2">Media folder</span>
                <code aria-label="Media folder path" className="block break-all rounded-md border border-fg/15 bg-panel-2 px-3 py-2 font-mono text-xs text-fg">
                  {state.assetsPath}
                </code>
                <p className="text-xs text-muted">Stays beside the database. Moving the database moves this folder with it.</p>
                {state.status.fallback && (
                  <p role="alert" className="flex items-start gap-2 text-xs text-danger">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                    {state.status.error}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={changeLocation} disabled={busy} className={button}>
                  {moving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FolderOpen size={15} aria-hidden />}
                  {moving ? 'Moving…' : 'Change Database Location'}
                </button>
                <button type="button" onClick={backup} disabled={busy || !state.status.connected} className={button}>
                  <DatabaseBackup size={15} aria-hidden /> Backup Database
                </button>
              </div>
              <p className="text-xs text-muted">
                A backup is a verified copy of the whole database. Keep one on a USB drive. Shared network folders work best for
                occasional use, since only one laptop should write to the database at a time.
              </p>
            </Card>
            <DatabaseSettings />
          </div>
        );

      case 'updates':
        return (
          <Card title="Updates">
            <UpdatesPanel installedVersion={state.version} />
          </Card>
        );

      case 'about':
        return (
          <Card title="About & Licensing">
            <AboutLicensing version={state.version} config={state.config} onChanged={() => void reload()} />
          </Card>
        );

      default: {
        const item = NAV.flatMap((g) => g.items).find((i) => i.key === active);
        return <ComingSoon label={item?.label ?? ''} />;
      }
    }
  })();

  return (
    // Disabling the fieldset locks every control on the page while a move runs.
    // A fieldset, not a div: disabling it locks every control while a database move runs. Its browser padding and margin are reset in the CSS.
    // Below xl the section list sits above the page, so the page keeps its full width at a 1024 px window. From xl it sits beside it.
    <fieldset disabled={moving} aria-busy={moving} className="m-0 flex h-full w-full min-w-0 flex-col overflow-hidden border-0 p-0 disabled:opacity-60 xl:flex-row">
      <aside aria-label="Settings sections" className="flex max-h-[40vh] w-full shrink-0 flex-col gap-5 overflow-y-auto border-b border-line bg-panel p-4 xl:h-full xl:max-h-none xl:w-64 xl:border-r xl:border-b-0">
        <h1 className="px-2 pt-2 text-3xl leading-tight font-extrabold tracking-tight text-fg">Settings</h1>

        <label className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="h-10 w-full rounded-md border border-fg/15 bg-panel-2 pr-3 pl-9 text-sm outline-none focus:border-accent"
          />
        </label>

        <nav className="flex flex-col gap-4">
          {filteredNav.length === 0 && <p className="px-2 text-sm text-muted">No settings match “{query}”.</p>}
          {filteredNav.map((group) => (
            <div key={group.title} className="flex flex-col gap-1">
              <span className="eyebrow px-2 pb-1">{group.title}</span>
              {group.items.map((item) => {
                const isActive = item.key === active;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActive(item.key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-lg border-l-[3px] px-3 py-2 text-left text-sm font-semibold transition ${
                      isActive ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5 text-accent' : 'border-transparent text-fg/80 hover:bg-fg/[0.06] hover:text-fg'
                    }`}
                  >
                    {item.key === 'theme' && <Palette size={14} aria-hidden />}
                    <span className="flex-1">{item.label}</span>
                    {item.soon && <span className="text-[10px] font-bold tracking-wider text-faint uppercase">Soon</span>}
                    {isActive && item.key === 'theme' && <Check size={13} strokeWidth={3} className="text-accent" aria-hidden />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <p className="mt-auto px-2 text-xs text-faint">APCCMMA v{state.version}</p>
      </aside>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6 xl:h-full" aria-label={activeLabel}>
        {error && (
          <div role="alert" className="rounded-md border border-danger/40 bg-panel px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        {content}
      </main>
    </fieldset>
  );
}
