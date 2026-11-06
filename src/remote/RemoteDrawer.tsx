import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Cable, Check, Copy, KeyRound, Lock, Smartphone, Wifi, WifiOff, X } from 'lucide-react';
import {
  bridge,
  type RemoteClient,
  type RemoteNetworkInfo,
  type RemoteRole,
  type RemoteRoleStatus,
  type RemoteViewStatus,
} from '../live/bridge';
import { setUi, useUi } from '../state/ui';
import { qrDataUrl } from './qr';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The edge tab that opens the drawer. The outside-click check skips it, so its own click does not close and reopen the drawer. */
export const REMOTE_TAB_ID = 'remote-nav-button';

const ROLES: { role: RemoteRole; label: string; help: string }[] = [
  { role: 'primary', label: 'Primary', help: 'The phone can move to the next or previous slide, or jump to a slide.' },
  { role: 'secondary', label: 'Secondary', help: 'Read-only. The phone shows the live text and has no buttons.' },
];

const button =
  'flex h-9 shrink-0 items-center gap-2 rounded-md border border-fg/15 px-3 text-xs font-bold uppercase hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-40';
const smallButton =
  'flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-fg/15 px-2 text-[11px] font-bold uppercase hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-40';

/** The line above the address: the WiFi name, the laptop hotspot, or a plain local network for a cable or an unnamed connection. */
export function networkLabel(info: RemoteNetworkInfo | null): string {
  if (!info) return '…';
  if (info.kind === 'wifi' && info.ssid) return info.ssid;
  if (info.kind === 'hotspot') return 'Laptop hotspot';
  return 'Local Area Network';
}

