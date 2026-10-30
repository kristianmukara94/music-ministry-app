import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Pause, RefreshCw, RotateCw } from 'lucide-react';
import { bridge } from '../live/bridge';
import { formatDay, formatDayAndClock } from '../state/region';
import { useRegion } from '../state/useRegion';
import type { ReleaseSummary, UpdateChannel, UpdateEvent, UpdateSettings, UpdatesState } from './types';

const api = bridge.updates;

// The Updates page uses its own dark palette, as specified for this panel. It does not follow the app's theme switcher.
const CARD = 'rounded-xl border border-[#27272a] bg-[#18181b] p-5 text-[#e4e4e7]';
const MUTED = 'text-[#a1a1aa]';
const GOLD = 'text-[#D4AF37]';
const ghostButton =
  'flex h-9 items-center gap-2 rounded-md border border-[#27272a] px-3 text-xs font-semibold text-[#e4e4e7] hover:bg-[#27272a] disabled:opacity-40';
const amberButton =
  'flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-bold uppercase text-[#18181b] shadow-md hover:brightness-110 disabled:opacity-40';
const greenButton =
  'flex h-10 items-center gap-2 rounded-md bg-ok px-4 text-xs font-bold uppercase text-[#18181b] shadow-md hover:brightness-110 disabled:opacity-40';

const MB = 1024 * 1024;
const megabytes = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const DEFAULT_SETTINGS: UpdateSettings = { channel: 'stable', skippedVersion: null, pauseOnMetered: false };

type Tab = 'status' | 'history';

interface HistoryState {
  status: 'loading' | 'ready' | 'error';
  releases: ReleaseSummary[];
  error: string | null;
}

interface Props {
  installedVersion: string;
}

