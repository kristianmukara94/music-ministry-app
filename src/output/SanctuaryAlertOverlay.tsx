import { useEffect, useState } from 'react';
import { alertExpired, type SanctuaryAlert } from '../../shared/sanctuary-alert.js';

/** How long the banner takes to slide in or out. Matches the CSS transition below. */
const SLIDE_MS = 300;

/**
 * The alert to draw, held through its slide-out after the live one clears. Its expiry is also checked here, so the banner comes down on
 * time even when the clear from the main process arrives late (or, in the browser build, never).
 */
function useSlidingAlert(live: SanctuaryAlert | null) {
  const [now, setNow] = useState(() => Date.now());
  const current = live && !alertExpired(live, now) ? live : null;
  const [shown, setShown] = useState<SanctuaryAlert | null>(current);
  const [up, setUp] = useState(false);

  // Wakes at the expiry, so the check above runs again then.
  useEffect(() => {
    if (!live || live.expiresAt === null) return;
    const wait = live.expiresAt - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(timer);
  }, [live]);

  useEffect(() => {
    if (current) {
      setShown(current);
      // One frame at the start position first, so the banner slides in rather than appearing.
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
      return () => cancelAnimationFrame(frame);
    }
    setUp(false);
    const timer = window.setTimeout(() => setShown(null), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  return { shown, up };
}

/**
 * The Sanctuary Alert banner: a dark bar along the bottom tenth of the stage, above every other layer (lyrics, readings, Mass slides, the
 * lower third and the note callout). It only draws; it never touches the slides under it, so the Mass keeps its place and its keys.
 * Sizes are shares of the stage, so it looks the same on the projector and in the mirror.
 */
export function SanctuaryAlertOverlay({ value }: { value: SanctuaryAlert | null }) {
  const { shown, up } = useSlidingAlert(value);
  if (!shown) return null;
  const urgent = shown.severity === 'urgent';
  const accent = urgent ? '#ef4444' : '#f59e0b';
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[70] flex h-[10cqh] items-center gap-[1.6cqw] px-[2.4cqw] text-white"
      style={{
        backgroundColor: 'rgba(17, 10, 14, 0.92)',
        borderTop: `0.35cqh solid ${accent}`,
        boxShadow: `0 -0.6cqh 3cqh ${accent}66, inset 0 0.4cqh 1.6cqh ${accent}33`,
        transform: up ? 'translateY(0)' : 'translateY(110%)',
        transition: `transform ${SLIDE_MS / 1000}s cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    >
      <span
        className="flex shrink-0 items-center gap-[0.6cqw] rounded-full px-[1.2cqw] py-[0.8cqh] text-[1.5cqw] font-black tracking-[0.14em] uppercase motion-safe:animate-pulse"
        style={{ backgroundColor: `${accent}26`, color: accent, border: `0.2cqh solid ${accent}` }}
      >
        <span aria-hidden>⚠️</span>
        Sanctuary Notice
      </span>
      {/* A short notice is one large line. A long one (up to 120 characters) drops to two smaller lines, so a plate or tag at its end is never cut off. */}
      <span
        className={`min-w-0 flex-1 leading-[1.15] font-bold tracking-wide line-clamp-2 ${shown.text.length > 60 ? 'text-[1.9cqw]' : 'text-[2.6cqw]'}`}
      >
        {shown.text}
      </span>
    </div>
  );
}
