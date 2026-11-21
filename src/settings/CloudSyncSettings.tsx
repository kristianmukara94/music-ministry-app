import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Church,
  ClipboardCopy,
  Cloud,
  Copy,
  ExternalLink,
  Laptop,
  ListChecks,
  Music,
  Palette,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Unlink,
  UploadCloud,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import {
  bridge,
  type CloudLink,
  type CreatedChurchAdmin,
  type CreatedWebUser,
  type NewChurchAdmin,
  type NewWebUser,
  type SongsSyncState,
  type PlansSyncState,
  type SyncActivityEntry,
  type ThemeSyncState,
} from '../live/bridge';
import { THEMES } from '../theme/themes';
import {
  checkChurchSetup,
  checkWebUser,
  cloudViewState,
  formatLinkCode,
  plainErrorText,
  formatSetupKey,
  isCompleteLinkCode,
  lastSyncedText,
} from '../../shared/cloud-device.js';
import {
  channelCards,
  connectionPill,
  failedPlanWhen,
  latest,
  unlinkStep,
  type CardTone,
  type PillTone,
  type UnlinkStep,
} from '../../shared/cloud-sync-panel.js';
import { refreshLicense, useLicense } from '../live/license';
import { RenewLicenseDialog } from '../live/RenewLicenseDialog';
import { NO_DRAG } from '../components/appRegion';

const cloud = bridge.cloud;
const errorText = (err: unknown) => plainErrorText(err instanceof Error ? err.message : String(err));
const emptyUser: NewWebUser = { username: '', displayName: '', role: 'planner' };
const emptySetup: NewChurchAdmin = { setupKey: '', churchName: '', username: '', displayName: '', deviceLabel: '' };

const button =
  'flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const small =
  'flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[11px] font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const primary =
  'flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-bold uppercase text-on-accent shadow-md hover:brightness-110 disabled:opacity-40';
const danger =
  'flex h-10 items-center gap-2 rounded-md border border-danger px-4 text-xs font-bold uppercase text-danger hover:bg-danger/10 disabled:opacity-40';
const field = 'h-10 rounded-md border border-line-strong bg-panel-2 px-3 font-mono text-sm outline-none focus:border-accent';

const PILL_STYLE: Record<PillTone, string> = {
  connected: 'border-ok/50 bg-ok/10 text-ok',
  syncing: 'border-info/50 bg-info/10 text-info',
  attention: 'border-warn/60 bg-warn/10 text-warn',
  offline: 'border-danger/50 bg-danger/10 text-danger',
  unlinked: 'border-line-strong bg-panel-2 text-muted',
};
const BADGE_STYLE: Record<CardTone, string> = {
  connected: 'bg-ok/15 text-ok',
  syncing: 'bg-info/15 text-info',
  attention: 'bg-warn/15 text-warn',
  offline: 'bg-danger/15 text-danger',
  idle: 'bg-panel-2 text-muted',
};
const DOT_STYLE: Record<PillTone, string> = {
  connected: 'bg-ok',
  syncing: 'bg-info animate-pulse',
  attention: 'bg-warn',
  offline: 'bg-danger',
  unlinked: 'bg-muted',
};

/** The website-theme line: which theme the web planner shows, and whether this laptop's latest choice has reached it. */
function themeName(id: string | null | undefined): string {
  if (!id) return 'No theme sent';
  return THEMES.find((t) => t.id === id)?.name ?? id;
}

function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {aside}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** One label/value pair of the summary grid. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-panel-2 px-4 py-3">
      <span className="eyebrow text-muted">{label}</span>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

const arrow = (direction: SyncActivityEntry['direction']) => (direction === 'pull' ? '↓ Pull' : direction === 'both' ? '↕ Sync' : '↑ Push');
const activityTone: Record<SyncActivityEntry['status'], string> = { ok: 'text-ok', warn: 'text-warn', error: 'text-danger' };

/**
 * Cloud sync: links this laptop to its church with a one-time code from the admin, and shows and steers the link. The device token is
 * kept on this computer, encrypted by the operating system. This screen only ever receives display fields: never a token or password
 * other than a just-created temporary password, which lives only in this screen's state.
 */
