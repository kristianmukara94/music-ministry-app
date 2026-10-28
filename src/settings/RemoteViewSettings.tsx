import { useEffect, useMemo, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { Copy, KeyRound, Smartphone, Tv, WifiOff } from 'lucide-react';
import { bridge, type RemoteActivity, type RemoteRole, type RemoteRoleStatus, type RemoteViewPatch, type RemoteViewStatus } from '../live/bridge';
import { formatDayAndClock } from '../state/region';
import { useRegion } from '../state/useRegion';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Must match shared/remote-view.js.
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const PIN_PATTERN = /^\d{4,8}$/;

const button =
  'flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';
const field = 'h-10 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm outline-none focus:border-accent';

const ROLE_TEXT: Record<RemoteRole, { title: string; help: string }> = {
  primary: {
    title: 'Primary viewer',
    help: 'For the person running the service. Shows the current and next slide large, and lets a phone move to the next or previous slide, or jump to a slide. The buttons stop while the projector is paused.',
  },
  secondary: {
    title: 'Secondary viewer',
    help: 'Read-only. Shows the current slide text, the item title, and the next item title. It has no buttons and cannot change the screen.',
  },
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5 backdrop-blur-md">
      <h2 className="mb-4 border-b border-line pb-2 text-xl font-black uppercase condensed">{title}</h2>
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
      className="flex shrink-0 items-center disabled:opacity-40"
    >
      <span className={`relative h-6 w-11 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-line-strong bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-fg transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} aria-hidden />
      </span>
    </button>
  );
}

/** The address as a QR code. It is drawn here in the app, so it needs no internet. */
function qrDataUrl(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 4);
}

interface ViewerProps {
  role: RemoteRole;
  status: RemoteRoleStatus;
  busy: boolean;
  onSave: (patch: Omit<RemoteViewPatch, 'role'>, done?: () => void) => void;
}

/** One viewer: its toggle, its address, its phones, its port, and its PIN. */
function ViewerCard({ role, status, busy, onSave }: ViewerProps) {
  const [portDraft, setPortDraft] = useState(String(status.port));
  const [pinDraft, setPinDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [tvCopied, setTvCopied] = useState(false);
  const [qrOpensTv, setQrOpensTv] = useState(true);
  // The TV page is the same address with /tv on the end, so it follows the laptop's IP and port as they change.
  const tvUrl = status.url && role === 'secondary' ? new URL('/tv', status.url).toString() : null;
  const qrTarget = qrOpensTv && tvUrl ? tvUrl : status.url;
  const qr = useMemo(() => (qrTarget ? qrDataUrl(qrTarget) : null), [qrTarget]);

  useEffect(() => {
    setPortDraft(String(status.port));
  }, [status.port]);

  const portNumber = Number(portDraft);
  const portValid = Number.isInteger(portNumber) && portNumber >= PORT_MIN && portNumber <= PORT_MAX;
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
        <div className="flex flex-wrap items-center gap-6">
          <img src={qr} alt={`QR code for ${text.title} at ${qrTarget}`} className="size-40 rounded-md bg-white p-2" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-xs text-muted">Open this address in a phone's browser on the same WiFi, or scan the code with the camera.</p>
            <code aria-label={`${text.title} address`} className="block break-all rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-lg font-bold">
              {status.url}
            </code>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={copy} className={button}>
                <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy address'}
              </button>
              <span className="flex items-center gap-2 text-sm">
                <Smartphone size={15} aria-hidden /> {status.devices === 1 ? '1 phone connected' : `${status.devices} phones connected`}
              </span>
            </div>
            {tvUrl && (
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                <span className="eyebrow">TV address</span>
                <code aria-label="TV address" className="block break-all rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-lg font-bold">
                  {tvUrl}
                </code>
                <p className="text-xs text-muted">
                  Open this address on a Smart TV or large screen browser connected to the same Wi-Fi to render the 16:9 Remote View.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={copyTv} className={button}>
                    <Tv size={14} aria-hidden /> {tvCopied ? 'Copied!' : 'Copy TV address'}
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
            className={`${field} w-32`}
          />
          <button
            type="button"
            onClick={() => onSave({ port: portNumber })}
            disabled={busy || !portValid || portNumber === status.port}
            className={button}
          >
            Save port
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="eyebrow">PIN (optional)</span>
        <div className="flex items-center gap-2 text-sm">
          <KeyRound size={15} aria-hidden />
          {status.pinSet ? 'A PIN is set.' : 'No PIN. Anyone on this WiFi who has the address can open this page.'}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            inputMode="numeric"
            maxLength={8}
            autoComplete="off"
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))}
            aria-label={`${text.title} new PIN`}
            placeholder="4 to 8 digits"
            className={`${field} w-40`}
          />
          <button type="button" onClick={() => onSave({ pin: pinDraft }, () => setPinDraft(''))} disabled={busy || !pinValid} className={button}>
            {status.pinSet ? 'Change PIN' : 'Set PIN'}
          </button>
          {status.pinSet && (
            <button type="button" onClick={() => onSave({ pin: null })} disabled={busy} className={button}>
              Remove PIN
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** One control action from a phone, with the device and the time. A refused action says why. */
function ActivityRow({ entry }: { entry: RemoteActivity }) {
  const region = useRegion();
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 text-sm last:border-b-0">
      <span className="font-semibold">{entry.action}</span>
      <span className="text-xs text-muted">{entry.device}</span>
      <span className="font-mono text-xs text-muted">{formatDayAndClock(new Date(entry.at), region, { seconds: true })}</span>
      {!entry.ok && <span className="w-full text-xs text-danger">Not done: {entry.error}</span>}
    </li>
  );
}

/**
 * Remote view: two phone viewers on the local WiFi. Primary controls the slide from a phone, Secondary only watches. Each
 * has its own port, switch and PIN. The status is read every 2 seconds, so the device counts and the activity list stay current.
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

  if (!status) return <div className="p-6 text-sm text-muted">{error ?? 'Loading Remote view…'}</div>;

  const warnHotspot = status.hotspot && status.devices > status.hotspotWarnAbove;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Phones connected">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Smartphone size={15} aria-hidden />
          <span>
            {status.devices} of {status.deviceLimit} phones connected, across both viewers.
          </span>
        </div>
        {warnHotspot && (
          <div role="alert" className="rounded-md border border-danger/40 bg-canvas p-3 text-sm text-danger">
            This laptop is sharing its own WiFi (a hotspot). With more than {status.hotspotWarnAbove} phones, the connection can drop. Ask
            some to disconnect, or use a WiFi router.
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Card>

      <ViewerCard role="primary" status={status.primary} busy={busy} onSave={(patch, done) => save({ role: 'primary', ...patch }, done)} />
      <ViewerCard role="secondary" status={status.secondary} busy={busy} onSave={(patch, done) => save({ role: 'secondary', ...patch }, done)} />

      <Card title="Control activity">
        {status.activity.length === 0 ? (
          <p className="text-sm text-muted">No changes from phones yet. Next and previous slide, and jumps, are listed here with the device and time.</p>
        ) : (
          <ul className="flex flex-col">
            {status.activity.map((entry, i) => (
              <ActivityRow key={`${entry.at}-${i}`} entry={entry} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Who can see it">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
          <li>Anyone on this WiFi who has a viewer's address can open it, unless that viewer has a PIN.</li>
          <li>Each viewer is served only on this laptop's local network address. Nothing is sent to the internet.</li>
          <li>Only the Primary viewer can change the slide, and only while the projector is not paused. The Secondary viewer has no controls.</li>
          <li>Only the live text, the item titles, and the next item are shared. The rest of the app is not.</li>
          <li>PINs are saved on this laptop in plain text. They stop casual viewing, not someone who can open the laptop's files.</li>
        </ul>
      </Card>
    </div>
  );
}
