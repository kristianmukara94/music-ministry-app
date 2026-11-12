import { useEffect, useLayoutEffect, useState } from 'react';
import { bridge, type FailoverMode } from '../live/bridge';
import { useChurchLogo } from '../church/profile';
import { ChurchEmblem } from '../church/ChurchEmblem';

/** Near-black for the emblem: dark enough for a sanctuary, warm enough not to read as a dead screen. */
const EMBLEM_BACKGROUND = '#080507';
const BLACKOUT_BACKGROUND = '#000000';

/**
 * The sanctuary failover surface (route `#/failover`). It lives in its own always-loaded window, kept hidden over the projector by the
 * watchdog (electron/watchdog.js, electron/windows.js), and is shown the instant the projector page crashes, freezes or is forced off.
 *
 * It holds no live state and loads nothing after its first render: the emblem is inlined in the bundle, so there is nothing that can fail
 * while it is on screen. No cursor, no selection, no focus. It tells the main process which mode it has drawn, so a show waits for the
 * right one.
 */
export function FailoverOverlay() {
  const [mode, setMode] = useState<FailoverMode | null>(null);
  // The parish logo, held in memory as a data URL (fetched once while this window sits hidden), or the inlined emblem until it arrives.
  const emblemSrc = useChurchLogo();

  // The page background is the theme canvas elsewhere; here it must never be anything but black, even for the frame before React draws.
  useLayoutEffect(() => {
    const { documentElement: html, body } = document;
    html.style.background = BLACKOUT_BACKGROUND;
    body.style.background = BLACKOUT_BACKGROUND;
    body.style.cursor = 'none';
  }, []);

  useEffect(() => {
    let current = true;
    const off = bridge.watchdog.onFailoverMode((next) => setMode(next));
    // The main process also sends the mode when the page finishes loading, which can be before this listener exists. Ask as well.
    void bridge.watchdog.failoverMode().then((next) => {
      if (current) setMode((m) => m ?? next);
    });
    return () => {
      current = false;
      off();
    };
  }, []);

  // Runs after React has committed the new mode to the page.
  useEffect(() => {
    if (mode) bridge.watchdog.painted(mode);
  }, [mode]);

  const emblem = mode === 'emblem';
  return (
    <div
      aria-hidden
      className="fixed inset-0 grid cursor-none place-items-center overflow-hidden select-none"
      // Its own compositing layer, so showing the window is a single composite with no layout or paint to do first.
      style={{ background: emblem ? EMBLEM_BACKGROUND : BLACKOUT_BACKGROUND, contain: 'strict', transform: 'translateZ(0)' }}
    >
      {emblem && (
        // Framed like the projector crest: the profile's logo size, and its light backing when one is chosen.
        <ChurchEmblem src={emblemSrc} className="pointer-events-none size-[34vmin] opacity-90" />
      )}
    </div>
  );
}
