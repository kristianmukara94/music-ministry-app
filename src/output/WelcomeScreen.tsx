import { useEffect, useState, type CSSProperties } from 'react';
import {
  WELCOME_CANVAS_COLOR,
  WELCOME_FONT_STACKS,
  carouselPosition,
  countdownRemainingMs,
  formatCountdown,
  welcomeBackground,
  type WelcomeSettings,
  type WelcomeShadow,
  type WelcomeSlide,
} from '../../shared/welcome-settings.js';
import { getSlideImageUrl, onSlideImageError } from './slideImage';
import { BackgroundMedia, BackgroundShade } from './BackgroundMedia';
import { useOutput } from './outputState';

/** When the welcome screen went up and which slide the operator last stepped to. Carried on the welcome frame, so every screen agrees. */
export interface WelcomeAnchor {
  shownAt?: number;
  slide?: number;
  slideAt?: number;
}

/** The welcome screen on the projector: reads the saved content and style, so a change shows as soon as it is saved. */
export function WelcomeFrame() {
  const welcome = useOutput((s) => s.welcome);
  // The live welcome frame carries the countdown's start and the carousel's place; a staged one (a preview thumbnail) is used when it is not live.
  const anchor = useOutput((s) => (s.projector.live.kind === 'welcome' ? s.projector.live : s.projector.staged?.kind === 'welcome' ? s.projector.staged : null));
  return <WelcomeCanvas settings={welcome} anchor={anchor ?? undefined} />;
}

/** The text shadow choices, sized as a share of the stage so they scale with the projector. */
const SHADOWS: Record<WelcomeShadow, string | undefined> = {
  NONE: undefined,
  SOFT: '0 0.2cqw 0.8cqw rgba(0,0,0,0.75), 0 0 0.3cqw rgba(0,0,0,0.5)',
  // Eight hard offsets: a solid outline that reads over any picture, without the stroke eating into thin serifs.
  OUTLINE: [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ].map(([x, y]) => `${x * 0.12}cqw ${y * 0.12}cqw 0 #000`).join(', '),
};

/** The time, refreshed a few times a second while something on screen depends on it. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * The welcome screen, full bleed. Behind everything is the background colour. Over it, when one is chosen and present, is a picture or a
 * video clip, filled or shown whole, with a shade behind the text when that is on. Then the contrast scrim, the current carousel slide, and
 * the countdown. The projector and the settings preview draw this same canvas, so they match. `anchor` says when the screen went up and which
 * slide the operator stepped to; without one, the time this canvas was first drawn is used. `onBackgroundMissing` is called when the chosen
 * background will not load; the screen then shows the colour instead. Sizes are shares of the stage width (1920 reference, as elsewhere).
 */
