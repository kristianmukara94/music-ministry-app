import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LargeScreen } from './LargeScreen';
import type { SecondarySnapshot } from './types';

/** How often a TV that could not reach the laptop tries again. The stream itself reconnects on its own once it is open. */
const RETRY_MS = 2000;

type Phase = 'connecting' | 'pin' | 'live' | 'offline';

// Older Smart TV browsers only have the prefixed fullscreen names.
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null };
type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?: () => unknown };

/** The element shown full screen, or null. */
const fullscreenElement = (): Element | null => document.fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement ?? null;

/**
 * Asks the browser to take the whole page full screen, which hides its address and search bar. Browsers allow this only from a user
 * action, so it is called from a click or the TV remote's OK key. A refusal, or a browser without the feature, is ignored: the screen
 * then stays inside the browser window.
 */
function requestPageFullscreen() {
  if (fullscreenElement()) return;
  const root = document.documentElement as FullscreenRoot;
  try {
    if (root.requestFullscreen) void root.requestFullscreen().catch(() => undefined);
    else root.webkitRequestFullscreen?.();
  } catch {
    /* a browser that throws instead of refusing: the screen stays inside the window */
  }
}

// The names and legacy key codes a TV remote's OK or Select button sends, across Tizen, webOS, Android TV and Fire TV browsers.
const OK_KEYS = new Set(['Enter', 'Select', ' ', 'Space', 'Spacebar']);
const OK_KEY_CODES = new Set([13, 32]);
// Keys that would otherwise scroll the page or press the focused element.
const SCROLL_KEYS = new Set([' ', 'Space', 'Spacebar', 'Select']);

function isOkKey(event: KeyboardEvent<HTMLElement>): boolean {
  return OK_KEYS.has(event.key) || OK_KEY_CODES.has(event.keyCode);
}

/**
 * The TV page (`/tv`). Read-only: it has no controls. It asks for the PIN when the laptop has one set, then follows the Secondary display's
 * stream, and draws each frame with LargeScreen. Text from the stream is drawn as text.
 */
export function TvView() {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [snapshot, setSnapshot] = useState<SecondarySnapshot | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => fullscreenElement() !== null);

  // The browser can leave full screen on its own (Escape, a remote's Back key), so the hint follows the browser, not the last click.
  useEffect(() => {
    const sync = () => setIsFullscreen(fullscreenElement() !== null);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      source?.close();
      source = new EventSource('/api/remote/stream');
      source.onopen = () => setPhase('live');
      source.onmessage = (event) => {
        try {
          setSnapshot(JSON.parse(event.data) as SecondarySnapshot);
        } catch {
          /* a malformed frame is ignored; the next one replaces it */
        }
      };
      source.onerror = () => setPhase('offline');
    };

    const check = async () => {
      try {
        const response = await fetch('/api/remote/status', { credentials: 'same-origin' });
        const status = (await response.json()) as { pinRequired: boolean; unlocked: boolean };
        if (closed) return;
        if (status.pinRequired && !status.unlocked) setPhase('pin');
        else connect();
      } catch {
        if (closed) return;
        setPhase('offline');
        retry = setTimeout(check, RETRY_MS);
      }
    };

    void check();
    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, []);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pin = String(new FormData(event.currentTarget).get('pin') ?? '');
    const response = await fetch('/api/remote/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ pin }),
    });
    if (response.ok) {
      setPinError(null);
      setPhase('connecting');
      window.location.reload();
      return;
    }
    const body = (await response.json().catch(() => ({ error: 'The PIN was not accepted.' }))) as { error?: string };
    setPinError(body.error ?? 'The PIN was not accepted.');
  };

  if (phase === 'pin') {
    return (
      <div className="tv-pin">
        <form onSubmit={unlock} autoComplete="off">
          <label htmlFor="pin-input">Enter the PIN to show the service</label>
          <input id="pin-input" name="pin" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8} required />
          <button type="submit">Open</button>
          {pinError && <p role="alert">{pinError}</p>}
        </form>
      </div>
    );
  }

  return (
    <div
      className="tv-stage"
      tabIndex={0}
      autoFocus
      onClick={requestPageFullscreen}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (!isOkKey(event)) return;
        if (SCROLL_KEYS.has(event.key) || event.keyCode === 32) event.preventDefault();
        requestPageFullscreen();
      }}
    >
      <div className="tv-frame-wrap">{snapshot ? <LargeScreen frame={snapshot.frame} /> : <div className="tv-frame" />}</div>
      {!isFullscreen && <p className="tv-hint">Click screen or press OK on TV Remote for Fullscreen</p>}
      {phase === 'offline' && (
        <p role="status" className="tv-offline">
          Cannot reach the laptop. The screen will reconnect when it can.
        </p>
      )}
    </div>
  );
}
