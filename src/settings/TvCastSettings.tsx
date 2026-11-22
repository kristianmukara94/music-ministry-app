import { useEffect, useState, type ReactNode } from 'react';
import { Cast, Loader2, MonitorSmartphone, Plus, Radar, Square, Tv } from 'lucide-react';
import { bridge, type TvCastReply, type TvCastStatus, type TvCastTv } from '../live/bridge';
import { NO_DRAG } from '../components/appRegion';
import { FEED_OPTIONS, castButtonLabel, castControls, isCasting, protocolBadge, statePill, tvSubtitle } from '../../shared/tv-cast-view.js';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const button =
  'flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const field = 'h-10 rounded-md border border-fg/15 bg-panel-2 px-3 font-mono text-sm outline-none focus:border-accent';

const PILL_TONE = {
  ok: 'border-ok/50 bg-ok/15 text-ok',
  warn: 'border-warn/50 bg-warn/15 text-warn',
  danger: 'border-danger/50 bg-danger/10 text-danger',
  idle: 'border-fg/15 bg-panel-2 text-muted',
} as const;

function TvCard({ tv, busy, onCast, onDisconnect, onFeed }: { tv: TvCastTv; busy: boolean; onCast: () => void; onDisconnect: () => void; onFeed: (feed: 'projector' | 'stage') => void }) {
  const pill = statePill(tv);
  const casting = isCasting(tv);
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-panel-2 p-4" style={NO_DRAG} data-testid="tv-card">
      <Tv size={22} className="shrink-0 text-muted" aria-hidden />
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">{tv.name}</span>
          <span className="rounded-full border border-fg/15 px-2 py-0.5 text-[11px] font-semibold text-muted">{protocolBadge(tv)}</span>
        </div>
        <span className="text-xs text-muted">{tvSubtitle(tv)}</span>
      </div>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted uppercase">
        Feed
        <select
          value={tv.feed}
          onChange={(e) => onFeed(e.target.value as 'projector' | 'stage')}
          disabled={busy}
          aria-label={`${tv.name} feed`}
          style={NO_DRAG}
          className={`${field} w-40 font-sans text-xs font-semibold normal-case`}
        >
          {FEED_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <span role="status" className={`max-w-64 rounded-full border px-3 py-1 text-xs font-semibold ${PILL_TONE[pill.tone]}`}>
        {pill.text}
      </span>
      <button type="button" onClick={casting ? onDisconnect : onCast} disabled={busy} aria-label={`${castButtonLabel(tv)} ${tv.name}`} style={NO_DRAG} className={button}>
        {casting ? <Square size={14} aria-hidden /> : <Cast size={14} aria-hidden />} {castButtonLabel(tv)}
      </button>
    </li>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="mb-1 text-xl font-bold tracking-tight">{title}</h2>
      <p className="mb-4 border-b border-line pb-3 text-sm text-muted">{subtitle}</p>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/**
 * Nearby TV Cast: finds Smart TVs and Chromecasts on the same Wi-Fi and sends them live pictures, several TVs at once, each on the Projector or
 * the Stage Mirror. The TV needs no browser. The status is read every 2 seconds, so a TV that drops and returns is shown as it happens.
 */
export function TvCastSettings() {
  const [status, setStatus] = useState<TvCastStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState('');
  const [windowsNote, setWindowsNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      bridge.tvCast
        .status()
        .then((next) => alive && setStatus(next))
        .catch((err) => alive && setError(errorText(err)));
    void load();
    const timer = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const run = (task: Promise<TvCastReply | TvCastStatus>, done?: () => void) => {
    setBusy(true);
    setError(null);
    task
      .then((result) => {
        const reply = 'status' in result ? result : null;
        setStatus(reply ? reply.status : (result as TvCastStatus));
        if (reply && !reply.ok && reply.error) setError(reply.error);
        else done?.();
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const scan = () => {
    setScanning(true);
    setError(null);
    bridge.tvCast
      .scan()
      .then(setStatus)
      .catch((err) => setError(errorText(err)))
      .finally(() => setScanning(false));
  };

  const openWindows = () => {
    bridge.tvCast
      .openWindowsDisplay()
      .then((ok) => setWindowsNote(ok ? null : 'Windows Wireless Display could not be opened. Press Win + K instead.'))
      .catch(() => setWindowsNote('Windows Wireless Display could not be opened. Press Win + K instead.'));
  };

  if (!status) return <div className="p-6 text-sm text-muted">{error ?? 'Looking for TVs…'}</div>;

  const controls = castControls({ ...status, scanning: status.scanning || scanning }, { busy });

  return (
    <Section title="Nearby TV Cast (Smart TV & Chromecast)" subtitle="Cast live slides to multiple Smart TVs on the same Wi-Fi without opening a TV browser.">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={scan} disabled={!controls.scan} style={NO_DRAG} className={button}>
          {scanning || status.scanning ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Radar size={14} aria-hidden />}
          {scanning || status.scanning ? 'Scanning…' : 'Scan for TVs'}
        </button>
        <button type="button" onClick={() => setAdding((on) => !on)} disabled={busy} aria-expanded={adding} style={NO_DRAG} className={button}>
          <Plus size={14} aria-hidden /> Add TV by IP
        </button>
        <button type="button" onClick={() => run(bridge.tvCast.castAll())} disabled={!controls.castAll} style={NO_DRAG} className={button}>
          <Cast size={14} aria-hidden /> Cast to All
        </button>
        <button type="button" onClick={() => run(bridge.tvCast.stopAll())} disabled={!controls.stopAll} style={NO_DRAG} className={button}>
          <Square size={14} aria-hidden /> Stop All
        </button>
        <button type="button" onClick={openWindows} style={NO_DRAG} className={button}>
          <MonitorSmartphone size={14} aria-hidden /> Windows Wireless Display (Win+K)
        </button>
      </div>
      <p className="text-xs text-muted">
        Windows Wireless Display (Miracast) connects one display at a time. APCCMMA Network Cast sends to several TVs at once.
      </p>
      {windowsNote && <p className="text-xs text-warn">{windowsNote}</p>}

      {adding && (
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(bridge.tvCast.addByIp(address), () => {
              setAddress('');
              setAdding(false);
            });
          }}
        >
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            aria-label="TV address"
            placeholder="192.168.1.20 or http://192.168.1.20:49152/desc.xml"
            autoComplete="off"
            style={NO_DRAG}
            className={`${field} w-96 max-w-full`}
          />
          <button type="submit" disabled={busy || address.trim() === ''} style={NO_DRAG} className={button}>
            Add TV
          </button>
          <span className="text-xs text-muted">Use this when the Wi-Fi router blocks scanning. A Chromecast uses port 8009.</span>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-canvas p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {status.tvs.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">
          No TVs yet. Turn the TV on, join it to the same Wi-Fi as this laptop, then press Scan for TVs.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {status.tvs.map((tv) => (
            <TvCard
              key={tv.id}
              tv={tv}
              busy={busy}
              onCast={() => run(bridge.tvCast.cast(tv.id, tv.feed))}
              onDisconnect={() => run(bridge.tvCast.disconnect(tv.id))}
              onFeed={(feed) => run(bridge.tvCast.setFeed(tv.id, feed))}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
        {status.hostnameUrl ? (
          <span>
            A TV with a basic browser can open <code className="font-mono font-bold text-fg">{status.hostnameUrl}</code> without typing numbers.
          </span>
        ) : (
          <span>{status.hostname.note ?? 'Turn on the Secondary viewer below to also reach a TV browser at apccmma.local.'}</span>
        )}
        <span>Pictures are sent only on this local network, and only to TVs you cast to.</span>
      </div>
    </Section>
  );
}