/** "just now", "4 min", "2 h": how long a phone has been connected. */
function connectedFor(since: number, now: number): string {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

interface PanelProps {
  status: RemoteViewStatus;
  role: RemoteRole;
  onRole: (role: RemoteRole) => void;
  busy: boolean;
  error: string | null;
  network: RemoteNetworkInfo | null;
  onEnabled: (enabled: boolean) => void;
  onDisconnect: (ip: string) => void;
  /** Saves the viewer's PIN; null removes it. Resolves true when it was saved. */
  onPin: (pin: string | null) => Promise<boolean>;
}

/** The phones on this viewer, with a button to drop each one. Opened from the phone count. */
function ClientList({ clients, busy, onDisconnect, onClose }: { clients: RemoteClient[]; busy: boolean; onDisconnect: (ip: string) => void; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      id="remote-client-list"
      role="dialog"
      aria-label="Connected phones"
      className="absolute top-full right-0 z-10 mt-2 w-[300px] rounded-md border border-line bg-canvas p-2 shadow-xl"
    >
      {clients.length === 0 ? (
        <p className="p-2 text-xs text-muted">No phones are connected to this viewer.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {clients.map((c) => (
            <li key={c.ip} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-fg/5">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-sm font-bold text-fg">
                  {c.label}
                  <span className="font-mono text-xs font-normal text-muted">{c.ip}</span>
                </div>
                <div className="truncate text-[11px] text-muted" title={c.userAgent || undefined}>
                  {connectedFor(c.since, now)}
                  {c.tabs > 1 ? ` · ${c.tabs} tabs` : ''}
                  {c.userAgent ? ` · ${c.userAgent}` : ''}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDisconnect(c.ip)}
                aria-label={`Disconnect ${c.label} at ${c.ip}`}
                className={`${smallButton} text-danger hover:border-danger/40 hover:bg-danger/10`}
              >
                <X size={12} aria-hidden /> Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 border-t border-line px-2 pt-2 text-[11px] text-muted">
        A disconnected phone stays blocked until this viewer is turned off and on again.
      </p>
    </div>
  );
}

/** The footer's PIN control: a form to set a 4 to 8 digit PIN, or remove the one that is set, without leaving the drawer. */
function QuickPin({ pinSet, busy, onPin }: { pinSet: boolean; busy: boolean; onPin: (pin: string | null) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = /^\d{4,8}$/.test(value);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setValue('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    void onPin(value).then((saved) => saved && close());
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted">
        <KeyRound size={14} className="shrink-0" aria-hidden />
        <span className="flex-1">
          {pinSet ? 'A PIN is set. The phone asks for it after scanning.' : 'No PIN. Anyone on this WiFi with the address can open it.'}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="remote-quick-pin"
          disabled={busy}
          onClick={() => (open ? close() : setOpen(true))}
          className={`${smallButton} ${pinSet ? 'border-accent/50 text-accent' : ''}`}
        >
          <Lock size={12} aria-hidden /> Quick PIN
        </button>
      </div>
      {open && (
        <form id="remote-quick-pin" onSubmit={submit} className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3">
          <label htmlFor="remote-quick-pin-input" className="text-xs font-bold text-fg">
            {pinSet ? 'New PIN' : 'PIN'} <span className="font-normal text-muted">(4 to 8 digits)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="remote-quick-pin-input"
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              placeholder="••••"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Escape' && close()}
              className="h-9 w-28 rounded-md border border-fg/15 bg-panel-2 px-3 font-mono text-sm tracking-[0.3em] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            />
            <button type="submit" disabled={busy || !valid} className={smallButton}>
              Save
            </button>
            {pinSet && (
              <button type="button" disabled={busy} onClick={() => void onPin(null).then((saved) => saved && close())} className={`${smallButton} text-danger`}>
                Remove PIN
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted">Saving restarts this viewer. Connected phones reconnect and ask for the new PIN.</p>
        </form>
      )}
    </div>
  );
}

/**
 * The drawer's body: the viewer tabs, the on/off switch and phone count (which opens the phone list), the QR code with the network name and
 * address, and at the bottom the PIN control and any port problem. The port is changed in Settings > Remote view.
 */
export function RemoteQrPanel({ status, role, onRole, busy, error, network, onEnabled, onDisconnect, onPin }: PanelProps) {
  const viewer: RemoteRoleStatus = status[role];
  const url = viewer.running ? viewer.url : null;
  const qr = useMemo(() => (url ? qrDataUrl(url, 8) : null), [url]);
  const [copied, setCopied] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const closeList = useCallback(() => setListOpen(false), []);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  // The list belongs to one viewer; switching viewers closes it.
  useEffect(() => setListOpen(false), [role]);

  const copy = () => {
    if (!url) return;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  const NetworkIcon = network?.kind === 'wired' ? Cable : Wifi;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div role="radiogroup" aria-label="Viewer" className="grid grid-cols-2 gap-1 rounded-md border border-line p-1">
        {ROLES.map((r) => (
          <button
            key={r.role}
            type="button"
            role="radio"
            aria-checked={role === r.role}
            onClick={() => onRole(r.role)}
            className={`h-8 rounded text-xs font-bold uppercase transition ${role === r.role ? 'bg-accent text-canvas' : 'text-fg/70 hover:bg-fg/10'}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-xs text-muted">{ROLES.find((r) => r.role === role)!.help}</p>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={viewer.enabled}
          aria-label="Remote on local WiFi"
          disabled={busy}
          onClick={() => onEnabled(!viewer.enabled)}
          className={`${button} ${viewer.enabled ? 'border-accent bg-accent/20 text-accent' : ''}`}
        >
          {viewer.enabled ? 'Remote ON' : 'Remote OFF'}
        </button>
        <div className="relative">
          <button
            type="button"
            aria-expanded={listOpen}
            aria-controls="remote-client-list"
            onClick={() => setListOpen((v) => !v)}
            className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${listOpen ? 'border-fg/30 bg-fg/10' : 'border-transparent'}`}
          >
            <Smartphone size={15} aria-hidden />
            {viewer.devices === 1 ? '1 phone' : `${viewer.devices} phones`}
          </button>
          {listOpen && <ClientList clients={viewer.clients} busy={busy} onDisconnect={onDisconnect} onClose={closeList} />}
        </div>
      </div>

      {url && qr ? (
        <div className="flex flex-col items-center gap-3">
          <img src={qr} alt={`QR code for the remote at ${url}`} className="size-64 rounded-md bg-white p-2" />
          <p className="text-center text-xs text-muted">Scan with a phone camera on the same WiFi, or open this address in its browser.</p>
          <div className="flex w-full items-center gap-2 text-xs text-muted" aria-live="polite">
            <NetworkIcon size={14} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              Network: <span className="font-bold text-fg">{networkLabel(network)}</span>
            </span>
          </div>
          <div className="-mt-1 flex w-full items-center gap-2">
            <code aria-label="Remote address" className="min-w-0 flex-1 truncate rounded-md border border-fg/15 bg-panel-2 px-3 py-2 font-mono text-sm font-bold">
              {url}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-live="polite"
              className={`${button} w-[118px] justify-center transition ${copied ? 'border-ok/50 bg-ok/20 text-ok' : ''}`}
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>
      ) : (
        !viewer.error && (
          <p className="rounded-md border border-line bg-canvas p-4 text-center text-sm text-muted">
            {viewer.enabled ? 'Starting…' : 'Turn the remote on to show its QR code.'}
          </p>
        )
      )}

      {/* PIN and port notes sit at the bottom, under the code. */}
      <div className="mt-auto flex flex-col gap-2">
        {(error || viewer.error) && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/40 bg-canvas p-3 text-sm text-danger">
            <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden />
            {error ?? viewer.error}
          </div>
        )}
        <QuickPin pinSet={viewer.pinSet} busy={busy} onPin={onPin} />
        <div className="text-xs text-muted">Port {viewer.port}. Change the port in Settings &gt; Remote view.</div>
      </div>
    </div>
  );
}

/** The header badge: "● Connected (N)" with phones on either viewer, "○ Listening (0)" while one runs with none, "○ Offline" when neither runs. */
export function badgeState(status: RemoteViewStatus | null): { tone: 'connected' | 'listening' | 'offline'; text: string } {
  const running = !!status && (status.primary.running || status.secondary.running);
  if (!running) return { tone: 'offline', text: '○ Offline' };
  if (status.devices > 0) return { tone: 'connected', text: `● Connected (${status.devices})` };
  return { tone: 'listening', text: '○ Listening (0)' };
}

function StatusBadge({ status }: { status: RemoteViewStatus | null }) {
  const { tone, text } = badgeState(status);
  const color = tone === 'connected' ? 'bg-ok/20 text-ok' : tone === 'listening' ? 'bg-fg/10 text-fg/70' : 'bg-fg/5 text-fg/45';
  return (
    <span aria-live="polite" className={`rounded-full px-2 py-0.5 font-mono text-xs font-bold tabular-nums ${color}`}>
      {text}
    </span>
  );
}

/**
 * The right-side Remote Control drawer. It is mounted only while open, so the status polling (every 2 seconds, for the phone count and list)
 * and the QR drawing stop when it closes. A mousedown outside it closes it, except on its own edge tab.
 */
export function RemoteDrawer() {
  const open = useUi((s) => s.remoteOpen);
  if (!open) return null;
  return <OpenRemoteDrawer />;
}

function OpenRemoteDrawer() {
  const drawerRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<RemoteViewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<RemoteRole>('primary');
  const [network, setNetwork] = useState<RemoteNetworkInfo | null>(null);
  const close = () => setUi({ remoteOpen: false });
  const url = status?.[role].url ?? null;

  useEffect(() => {
    let alive = true;
    const load = () =>
      bridge.remoteView
        .get()
        .then((next) => {
          if (!alive) return;
          setStatus(next);
          setError(null);
        })
        .catch((err) => alive && setError(errorText(err)));
    void load();
    const timer = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // The WiFi name is read from the system, so it is asked for once per viewer and address rather than on every poll.
  useEffect(() => {
    if (!url) return;
    let alive = true;
    bridge.remoteView
      .getNetworkInfo(role)
      .then((info) => alive && setNetwork(info))
      .catch(() => alive && setNetwork({ kind: 'none', ssid: null, ip: null, port: null }));
    return () => {
      alive = false;
    };
  }, [role, url]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (drawerRef.current?.contains(target)) return;
      if (document.getElementById(REMOTE_TAB_ID)?.contains(target)) return;
      setUi({ remoteOpen: false });
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  /** Runs one change that returns the new status. Resolves true when it worked; a failure is shown in the drawer. */
  const change = (run: () => Promise<RemoteViewStatus>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    return run()
      .then((next) => {
        setStatus(next);
        return true;
      })
      .catch((err) => {
        setError(errorText(err));
        return false;
      })
      .finally(() => setBusy(false));
  };

  const setEnabled = (enabled: boolean) => void change(() => bridge.remoteView.save({ role, enabled }));
  const disconnect = (ip: string) => void change(() => bridge.remoteView.disconnect(role, ip));
  const savePin = (pin: string | null) => change(() => bridge.remoteView.save({ role, pin }));

  // Same placement as before: below the top bar (--topbar-h is its measured height), on the canvas colour so see-through themes don't show
  // the page through it. The backdrop only dims; clicks pass through to the outside-click listener.
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 top-[var(--topbar-h)] z-30 bg-black/50" aria-hidden />
      <aside
        ref={drawerRef}
        aria-labelledby="remote-drawer-title"
        className="fixed top-[var(--topbar-h)] right-0 z-40 flex h-[calc(100vh-var(--topbar-h))] w-[380px] flex-col border-l border-line bg-canvas shadow-2xl"
      >
        <div className="flex min-h-0 flex-1 flex-col bg-panel">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2.5">
              <h2 id="remote-drawer-title" className="text-base font-bold tracking-tight text-fg">
                Remote Control
              </h2>
              <StatusBadge status={status} />
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close remote control"
              className="grid size-8 place-items-center rounded-md border border-line text-fg/60 transition hover:border-fg/30 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <X size={16} aria-hidden />
            </button>
          </header>
          {status ? (
            <RemoteQrPanel
              status={status}
              role={role}
              onRole={setRole}
              busy={busy}
              error={error}
              network={network}
              onEnabled={setEnabled}
              onDisconnect={disconnect}
              onPin={savePin}
            />
          ) : (
            <p className="p-4 text-sm text-muted">{error ?? 'Loading Remote view…'}</p>
          )}
        </div>
      </aside>
    </>
  );
}