/** The Updates page: the installed version, the release channel, the update status, and the release history. */
export function UpdatesPanel({ installedVersion }: Props) {
  const [state, setState] = useState<UpdatesState>({ last: null, lastCheckedAt: null, settings: DEFAULT_SETTINGS });
  const [tab, setTab] = useState<Tab>('status');
  const [history, setHistory] = useState<HistoryState>({ status: 'loading', releases: [], error: null });
  // The version the operator asked to be reminded about later. Hidden until the next manual check.
  const [remindedVersion, setRemindedVersion] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = api.onEvent((event: UpdateEvent) => {
      const checked = event.channel === 'UPDATE_AVAILABLE' || event.channel === 'UPDATE_NOT_AVAILABLE';
      setState((current) => ({ ...current, last: event, lastCheckedAt: checked ? Date.now() : current.lastCheckedAt }));
    });
    // An event that arrived before this reply is newer than the saved state, so it wins.
    api
      .getState()
      .then((saved) => setState((current) => (current.last ? { ...current, lastCheckedAt: current.lastCheckedAt ?? saved.lastCheckedAt, settings: saved.settings } : saved)))
      .catch(() => undefined);
    loadHistory();
    return unsubscribe;
  }, []);

  function loadHistory() {
    setHistory((current) => ({ ...current, status: 'loading', error: null }));
    api
      .getReleaseHistory()
      .then((releases) => setHistory({ status: 'ready', releases, error: null }))
      .catch((err: unknown) => setHistory({ status: 'error', releases: [], error: errorText(err) }));
  }

  /** A request that fails before the main process reports it is shown as an error, not lost. */
  const run = (task: () => Promise<void>, after?: () => void) => {
    task()
      .then(after)
      .catch((err: unknown) => setState((current) => ({ ...current, last: { channel: 'UPDATE_ERROR', payload: { message: errorText(err) } } })));
  };

  const refreshSettings = () => {
    api
      .getState()
      .then((saved) => setState((current) => ({ ...current, settings: saved.settings })))
      .catch(() => undefined);
  };

  const check = () => {
    setRemindedVersion(null);
    run(() => api.check());
  };
  const download = (force = false) => run(() => api.download(force));
  const restart = () => {
    if (window.confirm('APCCMMA will close to install the update. Continue?')) run(() => api.restart());
  };
  const changeChannel = (channel: UpdateChannel) => {
    if (channel === state.settings.channel) return;
    // Switching channels checks at once, so the page shows what the new channel offers.
    run(() => api.setChannel(channel), () => {
      refreshSettings();
      check();
    });
  };
  const skip = (version: string) => run(() => api.skipVersion(version), refreshSettings);
  const remindLater = (version: string) => {
    setRemindedVersion(version);
    run(() => api.remindLater());
  };
  const togglePause = () => run(() => api.setPauseOnMetered(!state.settings.pauseOnMetered), refreshSettings);

  const event = state.last;
  const working = event?.channel === 'UPDATE_CHECKING' || event?.channel === 'UPDATE_PROGRESS';
  const availableVersion = event?.channel === 'UPDATE_AVAILABLE' ? event.payload.version : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm">
          Installed version <span className="font-mono font-bold">v{installedVersion}</span>
        </p>
        <button type="button" onClick={check} disabled={working} className={ghostButton}>
          <RefreshCw size={15} aria-hidden className={event?.channel === 'UPDATE_CHECKING' ? 'animate-spin' : undefined} />
          Check for updates
        </button>
      </div>

      <ChannelSelector channel={state.settings.channel} disabled={working} onChange={changeChannel} />

      <div role="tablist" aria-label="Updates view" className="flex gap-2 border-b border-[#27272a]">
        {(['status', 'history'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 pb-2 text-xs font-bold uppercase ${tab === key ? `border-[#D4AF37] ${GOLD}` : `border-transparent ${MUTED} hover:text-[#e4e4e7]`}`}
          >
            {key === 'status' ? 'Status' : 'Release history'}
          </button>
        ))}
      </div>

      {tab === 'status' ? (
        <div className="flex flex-col gap-5">
          {availableVersion && remindedVersion === availableVersion ? (
            <p className={`text-sm ${MUTED}`}>
              Reminder set. APCCMMA v{availableVersion} will show again on the next background check.
            </p>
          ) : (
            <UpdateStatus
              event={event}
              lastCheckedAt={state.lastCheckedAt}
              skippedVersion={state.settings.skippedVersion}
              onCheck={check}
              onDownload={() => download(false)}
              onDownloadAnyway={() => download(true)}
              onRemindLater={remindLater}
              onSkip={skip}
              onRestart={restart}
            />
          )}

          <NetworkSafeguards enabled={state.settings.pauseOnMetered} onToggle={togglePause} />
        </div>
      ) : (
        <ReleaseHistory history={history} onRetry={loadHistory} />
      )}
    </div>
  );
}

function ChannelSelector({ channel, disabled, onChange }: { channel: UpdateChannel; disabled: boolean; onChange: (channel: UpdateChannel) => void }) {
  const options: { value: UpdateChannel; label: string }[] = [
    { value: 'stable', label: 'Stable' },
    { value: 'beta', label: 'Beta / Pre-release' },
  ];
  return (
    <div className={`${CARD} flex flex-wrap items-center justify-between gap-4 p-4`}>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold tracking-wider text-[#a1a1aa] uppercase">Release channel</span>
        <span className={`text-xs ${MUTED}`}>Beta includes pre-releases, which are tested less than stable releases.</span>
      </div>
      <div role="radiogroup" aria-label="Release channel" className="inline-flex rounded-lg border border-[#27272a] bg-[#09090b] p-1">
        {options.map((option) => {
          const active = channel === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-md px-4 py-1.5 text-xs font-bold uppercase transition disabled:opacity-40 ${active ? 'bg-[#D4AF37] text-[#18181b]' : `${MUTED} hover:text-[#e4e4e7]`}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NetworkSafeguards({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <div className={`${CARD} flex flex-wrap items-center justify-between gap-4 p-4`}>
      <div className="flex max-w-xl flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Pause size={14} aria-hidden /> Pause background downloads on metered connections
        </span>
        <span className={`text-xs ${MUTED}`}>
          When on, a download waits if Windows reports the connection as metered, such as a mobile hotspot. You can still download anyway from the update card.
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Pause background downloads on metered connections"
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? 'bg-[#D4AF37]' : 'bg-[#3f3f46]'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#fafafa] transition ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

interface StatusProps {
  event: UpdateEvent | null;
  lastCheckedAt: number | null;
  skippedVersion: string | null;
  onCheck: () => void;
  onDownload: () => void;
  onDownloadAnyway: () => void;
  onRemindLater: (version: string) => void;
  onSkip: (version: string) => void;
  onRestart: () => void;
}

function UpdateStatus({ event, lastCheckedAt, skippedVersion, onCheck, onDownload, onDownloadAnyway, onRemindLater, onSkip, onRestart }: StatusProps) {
  const region = useRegion();
  if (!event) {
    return <p className={`text-sm ${MUTED}`}>Press Check for updates to look for a newer version on GitHub.</p>;
  }

  switch (event.channel) {
    case 'UPDATE_CHECKING':
      return (
        <div role="status" aria-live="polite" className={`${CARD} flex items-center gap-3 text-sm`}>
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          Checking GitHub Releases for updates...
        </div>
      );

    case 'UPDATE_NOT_AVAILABLE':
      return (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-ok/40 bg-ok/10 px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-bold text-ok">
            <CheckCircle2 size={16} aria-hidden /> You are running the latest version
          </span>
          {lastCheckedAt && <span className={`text-xs ${MUTED}`}>Last checked {formatDayAndClock(new Date(lastCheckedAt), region, { seconds: true })}</span>}
        </div>
      );

    case 'UPDATE_AVAILABLE': {
      const { version, notes } = event.payload;
      const skipped = skippedVersion === version;
      return (
        <div role="status" className={`${CARD} flex flex-col gap-4`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-accent/50 bg-accent/15 px-3 py-1 text-xs font-bold text-accent uppercase">
              New Version v{version} Available
            </span>
            {skipped && <span className={`text-xs ${MUTED}`}>You skipped this version. Background checks stay quiet for it.</span>}
          </div>
          {notes && <p className="max-h-64 overflow-y-auto text-sm break-words whitespace-pre-line text-[#d4d4d8]">{notes}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onDownload} className={amberButton}>
              <Download size={15} aria-hidden /> Download Now
            </button>
            <button type="button" onClick={() => onRemindLater(version)} className={ghostButton}>
              Remind Me Later
            </button>
            <button type="button" onClick={() => onSkip(version)} className={ghostButton}>
              Skip This Version
            </button>
          </div>
        </div>
      );
    }

    case 'UPDATE_PAUSED':
      return (
        <div role="status" className="flex flex-col gap-4 rounded-xl border border-accent/50 bg-accent/10 p-5 text-[#e4e4e7]">
          <span className="flex items-center gap-2 text-sm font-bold text-accent">
            <Pause size={16} aria-hidden /> Download paused: this is a metered connection
          </span>
          <p className={`text-xs ${MUTED}`}>Connect to an unmetered network and retry, or download anyway now.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onDownloadAnyway} className={amberButton}>
              <Download size={15} aria-hidden /> Download Anyway
            </button>
            <button type="button" onClick={onDownload} className={ghostButton}>
              <RefreshCw size={15} aria-hidden /> Retry
            </button>
          </div>
        </div>
      );

    case 'UPDATE_PROGRESS': {
      const { percent, transferred, total, bytesPerSecond } = event.payload;
      return (
        <div role="status" className={`${CARD} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
            <span>Downloading update</span>
            <span className="font-mono">
              {Math.round(percent)}% - {megabytes(transferred)} / {megabytes(total)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Update download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-2 w-full overflow-hidden rounded-full bg-[#27272a]"
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${percent}%` }} />
          </div>
          <p className={`text-xs ${MUTED}`}>{megabytes(bytesPerSecond)}/s. Keep APCCMMA open until the download finishes.</p>
        </div>
      );
    }

    case 'UPDATE_DOWNLOADED':
      return (
        <div role="status" className="flex flex-col gap-4 rounded-xl border border-ok/40 bg-ok/10 p-5 text-[#e4e4e7]">
          <span className="flex items-center gap-2 text-sm font-bold text-ok">
            <CheckCircle2 size={16} aria-hidden /> Update v{event.payload.version} Downloaded
          </span>
          <p className={`text-xs ${MUTED}`}>Restart to finish installing. It also installs the next time APCCMMA quits.</p>
          <div>
            <button type="button" onClick={onRestart} className={greenButton}>
              <RotateCw size={15} aria-hidden /> Restart &amp; Apply Update
            </button>
          </div>
        </div>
      );

    case 'UPDATE_ERROR':
      return (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger bg-danger/10 p-5 text-[#e4e4e7]">
          <span className="flex items-center gap-2 text-sm font-bold text-danger">
            <AlertTriangle size={16} aria-hidden /> The update could not be completed
          </span>
          <p className="break-words font-mono text-xs text-[#fca5a5]">{event.payload.message}</p>
          <div>
            <button type="button" onClick={onCheck} className={ghostButton}>
              <RefreshCw size={15} aria-hidden /> Retry Check
            </button>
          </div>
        </div>
      );
  }
}

// ---- Markdown changelog -------------------------------------------------------------------------

/** Bold, code, and the three change tags. Capturing group, so split() keeps the matches. */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[(?:Feature|Fix|Security)\])/i;

const BADGE_STYLE: Record<string, string> = {
  feature: 'border-[#D4AF37]/50 bg-[#D4AF37]/15 text-[#D4AF37]',
  fix: 'border-info/50 bg-info/15 text-info',
  security: 'border-danger/50 bg-danger/15 text-danger',
};

function Badge({ tag }: { tag: string }) {
  const key = tag.toLowerCase();
  return (
    <span className={`mx-0.5 inline-block rounded border px-1.5 py-px align-middle text-[10px] font-bold tracking-wider uppercase ${BADGE_STYLE[key]}`}>
      {key}
    </span>
  );
}

/** Text inside a line. Only React text nodes are built here, so release notes can never inject markup. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        if (!part) return null;
        const tag = /^\[(Feature|Fix|Security)\]$/i.exec(part);
        if (tag) return <Badge key={i} tag={tag[1]} />;
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-bold text-fg">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="rounded bg-[#27272a] px-1 font-mono text-[0.9em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** The lines under one heading, with consecutive bullets grouped into a list. */
function Body({ lines }: { lines: string[] }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-5">
        {items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      items.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}><Inline text={line.trim()} /></p>);
  }
  flush();
  return <div className="space-y-2 text-sm text-[#d4d4d8]">{blocks}</div>;
}

interface Section {
  title: string | null;
  lines: string[];
}

/** Splits Markdown at its headings. Each heading becomes a collapsible section. */
function parseSections(markdown: string): Section[] {
  const sections: Section[] = [{ title: null, lines: [] }];
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = /^#{1,3}\s+(.*)$/.exec(raw.trim());
    if (heading) sections.push({ title: heading[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(raw.trimEnd());
  }
  return sections.filter((section) => section.title || section.lines.some((line) => line.trim()));
}

function ChangelogView({ markdown, fallback }: { markdown: string; fallback: string }) {
  const sections = parseSections(markdown);
  if (sections.length === 0) return <p className={`text-sm ${MUTED}`}>{fallback}</p>;
  return (
    <div className="flex flex-col gap-2">
      {sections.map((section, i) =>
        section.title ? (
          <details key={i} open={i < 3} className="group rounded-lg border border-[#27272a] bg-[#09090b] px-4 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-sm font-semibold text-[#e4e4e7]">
              <Inline text={section.title} />
              <ChevronDown size={15} aria-hidden className="shrink-0 text-[#a1a1aa] transition group-open:rotate-180" />
            </summary>
            <div className="pt-2 pb-1">
              <Body lines={section.lines} />
            </div>
          </details>
        ) : (
          <div key={i} className="px-1">
            <Body lines={section.lines} />
          </div>
        ),
      )}
    </div>
  );
}

// ---- Release history --------------------------------------------------------------------------

function ReleaseHistory({ history, onRetry }: { history: HistoryState; onRetry: () => void }) {
  const region = useRegion();
  if (history.status === 'loading') {
    return <p className={`text-sm ${MUTED}`}>Loading the last five releases...</p>;
  }
  if (history.status === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger bg-danger/10 p-5 text-[#e4e4e7]">
        <span className="text-sm font-bold text-danger">Could not load the release history</span>
        <p className="break-words font-mono text-xs text-[#fca5a5]">{history.error}</p>
        <div>
          <button type="button" onClick={onRetry} className={ghostButton}>
            <RefreshCw size={15} aria-hidden /> Retry
          </button>
        </div>
      </div>
    );
  }
  if (history.releases.length === 0) {
    return <p className={`text-sm ${MUTED}`}>No releases have been published yet.</p>;
  }
  return (
    <ol className="relative ml-2 flex flex-col gap-6 border-l border-[#27272a] pl-6">
      {history.releases.map((release) => (
        <li key={release.tag_name} className="relative">
          <span className="absolute top-1.5 -left-[31px] h-3 w-3 rounded-full border-2 border-[#D4AF37] bg-[#18181b]" aria-hidden />
          <details className={`${CARD} p-4`}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
              <span className="font-mono text-sm font-bold text-[#D4AF37]">{release.tag_name}</span>
              <span className="text-sm font-semibold">{release.name}</span>
              {release.prerelease && (
                <span className="rounded-full border border-accent/50 bg-accent/15 px-2 py-px text-[10px] font-bold text-accent uppercase">Pre-release</span>
              )}
              <span className={`ml-auto text-xs ${MUTED}`}>{formatDay(new Date(release.published_at), region)}</span>
            </summary>
            <div className="mt-4">
              <ChangelogView markdown={release.body} fallback="This release has no notes." />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
