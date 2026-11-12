import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Church,
  DatabaseBackup,
  FolderOpen,
  Globe2,
  Loader2,
  MonitorPlay,
  Palette,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { DatabaseSettings } from './DatabaseSettings';
import { IntentionPrivacySettings } from './IntentionPrivacySettings';
import { bridge } from '../live/bridge';
import { setUi, useUi } from '../state/ui';
import { RosarySettings } from './RosarySettings';
import { LectionarySettings } from './LectionarySettings';
import { LyricsSettings } from './LyricsSettings';
import { ProjectorSettingsPanel } from './ProjectorSettings';
import { LowerThirdSettings } from './LowerThirdSettings';
import { WelcomeScreenSettings } from './WelcomeScreenSettings';
import { RemoteViewSettings } from './RemoteViewSettings';
import { CloudSyncSettings } from './CloudSyncSettings';
import { RegionSettings } from './RegionSettings';
import { ThemeView } from './ThemeView';
import { UpdatesPanel } from './UpdatesSettings';
import { AboutLicensing } from './AboutLicensing';
import { ChurchProfileSettings } from './ChurchProfileSettings';
import type { ConfigState, Language, MigrationProgress } from './types';

const api = bridge.config;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ceb', label: 'Cebuano' },
];

type SectionKey =
  | 'profile'
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

const NAV: { title: string; icon: LucideIcon; items: NavItem[] }[] = [
  {
    title: 'Parish',
    icon: Church,
    items: [{ key: 'profile', label: 'Parish Profile & Logo' }],
  },
  {
    title: 'Appearance',
    icon: Palette,
    items: [
      { key: 'theme', label: 'Theme' },
      { key: 'language', label: 'Language' },
      { key: 'region', label: 'Region' },
    ],
  },
  {
    title: 'Output',
    icon: MonitorPlay,
    items: [
      { key: 'projector', label: 'Projector' },
      { key: 'lower3rd', label: 'Lower 3rd & OBS' },
      { key: 'cast', label: 'Cast', soon: true },
      { key: 'welcome', label: 'Welcome screen' },
    ],
  },
  {
    title: 'Content',
    icon: BookOpen,
    items: [
      { key: 'rosary', label: 'Rosary' },
      { key: 'lectionary', label: 'Lectionary' },
      { key: 'lyrics', label: 'Song lyrics' },
    ],
  },
  {
    title: 'Connections',
    icon: RefreshCw,
    items: [
      { key: 'remote', label: 'Remote view' },
      { key: 'cloud', label: 'Cloud sync' },
    ],
  },
  {
    title: 'System',
    icon: Settings2,
    items: [
      { key: 'backup', label: 'Backup & restore' },
      { key: 'updates', label: 'Updates' },
      { key: 'about', label: 'About & Licensing' },
    ],
  },
];

/** Sections laid out as a form beside a live preview: they use the full width of the canvas. */
const WIDE_SECTIONS = new Set<SectionKey>(['welcome', 'rosary', 'profile']);

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

  // A section another screen asked for (the Lower Third drawer's "Edit team" opens the Parish profile).
  const requested = useUi((s) => s.settingsSection);
  useEffect(() => {
    if (!requested) return;
    if (NAV.some((g) => g.items.some((i) => i.key === requested))) {
      setQuery('');
      setActive(requested as SectionKey);
    }
    setUi({ settingsSection: null });
  }, [requested]);

  const reload = () => api.get().then(setState).catch((err) => setError(errorText(err)));
  useEffect(() => {
    void reload();
    return api.onMigrationProgress(setProgress);
  }, []);

  // Search lists the sections whose name or category matches, across every category, in the row under the tabs.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return NAV.flatMap((group) =>
      group.items.filter((item) => item.label.toLowerCase().includes(q) || group.title.toLowerCase().includes(q)).map((item) => ({ ...item, group: group.title })),
    );
  }, [query]);
  // The section last opened in each category, so going back to a tab returns to where the operator was.
  const [lastInGroup, setLastInGroup] = useState<Record<string, SectionKey>>({});
  const activeGroup = NAV.find((g) => g.items.some((i) => i.key === active)) ?? NAV[0];
  const open = (key: SectionKey) => {
    const group = NAV.find((g) => g.items.some((i) => i.key === key));
    if (group) setLastInGroup((prev) => ({ ...prev, [group.title]: key }));
    setActive(key);
  };

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
      case 'profile':
        return <ChurchProfileSettings />;

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

      case 'lectionary':
        return <LectionarySettings />;

      case 'lyrics':
        return <LyricsSettings />;

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
            <IntentionPrivacySettings />
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
    <fieldset disabled={moving} aria-busy={moving} className="m-0 flex h-full w-full min-w-0 flex-col overflow-hidden border-0 p-0 disabled:opacity-60">
      <header className="flex shrink-0 flex-col border-b border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pt-4">
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-fg">Settings</h1>

          {/* The categories, as tabs. Each opens the section last used in it. */}
          <nav aria-label="Settings categories" className="-mb-px flex min-w-0 flex-1 flex-wrap items-end gap-1">
            {NAV.map((group) => {
              const Icon = group.icon;
              const on = !matches && group === activeGroup;
              return (
                <button
                  key={group.title}
                  type="button"
                  onClick={() => {
                    setQuery('');
                    open(lastInGroup[group.title] ?? group.items[0].key);
                  }}
                  aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                    on ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-fg/70 hover:bg-fg/[0.05] hover:text-fg'
                  }`}
                >
                  <Icon size={16} aria-hidden /> {group.title}
                </button>
              );
            })}
          </nav>

          <label className="relative w-full max-w-60 pb-2">
            <Search size={15} className="pointer-events-none absolute top-[calc(50%-4px)] left-3 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-9 w-full rounded-md border border-fg/15 bg-panel-2 pr-3 pl-9 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>

        {/* The sections of the open category, or every section the search matches. */}
        <div role="tablist" aria-label={matches ? 'Matching settings' : `${activeGroup.title} sections`} className="flex flex-wrap items-center gap-1.5 border-t border-line bg-panel-2/40 px-6 py-2">
          {matches && matches.length === 0 && <p className="py-1 text-sm text-muted">No settings match “{query}”.</p>}
          {(matches ?? activeGroup.items.map((item) => ({ ...item, group: null as string | null }))).map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setQuery('');
                  open(item.key);
                }}
                className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                  isActive ? 'border-accent/50 bg-accent/15 text-accent' : 'border-transparent text-fg/70 hover:border-line hover:text-fg'
                }`}
              >
                {item.group && <span className="text-[10px] font-bold tracking-wider text-faint uppercase">{item.group}</span>}
                {item.label}
                {item.soon && <span className="text-[10px] font-bold tracking-wider text-faint uppercase">Soon</span>}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-faint">APCCMMA v{state.version}</span>
        </div>
      </header>

      {/* The canvas spans the whole width. Split pages (the Welcome screen) use all of it; form pages keep a readable line length. */}
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto p-6" aria-label={activeLabel}>
        <div className={`flex w-full flex-col gap-6 ${WIDE_SECTIONS.has(active) ? '' : 'mx-auto max-w-5xl'}`}>
          {error && (
            <div role="alert" className="rounded-md border border-danger/40 bg-panel px-4 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          {content}
        </div>
      </main>
    </fieldset>
  );
}
