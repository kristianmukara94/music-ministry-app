import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Copy, ExternalLink, Eye, EyeOff, KeyRound, Shuffle, Smartphone, Tv, WifiOff, X } from 'lucide-react';
import { qrDataUrl } from '../remote/qr';
import { NO_DRAG } from '../components/appRegion';
import { TvCastSettings } from './TvCastSettings';
import {
  bridge,
  type RemoteLanCheck,
  type RemoteRole,
  type RemoteRoleStatus,
  type RemoteViewPatch,
  type RemoteViewStatus,
} from '../live/bridge';
import { adapterLabel, allClients, generatePin, portProblem, qrTargetBadge } from '../../shared/remote-view-ui.js';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Must match shared/remote-view.js.
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const PIN_PATTERN = /^\d{4,8}$/;

const button =
  'flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const smallButton =
  'flex h-8 items-center gap-1.5 rounded-md border border-fg/15 px-2.5 text-[11px] font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const field = 'h-10 rounded-md border border-fg/15 bg-panel-2 px-3 font-mono text-sm outline-none focus:border-accent';

/** A random 4-digit PIN from the system's secure random source. */
const randomPin = () => generatePin((max) => crypto.getRandomValues(new Uint32Array(1))[0] % max);

const ROLE_TEXT: Record<RemoteRole, { title: string; help: string }> = {
  primary: {
    title: 'Primary viewer',
    help: 'For the person running the service. Shows the current and next slide large, and lets a phone move to the next or previous slide, or jump to a slide. The same phone can also switch the Welcome Screen and Blackout on and off. The slide buttons stop while the projector is paused; Blackout and Welcome Screen keep working, as they do on the top bar.',
  },
  secondary: {
    title: 'Secondary viewer',
    help: 'Read-only. Shows the current slide text, the item title, and the next item title. It has no buttons and cannot change the screen.',
  },
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="mb-4 border-b border-line pb-2 text-xl font-bold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={NO_DRAG}
      className="flex shrink-0 items-center disabled:opacity-40"
    >
      <span className={`relative h-6 w-11 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-fg/15 bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-fg transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} aria-hidden />
      </span>
    </button>
  );
}

/** "just now", "4 min", "2 h": how long a device has been connected. */
function connectedFor(since: number, now: number): string {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

function ServerPill({ name, status }: { name: string; status: RemoteRoleStatus }) {
  const state = status.running ? 'Listening' : status.enabled ? 'Not running' : 'Off';
  const tone = status.running
    ? 'border-ok/50 bg-ok/15 text-ok'
    : status.enabled
      ? 'border-danger/40 bg-danger/10 text-danger'
      : 'border-fg/15 bg-panel-2 text-muted';
  return (
    <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      <span className={`size-2 rounded-full ${status.running ? 'bg-ok' : 'border border-current'}`} aria-hidden />
      {name} :{status.port} {state}
    </span>
  );
}

interface HubProps {
  status: RemoteViewStatus;
  busy: boolean;
  error: string | null;
  warnHotspot: boolean;
  onChange: (next: RemoteViewStatus) => void;
  onError: (message: string | null) => void;
  onAdapter: (name: string | null) => void;
}

/** The top card: how many devices are connected, which viewers listen, which network adapter they use, and who is connected. */
function ConnectionsHub({ status, busy, error, warnHotspot, onChange, onError, onAdapter }: HubProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const clients = allClients(status);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const run = (job: Promise<RemoteViewStatus>) => {
    onError(null);
    job.then(onChange).catch((err) => onError(errorText(err)));
  };
  const automatic = status.adapters.find((a) => a.kind !== 'virtual');

  return (
    <Card title="Connections & Devices">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Smartphone size={16} aria-hidden />
          {status.devices} of {status.deviceLimit} devices connected
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ServerPill name="Primary" status={status.primary} />
          <ServerPill name="Secondary" status={status.secondary} />
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="flex min-w-60 flex-1 flex-col gap-2">
          <span className="eyebrow">Network Adapter / Wi-Fi IP</span>
          <select
            value={status.adapter ?? ''}
            disabled={busy || status.adapters.length === 0}
            onChange={(e) => onAdapter(e.target.value === '' ? null : e.target.value)}
            style={NO_DRAG}
            className={`${field} w-full`}
          >
            <option value="">{automatic ? `Automatic (${automatic.name} · ${automatic.address})` : 'Automatic'}</option>
            {status.adapters.map((a) => (
              <option key={a.name} value={a.name}>
                {adapterLabel(a)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            {status.address ? `Phones use ${status.address}. ` : 'No network found. '}Changing this restarts both viewers, so the addresses and QR
            codes update.
          </span>
        </label>
        <button
          type="button"
          style={NO_DRAG}
          disabled={busy || status.devices === 0}
          onClick={() => run(bridge.remoteView.disconnectAll())}
          className={`${button} text-danger hover:border-danger/40 hover:bg-danger/10`}
        >
          <X size={14} aria-hidden /> Disconnect All
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          style={NO_DRAG}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-fit items-center gap-1.5 text-sm font-semibold hover:text-accent"
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />} Connected Devices ({clients.length})
        </button>
        {open &&
          (clients.length === 0 ? (
            <p className="text-sm text-muted">No devices are connected.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
              {clients.map((c) => (
                <li key={`${c.viewer}-${c.ip}`} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-baseline gap-2 text-sm font-bold">
                      {c.label}
                      <span className="font-mono text-xs font-normal text-muted">{c.ip}</span>
                    </div>
                    <div className="text-[11px] text-muted">
                      Connected {connectedFor(c.since, now)}
                      {c.tabs > 1 ? ` · ${c.tabs} tabs` : ''}
                    </div>
                  </div>
                  <span className="rounded-full border border-fg/15 px-2 py-0.5 text-[11px] font-bold uppercase">{c.roleLabel}</span>
                  <button
                    type="button"
                    style={NO_DRAG}
                    disabled={busy}
                    onClick={() => run(bridge.remoteView.disconnect(c.viewer, c.ip))}
                    aria-label={`Disconnect ${c.label} at ${c.ip}`}
                    className={`${smallButton} text-danger hover:border-danger/40 hover:bg-danger/10`}
                  >
                    <X size={12} aria-hidden /> Disconnect
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {open && clients.length > 0 && <p className="text-xs text-muted">A disconnected device stays blocked until its viewer is turned off and on again.</p>}
      </div>

      {warnHotspot && (
        <div role="alert" className="rounded-md border border-danger/40 bg-canvas p-3 text-sm text-danger">
          This laptop is sharing its own WiFi (a hotspot). With more than {status.hotspotWarnAbove} devices, the connection can drop. Ask some to
          disconnect, or use a WiFi router.
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

interface ViewerProps {
  role: RemoteRole;
  status: RemoteRoleStatus;
  busy: boolean;
  /** The other viewer's saved port and name, so the same port cannot be saved on both. */
  otherPort: number;
  otherName: string;
  onSave: (patch: Omit<RemoteViewPatch, 'role'>, done?: () => void) => void;
}

/** One viewer: its toggle, its address, its devices, its port, and its PIN. */
function ViewerCard({ role, status, busy, otherPort, otherName, onSave }: ViewerProps) {
  const [portDraft, setPortDraft] = useState(String(status.port));
  const [pinDraft, setPinDraft] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tvCopied, setTvCopied] = useState(false);
  const [qrOpensTv, setQrOpensTv] = useState(true);
  const [opening, setOpening] = useState(false);
  // The TV page is the same address with /tv on the end, so it follows the laptop's IP and port as they change.
  const tvUrl = status.url && role === 'secondary' ? new URL('/tv', status.url).toString() : null;
  const qrTarget = qrOpensTv && tvUrl ? tvUrl : status.url;
  const qr = useMemo(() => (qrTarget ? qrDataUrl(qrTarget) : null), [qrTarget]);

  useEffect(() => {
    setPortDraft(String(status.port));
  }, [status.port]);

  const portNumber = Number(portDraft);
  const portError = portProblem(portDraft, otherPort, otherName, PORT_MIN, PORT_MAX);
  const portValid = portError === null;
  const pinValid = PIN_PATTERN.test(pinDraft);
  const text = ROLE_TEXT[role];

  const copyTo = (value: string, flag: (on: boolean) => void) => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        flag(true);
        window.setTimeout(() => flag(false), 2000);
      })
      .catch(() => undefined);
  };
  const copy = () => {
    if (status.url) copyTo(status.url, setCopied);
  };
  const copyTv = () => {
    if (tvUrl) copyTo(tvUrl, setTvCopied);
  };
  const openInBrowser = (tv: boolean) => {
    setOpening(true);
    bridge.remoteView
      .open(role, tv)
      .catch(() => undefined)
      .finally(() => setOpening(false));
  };

  return (
    <Card title={text.title}>
      <p className="text-sm text-muted">{text.help}</p>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">{text.title} on local WiFi</div>
          <div className="text-xs text-muted">{status.enabled ? 'On' : 'Off'}</div>
        </div>
        <Switch label={`${text.title} on local WiFi`} on={status.enabled} disabled={busy} onChange={(on) => onSave({ enabled: on })} />
      </div>

      {status.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/40 bg-canvas p-3 text-sm text-danger">
          <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden />
          {status.error}
        </div>
      )}

      {status.running && status.url && qr && qrTarget && (
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex flex-col items-center gap-2">
            <img src={qr} alt={`QR code for ${text.title} at ${qrTarget}`} className="size-40 rounded-md bg-white p-2" />
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-accent uppercase">
              {qrTargetBadge(role, qrOpensTv && tvUrl !== null)}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-3">
            <p className="text-xs text-muted">Open this address in a phone's browser on the same WiFi, or scan the code with the camera.</p>
            <code aria-label={`${text.title} address`} className="block break-all rounded-md border border-fg/15 bg-panel-2 px-3 py-2 font-mono text-lg font-bold">
              {status.url}
            </code>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={copy} style={NO_DRAG} className={button}>
                <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy address'}
              </button>
              <button type="button" onClick={() => openInBrowser(false)} disabled={opening} style={NO_DRAG} className={button}>
                <ExternalLink size={14} aria-hidden /> Open
              </button>
              <span className="flex items-center gap-2 text-sm">
                <Smartphone size={15} aria-hidden /> {status.devices === 1 ? '1 device connected' : `${status.devices} devices connected`}
              </span>
            </div>
            {tvUrl && (
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                <span className="eyebrow">TV address</span>
                <code aria-label="TV address" className="block break-all rounded-md border border-fg/15 bg-panel-2 px-3 py-2 font-mono text-lg font-bold">
                  {tvUrl}
                </code>
                <p className="text-xs text-muted">
                  Open this address on a Smart TV or large screen browser connected to the same Wi-Fi to render the 16:9 Remote View.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={copyTv} style={NO_DRAG} className={button}>
                    <Tv size={14} aria-hidden /> {tvCopied ? 'Copied!' : 'Copy TV address'}
                  </button>
                  <button type="button" onClick={() => openInBrowser(true)} disabled={opening} style={NO_DRAG} className={button}>
                    <ExternalLink size={14} aria-hidden /> Open
                  </button>
                  <Switch label="QR code opens the TV page" on={qrOpensTv} disabled={false} onChange={setQrOpensTv} />
                  <span className="text-sm">{qrOpensTv ? 'QR code opens the TV page' : 'QR code opens the phone page'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="eyebrow">Port</span>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            inputMode="numeric"
            min={PORT_MIN}
            max={PORT_MAX}
            value={portDraft}
            onChange={(e) => setPortDraft(e.target.value)}
            aria-label={`${text.title} port`}
            aria-invalid={!portValid}
            style={NO_DRAG}
            className={`${field} w-32 ${portValid ? '' : 'border-danger'}`}
          />
          <button
            type="button"
            style={NO_DRAG}
            onClick={() => onSave({ port: portNumber })}
            disabled={busy || !portValid || portNumber === status.port}
            className={button}
          >
            Save port
          </button>
        </div>
        {!portValid && (
          <p role="alert" className="text-xs text-danger">
            {portError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="eyebrow">PIN (optional)</span>
        <div className="flex items-center gap-2 text-sm">
          <KeyRound size={15} aria-hidden />
          {status.pinSet ? 'A PIN is set.' : 'No PIN. Anyone on this WiFi who has the address can open this page.'}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            maxLength={8}
            autoComplete="off"
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))}
            aria-label={`${text.title} new PIN`}
            placeholder="4 to 8 digits"
            style={NO_DRAG}
            className={`${field} w-40`}
          />
          <button
            type="button"
            style={NO_DRAG}
            onClick={() => {
              setPinDraft(randomPin());
              setShowPin(true);
            }}
            disabled={busy}
            className={button}
          >
            <Shuffle size={14} aria-hidden /> Generate PIN
          </button>
          {(status.pinSet || pinDraft !== '') && (
            <button
              type="button"
              style={NO_DRAG}
              onClick={() => setShowPin((on) => !on)}
              aria-pressed={showPin}
              aria-label={showPin ? `Hide ${text.title} PIN` : `Show ${text.title} PIN`}
              className={button}
            >
              {showPin ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {showPin ? 'Hide' : 'Show'}
            </button>
          )}
          <button type="button" style={NO_DRAG} onClick={() => onSave({ pin: pinDraft }, () => setPinDraft(''))} disabled={busy || !pinValid} className={button}>
            {status.pinSet ? 'Change PIN' : 'Set PIN'}
          </button>
          {(status.pinSet || pinDraft !== '') && (
            <button
              type="button"
              style={NO_DRAG}
              onClick={() => {
                setPinDraft('');
                setShowPin(false);
                if (status.pinSet) onSave({ pin: null });
              }}
              disabled={busy}
              className={button}
            >
              Clear PIN
            </button>
          )}
        </div>
        <p className="text-xs text-muted">A saved PIN is never shown again. Generate one, note it down, then press Set PIN.</p>
      </div>
    </Card>
  );
}

/** Check LAN & Firewall: probes the running viewers on the selected address and explains what it found. */
function LanCheck() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RemoteLanCheck | null>(null);
  const check = () => {
    setChecking(true);
    bridge.remoteView
      .checkLan()
      .then(setResult)
      .catch((err) => setResult({ ip: null, level: 'bad', text: errorText(err) }))
      .finally(() => setChecking(false));
  };
  const tone = result?.level === 'ok' ? 'border-ok/40 text-ok' : result?.level === 'warn' ? 'border-fg/25 text-fg' : 'border-danger/40 text-danger';
  return (
    <div className="flex flex-col gap-3">
      <div>
        <button type="button" style={NO_DRAG} onClick={check} disabled={checking} className={button}>
          <WifiOff size={14} aria-hidden /> {checking ? 'Checking…' : 'Check LAN & Firewall'}
        </button>
      </div>
      {result && (
        <p role="status" className={`rounded-md border bg-canvas p-3 text-sm ${tone}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}

/**
 * Remote view: two viewers on the local WiFi. Primary controls the slide from a phone, Secondary only watches. Each has its own port,
 * switch and PIN. The status is read every 2 seconds, so the device counts stay current.
 */
export function RemoteViewSettings() {
  const [status, setStatus] = useState<RemoteViewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      bridge.remoteView
        .get()
        .then((next) => alive && setStatus(next))
        .catch((err) => alive && setError(errorText(err)));
    void load();
    const timer = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const save = (patch: RemoteViewPatch, done?: () => void) => {
    setBusy(true);
    setError(null);
    bridge.remoteView
      .save(patch)
      .then((next) => {
        setStatus(next);
        done?.();
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const setAdapter = (name: string | null) => {
    setBusy(true);
    setError(null);
    bridge.remoteView
      .setAdapter(name)
      .then(setStatus)
      .catch((err) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  if (!status) return <div className="p-6 text-sm text-muted">{error ?? 'Loading Remote view…'}</div>;

  const warnHotspot = status.hotspot && status.devices > status.hotspotWarnAbove;

  return (
    <div className="flex flex-col gap-6">
      <ConnectionsHub status={status} busy={busy} error={error} warnHotspot={warnHotspot} onChange={setStatus} onError={setError} onAdapter={setAdapter} />

      <div className="grid grid-cols-1 items-start gap-6 min-[1100px]:grid-cols-2">
        <ViewerCard
          role="primary"
          status={status.primary}
          busy={busy}
          otherPort={status.secondary.port}
          otherName="Secondary"
          onSave={(patch, done) => save({ role: 'primary', ...patch }, done)}
        />
        <ViewerCard
          role="secondary"
          status={status.secondary}
          busy={busy}
          otherPort={status.primary.port}
          otherName="Primary"
          onSave={(patch, done) => save({ role: 'secondary', ...patch }, done)}
        />
      </div>

      <TvCastSettings />

      <Card title="Who can see it">
        <LanCheck />
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
          <li>Anyone on this WiFi who has a viewer's address can open it, unless that viewer has a PIN.</li>
          <li>Each viewer is served only on this laptop's local network address. Nothing is sent to the internet.</li>
          <li>Only the Primary viewer can change the slide (and only while the projector is not paused), or switch the Welcome Screen or Blackout on or off. The Secondary viewer has no controls.</li>
          <li>Only the live text, the item titles, and the next item are shared. The rest of the app is not.</li>
          <li>PINs are saved on this laptop in plain text. They stop casual viewing, not someone who can open the laptop's files.</li>
        </ul>
      </Card>
    </div>
  );
}