export function CloudSyncSettings() {
  const [link, setLink] = useState<CloudLink | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [themeSync, setThemeSync] = useState<ThemeSyncState | null>(null);
  const [busy, setBusy] = useState(false);
  // Which action is running, for its button's label. Only one runs at a time.
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [newUser, setNewUser] = useState<NewWebUser>(emptyUser);
  const [created, setCreated] = useState<CreatedWebUser | null>(null);
  const [copied, setCopied] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [setup, setSetup] = useState<NewChurchAdmin>(emptySetup);
  const [createdChurch, setCreatedChurch] = useState<CreatedChurchAdmin | null>(null);
  const [copiedChurch, setCopiedChurch] = useState(false);
  const [songs, setSongs] = useState<SongsSyncState | null>(null);
  const [plans, setPlans] = useState<PlansSyncState | null>(null);
  const [activity, setActivity] = useState<SyncActivityEntry[]>([]);
  const [autoSync, setAutoSyncState] = useState(true);
  const [showFailed, setShowFailed] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [unlinkAt, setUnlinkAt] = useState<UnlinkStep>('idle');
  // What the operator has typed in the address field. Null until they type, so the field shows the current address.
  const [addressText, setAddressText] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const license = useLicense((s) => s.status);
  const [renewing, setRenewing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Activating, unlinking, or a link revoked on the website all change the license, and each one arrives here as a new link state.
  useEffect(() => {
    void refreshLicense();
  }, [link]);

  const loadChannels = useCallback(() => {
    cloud.songsStatus().then(setSongs).catch(() => {});
    cloud.plansStatus().then((p) => {
      setPlans(p);
      if (typeof p.autoSync === 'boolean') setAutoSyncState(p.autoSync);
    }).catch(() => {});
    cloud.themeStatus().then(setThemeSync).catch(() => {});
    cloud.activity().then(setActivity).catch(() => {});
    setNow(Date.now());
  }, []);

  // The channels' state, refreshed while the screen is open: often while something is syncing, otherwise every 30 seconds.
  const anySyncing = plans?.status === 'syncing' || songs?.status === 'syncing' || themeSync?.status === 'syncing';
  useEffect(() => {
    loadChannels();
    const timer = window.setInterval(loadChannels, anySyncing ? 3000 : 30000);
    return () => window.clearInterval(timer);
  }, [loadChannels, anySyncing]);

  useEffect(() => {
    void cloud.autoSync().then((r) => setAutoSyncState(r.autoSync)).catch(() => {});
  }, []);

  // The temporary password and the setup key live only in this screen's state. Both are cleared when the screen goes away.
  useEffect(
    () => () => {
      setCreated(null);
      setCreatedChurch(null);
      setSetup(emptySetup);
    },
    [],
  );

  const refresh = () =>
    cloud
      .status()
      .then(setLink)
      .catch((err) => setError(errorText(err)));

  useEffect(() => {
    void refresh();
    void cloud.defaultLabel().then(setLabel).catch(() => setLabel('This computer'));
  }, []);

  if (!link) return <div className="p-6 text-sm text-muted">{error ?? 'Checking the link…'}</div>;

  const view = cloudViewState(link);
  const shownError = error ?? view.error;
  const pill = connectionPill({ link, plans, songs, theme: themeSync });
  const cards = channelCards({ plans, songs, theme: themeSync }, now);
  const failures = plans?.failures ?? [];
  const lastSyncAt = latest(plans?.lastSyncedAt, songs?.lastSyncedAt);

  /** Runs one action with the busy state, a plain error, and a refresh of every channel afterwards. */
  const act = async (name: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setWorking(name);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setWorking(null);
      loadChannels();
    }
  };

  const linkThisLaptop = () =>
    act('link', async () => {
      setLink(await cloud.link(code, label.trim()));
      setCode('');
    });

  const unlink = async () => {
    setUnlinkAt((s) => unlinkStep(s, 'confirm'));
    await act('unlink', async () => setLink(await cloud.unlink()));
    setUnlinkAt((s) => unlinkStep(s, 'done'));
  };

  const syncNow = () =>
    act('sync', async () => {
      const result = await cloud.syncNow();
      setPlans(result.plans);
      setSongs(result.songs);
    });
  const retryFailed = () => act('retry', async () => setPlans(await cloud.retryFailedPlans()));
  const forcePush = () =>
    act('force', async () => setPlans(await cloud.forcePushPlans()), 'Every plan on this laptop was sent again, and the website’s plans were read again.');
  const resyncSongs = () => act('songs', async () => setSongs(await cloud.syncSongsNow()));
  const pushTheme = () => act('theme', async () => setThemeSync(await cloud.pushThemeNow()));
  const toggleAutoSync = () =>
    act('auto', async () => {
      const r = await cloud.setAutoSync(!autoSync);
      setAutoSyncState(r.autoSync);
    });
  const copyDiagnostics = () =>
    act('diag', async () => {
      const text = await cloud.diagnostics();
      await navigator.clipboard.writeText(text);
    }, 'Diagnostics copied. They hold no passwords or link keys.');

  const newUserProblem = checkWebUser(newUser);
  const newUserTyped = newUser.username !== '' || newUser.displayName !== '';

  const addWebUser = () =>
    act('user', async () => {
      setCreated(await cloud.createWebUser(newUser));
      setCopied(false);
      setNewUser(emptyUser);
      setAddingUser(false);
    });

  const closeCreated = () => {
    setCreated(null);
    setCopied(false);
  };

  const copyPassword = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the password and copy it by hand.');
    }
  };

  // Saves the address to config.json. The link is not touched: only the address the laptop talks to changes.
  const saveAddress = () =>
    act('address', async () => {
      const result = await cloud.saveAddress(addressText ?? link?.address ?? '');
      if (!result.ok) {
        setError(result.message ?? 'The address could not be saved.');
        return;
      }
      setAddressText(null);
      setEditingAddress(false);
      setLink(await cloud.status());
    });

  // Linked to an address other than the one now set: the link is kept, and the operator is told to check it.
  const linkedElsewhere = Boolean(link?.linked && link.linkedAddress && link.address && link.linkedAddress !== link.address);

  const setupProblem = checkChurchSetup(setup);
  const setupTyped = setup.setupKey !== '' || setup.churchName !== '' || setup.username !== '' || setup.displayName !== '';

  const openSetup = () => {
    setSetup({ ...emptySetup, deviceLabel: label });
    setSettingUp(true);
  };

  const closeSetup = () => {
    setSettingUp(false);
    setSetup(emptySetup);
  };

  const createChurch = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await cloud.createChurchAdmin(setup);
      setCreatedChurch(result);
      setCopiedChurch(false);
      setLink(result.link);
      setSettingUp(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      // The setup key is cleared whatever the outcome. A failed attempt needs the key typed again.
      setSetup(emptySetup);
      setBusy(false);
    }
  };

  const closeChurchResult = () => {
    setCreatedChurch(null);
    setCopiedChurch(false);
  };

  const copyChurchPassword = async () => {
    if (!createdChurch) return;
    try {
      await navigator.clipboard.writeText(createdChurch.temporaryPassword);
      setCopiedChurch(true);
    } catch {
      setError('Could not copy. Select the password and copy it by hand.');
    }
  };

  const addressEditor = (
    <div className="flex flex-col gap-2">
      <input
        style={NO_DRAG}
        value={addressText ?? link.address ?? ''}
        onChange={(e) => setAddressText(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-label="Cloud address"
        className={`${field} w-full font-mono text-xs`}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" style={NO_DRAG} onClick={saveAddress} disabled={busy} className={small}>
          Save address
        </button>
        {view.kind !== 'unlinked' && (
          <button
            type="button"
            style={NO_DRAG}
            onClick={() => {
              setEditingAddress(false);
              setAddressText(null);
            }}
            disabled={busy}
            className={small}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  const statusAside = (
    <div className="flex flex-wrap items-center gap-3">
      <span role="status" className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${PILL_STYLE[pill.tone]}`}>
        <span aria-hidden className={`h-2 w-2 rounded-full ${DOT_STYLE[pill.tone]}`} />
        {pill.label}
      </span>
      {view.kind !== 'unlinked' && (
        <span className="text-xs text-muted">Last synced {lastSyncAt ? lastSyncedText(lastSyncAt, now).toLowerCase() : view.lastSynced.toLowerCase()}</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card title="Cloud sync" aside={statusAside}>
        <p className="flex items-start gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />
          <span>
            <span className="font-bold text-fg">Plans &amp; song titles synced</span> · Lyrics, Bible, announcements &amp; media stay local
          </span>
        </p>

        {view.kind === 'unlinked' && (
          <>
            <label className="flex flex-col gap-2">
              <span className="eyebrow">Cloud address</span>
              <div className="max-w-xl">{addressEditor}</div>
            </label>
            {license?.statusText && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={`text-sm font-semibold ${license.canProject ? '' : 'text-danger'}`}>{license.statusText}</p>
              </div>
            )}

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="eyebrow flex items-center gap-2">
                  <Copy size={14} aria-hidden /> Link code from your admin
                </span>
                <input
                  style={NO_DRAG}
                  value={code}
                  onChange={(e) => setCode(formatLinkCode(e.target.value))}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="link-code-help"
                  className={`${field} w-48 uppercase tracking-widest`}
                />
                <span id="link-code-help" className="text-xs text-muted">
                  The code works once and expires after 10 minutes.
                </span>
              </label>
              <label className="flex flex-col gap-2">
                <span className="eyebrow flex items-center gap-2">
                  <Laptop size={14} aria-hidden /> Name for this laptop
                </span>
                <input style={NO_DRAG} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} className={`${field} w-72`} />
              </label>
              <div>
                <button
                  type="button"
                  style={NO_DRAG}
                  onClick={linkThisLaptop}
                  disabled={busy || !isCompleteLinkCode(code) || label.trim() === ''}
                  className={primary}
                >
                  <Cloud size={15} aria-hidden /> {working === 'link' ? 'Linking…' : 'Link this laptop'}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {settingUp ? (
                <div className="flex flex-col gap-4 rounded-md border border-line p-4">
                  <h3 className="text-sm font-bold">Create church admin for website</h3>
                  <p className="text-xs text-muted">Use the setup key you were given. It works once.</p>
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow">Setup key</span>
                    <input
                      style={NO_DRAG}
                      value={setup.setupKey}
                      onChange={(e) => setSetup({ ...setup, setupKey: formatSetupKey(e.target.value) })}
                      placeholder="ABCD-EFGH-JKLM"
                      autoComplete="off"
                      spellCheck={false}
                      className={`${field} w-64 uppercase tracking-widest`}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow">Church name</span>
                    <input
                      style={NO_DRAG}
                      value={setup.churchName}
                      onChange={(e) => setSetup({ ...setup, churchName: e.target.value })}
                      maxLength={120}
                      className={`${field} w-72`}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow">Admin username</span>
                    <input
                      style={NO_DRAG}
                      value={setup.username}
                      onChange={(e) => setSetup({ ...setup, username: e.target.value })}
                      maxLength={80}
                      autoComplete="off"
                      spellCheck={false}
                      className={`${field} w-72`}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow">Admin name</span>
                    <input
                      style={NO_DRAG}
                      value={setup.displayName}
                      onChange={(e) => setSetup({ ...setup, displayName: e.target.value })}
                      maxLength={120}
                      className={`${field} w-72`}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow flex items-center gap-2">
                      <Laptop size={14} aria-hidden /> Name for this laptop
                    </span>
                    <input
                      style={NO_DRAG}
                      value={setup.deviceLabel}
                      onChange={(e) => setSetup({ ...setup, deviceLabel: e.target.value })}
                      maxLength={80}
                      className={`${field} w-72`}
                    />
                  </label>
                  {setupTyped && setupProblem && <p className="text-xs text-muted">{setupProblem}</p>}
                  <div className="flex flex-wrap gap-3">
                    <button type="button" style={NO_DRAG} onClick={createChurch} disabled={busy || setupProblem !== null} className={primary}>
                      <Church size={15} aria-hidden /> {busy ? 'Creating…' : 'Create church and admin'}
                    </button>
                    <button type="button" style={NO_DRAG} onClick={closeSetup} disabled={busy} className={button}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button type="button" style={NO_DRAG} onClick={openSetup} disabled={busy} className={button}>
                    <Church size={15} aria-hidden /> Create church admin for website
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {view.kind === 'linked' && (
          <>
            {/* Primary action bar */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" style={NO_DRAG} onClick={syncNow} disabled={busy} className={primary}>
                <RefreshCw size={15} className={working === 'sync' ? 'animate-spin' : ''} aria-hidden /> {working === 'sync' ? 'Syncing…' : 'Sync Now'}
              </button>
              {/* Opens in the browser already in this laptop's theme, and the page keeps following it live. */}
              <button type="button" style={NO_DRAG} onClick={() => void cloud.openWebsite().catch(() => {})} className={button}>
                <ExternalLink size={14} aria-hidden /> Open Web Planner
              </button>
              <button type="button" style={NO_DRAG} onClick={() => setAddingUser(true)} disabled={busy || addingUser} className={button}>
                <UserPlus size={15} aria-hidden /> Create Web User
              </button>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted">Auto-Sync</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSync}
                  style={NO_DRAG}
                  onClick={toggleAutoSync}
                  disabled={busy}
                  title={autoSync ? 'Plans and songs sync every minute. Pause during a service on weak Wi-Fi.' : 'Paused: only Sync Now sends. Turn back on after the service.'}
                  className={`flex h-10 items-center gap-2 rounded-md border px-3 text-xs font-bold uppercase disabled:opacity-40 ${
                    autoSync ? 'border-ok/50 bg-ok/10 text-ok' : 'border-warn/60 bg-warn/10 text-warn'
                  }`}
                >
                  {autoSync ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
                  {autoSync ? 'On' : 'Paused'}
                </button>
              </div>
            </div>
            {!autoSync && (
              <p className="text-xs text-warn">Auto-Sync is paused. Nothing is sent or received until you press Sync Now or turn it back on.</p>
            )}

            {/* Failed Plans inspector */}
            {failures.length > 0 && (
              <div role="alert" className="rounded-lg border border-warn/60 bg-warn/5">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    style={NO_DRAG}
                    onClick={() => setShowFailed((v) => !v)}
                    aria-expanded={showFailed}
                    className="flex items-center gap-2 text-sm font-bold text-warn"
                  >
                    {showFailed ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                    <AlertTriangle size={15} aria-hidden />
                    {failures.length === 1 ? '1 plan could not be sent' : `${failures.length} plans could not be sent`}
                  </button>
                  <span className="text-xs text-muted">Tried again automatically on the next sync{autoSync ? '' : ' (Auto-Sync is paused)'}.</span>
                  <button type="button" style={NO_DRAG} onClick={retryFailed} disabled={busy} className={`${small} ml-auto`}>
                    <RotateCcw size={13} className={working === 'retry' ? 'animate-spin' : ''} aria-hidden /> {working === 'retry' ? 'Retrying…' : 'Retry Failed'}
                  </button>
                </div>
                {showFailed && (
                  <ul className="divide-y divide-line border-t border-warn/30">
                    {failures.map((f) => (
                      <li key={f.uuid} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold" title={f.title}>{f.title}</p>
                          <p className="text-xs text-muted">{failedPlanWhen(f)}</p>
                        </div>
                        <p className="text-sm">
                          {f.reason}
                          {f.code && <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{f.code}</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {failures.length === 0 && plans?.status === 'error' && plans.message && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {plans.message}
              </p>
            )}

            {/* Church, device and license summary */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Church">
                <span className="font-semibold">{view.churchName || 'Not known yet'}</span>
              </Fact>
              <Fact label="Linked admin">{view.adminName || '—'}</Fact>
              <Fact label="This laptop">{view.deviceLabel || '—'}</Fact>
              <Fact label="Cloud address">
                {editingAddress ? (
                  addressEditor
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={link.address || ''}>
                      {link.address || 'Not set'}
                    </span>
                    <button type="button" style={NO_DRAG} onClick={() => setEditingAddress(true)} disabled={busy} className={small} aria-label="Edit cloud address">
                      <Pencil size={12} aria-hidden /> Edit
                    </button>
                  </div>
                )}
                {linkedElsewhere && (
                  <p className="mt-1 text-xs text-warn">Linked against the address you had before. Press Sync Now to check the link.</p>
                )}
              </Fact>
              <div className="sm:col-span-2">
                <Fact label="License status">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className={`font-semibold ${license?.canProject === false ? 'text-danger' : ''}`}>{license?.statusText || 'Checking…'}</span>
                    {/* A running license can be renewed early: the new time is added to its end. */}
                    {license && license.state !== 'perpetual' && (
                      <button type="button" style={NO_DRAG} onClick={() => setRenewing(true)} className={small}>
                        Renew License
                      </button>
                    )}
                  </div>
                </Fact>
              </div>
            </div>
            {view.offline && <p className="text-xs text-muted">Showing the last known link. The cloud could not be reached just now.</p>}

            {/* Channel health */}
            <div className="grid gap-3 md:grid-cols-3">
              {cards.map((c) => {
                const Icon = c.id === 'plans' ? ListChecks : c.id === 'songs' ? Music : Palette;
                return (
                  <div key={c.id} className="flex flex-col gap-3 rounded-lg border border-line bg-panel-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-bold">
                        <Icon size={15} className="text-accent" aria-hidden /> {c.title}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${BADGE_STYLE[c.tone]}`}>{c.badge}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">{c.id === 'theme' ? themeName(themeSync?.theme) : c.count}</span>
                      <span className="text-xs text-muted">Last: {c.last}</span>
                      {c.detail && <span className="text-xs text-danger">{c.detail}</span>}
                    </div>
                    <div className="mt-auto">
                      {c.id === 'plans' && (
                        <button type="button" style={NO_DRAG} onClick={forcePush} disabled={busy} className={small}
                          title="Sends every plan on this laptop again and re-reads every plan on the website. Use after linking to another church or website.">
                          <UploadCloud size={13} aria-hidden /> {working === 'force' ? 'Pushing…' : 'Force Push Plans'}
                        </button>
                      )}
                      {c.id === 'songs' && (
                        <button type="button" style={NO_DRAG} onClick={resyncSongs} disabled={busy} className={small}>
                          <RefreshCw size={13} className={working === 'songs' ? 'animate-spin' : ''} aria-hidden /> {working === 'songs' ? 'Sending…' : 'Re-sync Songs'}
                        </button>
                      )}
                      {c.id === 'theme' && (
                        <button type="button" style={NO_DRAG} onClick={pushTheme} disabled={busy} className={small}>
                          <Palette size={13} aria-hidden /> {working === 'theme' ? 'Sending…' : 'Push Theme Now'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {addingUser && (
              <div className="flex flex-col gap-4 rounded-md border border-line p-4">
                <h3 className="text-sm font-bold">New web user</h3>
                <div className="flex flex-wrap gap-4">
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow">Username</span>
                    <input
                      style={NO_DRAG}
                      value={newUser.username}
                      onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                      maxLength={80}
                      autoComplete="off"
                      spellCheck={false}
                      className={`${field} w-60`}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow">Name</span>
                    <input
                      style={NO_DRAG}
                      value={newUser.displayName}
                      onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                      maxLength={120}
                      className={`${field} w-60`}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="eyebrow">Role</span>
                    <select
                      style={NO_DRAG}
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value as NewWebUser['role'] })}
                      className={`${field} w-40`}
                    >
                      <option value="admin">Admin</option>
                      <option value="planner">Planner</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </label>
                </div>
                {newUserTyped && newUserProblem && <p className="text-xs text-muted">{newUserProblem}</p>}
                <div className="flex flex-wrap gap-3">
                  <button type="button" style={NO_DRAG} onClick={addWebUser} disabled={busy || newUserProblem !== null} className={primary}>
                    <UserPlus size={15} aria-hidden /> {working === 'user' ? 'Creating…' : 'Create user'}
                  </button>
                  <button
                    type="button"
                    style={NO_DRAG}
                    onClick={() => {
                      setAddingUser(false);
                      setNewUser(emptyUser);
                    }}
                    disabled={busy}
                    className={button}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {created && (
              <div role="status" className="flex flex-col gap-3 rounded-md border border-accent p-4">
                <h3 className="text-sm font-bold">{created.username} has been added</h3>
                <p className="text-sm">
                  Temporary password:{' '}
                  <code className="select-all font-mono text-base font-bold tracking-widest">{created.temporaryPassword}</code>
                </p>
                <p className="text-xs text-muted">They must change this password the first time they sign in.</p>
                <p className="text-xs text-muted">Give this to the new user. It won't be shown again.</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" style={NO_DRAG} onClick={copyPassword} className={button}>
                    <Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy password'}
                  </button>
                  <button type="button" style={NO_DRAG} onClick={closeCreated} className={primary}>
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* Recent Sync Activity */}
            <div className="rounded-lg border border-line">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  style={NO_DRAG}
                  onClick={() => setShowActivity((v) => !v)}
                  aria-expanded={showActivity}
                  className="flex items-center gap-2 text-sm font-bold"
                >
                  {showActivity ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                  Sync Activity
                  <span className="text-xs font-normal text-muted">last {activity.length || 0} of 10</span>
                </button>
                <button type="button" style={NO_DRAG} onClick={copyDiagnostics} disabled={busy} className={`${small} ml-auto`}>
                  <ClipboardCopy size={13} aria-hidden /> Copy Diagnostics
                </button>
              </div>
              {showActivity && (
                <ol className="divide-y divide-line border-t border-line">
                  {activity.length === 0 && <li className="px-4 py-3 text-xs text-muted">No sync has run since the app started.</li>}
                  {activity.map((a, i) => (
                    <li key={`${a.at}-${i}`} className="grid grid-cols-[5.5rem_4.5rem_4.5rem_1fr] items-baseline gap-3 px-4 py-2 text-xs">
                      <time className="font-mono text-muted" dateTime={a.at}>
                        {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </time>
                      <span className="font-bold">{arrow(a.direction)}</span>
                      <span className="capitalize text-muted">{a.channel}</span>
                      <span className={activityTone[a.status]}>{a.summary}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Safe two-step unlink */}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <button type="button" style={NO_DRAG} onClick={refresh} disabled={busy} className={button}>
                Check link
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                {unlinkAt === 'idle' ? (
                  <button type="button" style={NO_DRAG} onClick={() => setUnlinkAt((s) => unlinkStep(s, 'request'))} disabled={busy} className={button}>
                    <Unlink size={14} aria-hidden /> Unlink This Laptop
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-danger">Stop syncing with {view.churchName || 'this church'} until linked again?</span>
                    <button type="button" style={NO_DRAG} onClick={unlink} disabled={busy} className={danger}>
                      <Unlink size={14} aria-hidden /> {unlinkAt === 'unlinking' ? 'Unlinking…' : 'Confirm Unlink'}
                    </button>
                    <button type="button" style={NO_DRAG} onClick={() => setUnlinkAt((s) => unlinkStep(s, 'cancel'))} disabled={busy} className={button}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
        {renewing && <RenewLicenseDialog onClose={() => setRenewing(false)} />}

        {createdChurch && (
          <div role="status" className="flex flex-col gap-3 rounded-md border border-accent p-4">
            <h3 className="text-sm font-bold">{createdChurch.username} is the church admin</h3>
            <p className="text-sm">
              Church code for sign-in:{' '}
              <code className="select-all font-mono text-base font-bold tracking-widest">{createdChurch.churchCode}</code>
            </p>
            <p className="text-sm">
              Temporary password:{' '}
              <code className="select-all font-mono text-base font-bold tracking-widest">{createdChurch.temporaryPassword}</code>
            </p>
            <p className="text-xs text-muted">They must change this password the first time they sign in.</p>
            <p className="text-xs text-muted">Give this to the admin. It won't be shown again.</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" style={NO_DRAG} onClick={copyChurchPassword} className={button}>
                <Copy size={15} aria-hidden /> {copiedChurch ? 'Copied' : 'Copy password'}
              </button>
              <button type="button" style={NO_DRAG} onClick={closeChurchResult} className={primary}>
                Done
              </button>
            </div>
          </div>
        )}

        {notice && !shownError && (
          <p role="status" className="text-sm text-ok">
            {notice}
          </p>
        )}
        {shownError && (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <WifiOff size={15} className="mt-0.5 shrink-0" aria-hidden />
            {shownError}
          </p>
        )}
      </Card>
    </div>
  );
}