export function WelcomeCanvas({ settings, anchor, onBackgroundMissing }: { settings: WelcomeSettings; anchor?: WelcomeAnchor; onBackgroundMissing?: () => void }) {
  const [failed, setFailed] = useState(false);
  // A new background gets a fresh try: a file that failed before may now be there.
  useEffect(() => setFailed(false), [settings.backgroundUrl, settings.backgroundType]);
  const [mountedAt] = useState(() => Date.now());

  const { slides, countdown } = settings;
  const shownAt = anchor?.shownAt ?? mountedAt;
  const slideAt = anchor?.slideAt ?? shownAt;
  const ticking = countdown.enabled || (slides.length > 1 && slides.some((s) => s.dwell > 0));
  const now = useNow(ticking);

  const { index } = carouselPosition(slides, anchor?.slide ?? 0, now - slideAt);
  const slide: WelcomeSlide | null = index >= 0 ? slides[index] : null;
  const remaining = countdownRemainingMs(countdown, now, shownAt);
  const atZero = remaining === 0;
  // "Auto-Clear Background": at zero the countdown and the background media go, leaving the slides over the plain colour.
  const cleared = atZero && countdown.onZero === 'CLEAR';

  const background = welcomeBackground(settings, failed || cleared);
  const onBackgroundError = () => {
    setFailed(true);
    onBackgroundMissing?.();
  };

  const image = slide?.type === 'IMAGE' && slide.imageUrl ? getSlideImageUrl(slide.imageUrl) : '';
  const hasText = slide !== null && slide.type !== 'IMAGE';
  const showCountdown = remaining !== null && !cleared;
  // A filled picture covers the whole output, so it is not padded; every other view keeps the padding.
  const filled = slide?.type === 'IMAGE' && image !== '' && settings.imageFit !== 'FIT';
  const textStyle: CSSProperties = { fontFamily: WELCOME_FONT_STACKS[settings.fontFamily], textShadow: SHADOWS[settings.textShadow] };
  const scrim = settings.scrim / 100;
  const size = (share: number) => `${(settings.fontSize * share) / 19.2}cqw`;

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center overflow-hidden text-center ${filled ? '' : 'p-[6cqw]'}`}
      style={{ backgroundColor: background.color ?? WELCOME_CANVAS_COLOR, color: settings.textColor }}
    >
      {background.media && <BackgroundMedia media={background.media} onFail={onBackgroundError} />}
      {background.media && background.shade && hasText && <BackgroundShade target="welcome" />}
      {scrim > 0 && (hasText || showCountdown) && (
        <div
          aria-hidden
          data-testid="welcome-scrim"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 80% 70% at 50% 50%, rgba(0,0,0,${scrim}) 0%, rgba(0,0,0,${scrim * 0.8}) 55%, rgba(0,0,0,${scrim * 0.45}) 100%)`,
          }}
        />
      )}

      {slide && (
        // Keyed by the slide, so each new slide fades in.
        <div
          key={`${slide.id}:${index}`}
          className={filled ? 'absolute inset-0' : 'relative flex h-full w-full items-center justify-center'}
          style={{ animation: 'apcc-enter-fade 600ms ease-out both' }}
        >
          {slide.type === 'IMAGE' ? (
            image ? (
              <img
                src={image}
                onError={onSlideImageError}
                alt=""
                draggable={false}
                className={filled ? 'absolute inset-0 h-full w-full object-cover object-center' : 'h-full w-full object-contain object-center'}
              />
            ) : (
              <p className="text-[1.6cqw] opacity-60">No image chosen.</p>
            )
          ) : slide.type === 'ANNOUNCEMENT' ? (
            <div
              className="flex max-w-[84%] flex-col items-center gap-[1.4cqw] rounded-[1.2cqw] border px-[4.5cqw] py-[3.2cqw]"
              style={{ ...textStyle, borderColor: 'color-mix(in srgb, currentColor 28%, transparent)', backgroundColor: 'rgba(0,0,0,0.32)' }}
            >
              {slide.title && (
                <h2 className="leading-tight font-bold tracking-[0.06em] uppercase" style={{ fontSize: size(0.62) }}>
                  {slide.title}
                </h2>
              )}
              {slide.title && slide.text && <span aria-hidden className="h-[0.22cqw] w-[9cqw] rounded-full bg-current opacity-50" />}
              {slide.text && (
                <p className="leading-snug font-medium whitespace-pre-line" style={{ fontSize: size(0.72) }}>
                  {slide.text}
                </p>
              )}
            </div>
          ) : (
            <p className="leading-tight font-semibold whitespace-pre-line" style={{ ...textStyle, fontSize: size(1) }}>
              {slide.text}
            </p>
          )}
        </div>
      )}

      {showCountdown && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[4.5cqw] flex justify-center">
          <div role="timer" aria-live="off" className="flex flex-col items-center gap-[0.5cqw] rounded-[1cqw] bg-black/50 px-[3cqw] py-[1.2cqw]" style={textStyle}>
            {countdown.label && <span className="text-[1.5cqw] font-semibold tracking-[0.18em] uppercase opacity-85">{countdown.label}</span>}
            <span className="text-[5.2cqw] leading-none font-bold tabular-nums">{formatCountdown(remaining)}</span>
          </div>
        </div>
      )}

      {/* "Fade to Black" at zero. Always present while it is the choice, so the fade animates rather than cuts. */}
      {countdown.enabled && countdown.onZero === 'FADE' && (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-[2000ms]" style={{ opacity: atZero ? 1 : 0 }} />
      )}
    </div>
  );
}
