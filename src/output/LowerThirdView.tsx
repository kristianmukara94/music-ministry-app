import { useEffect, useState, type CSSProperties } from 'react';
import type { LowerThird, LowerThirdTemplate } from '../../shared/live.js';
import { TEXT_FONTS } from '../../shared/text-style.js';
import type { LowerThirdStyle } from '../../shared/lower-third-style';
import { useLive } from '../live/store';
import { LOGO_SRC } from '../brand/logo';
import { useOutput } from './outputState';

/** How long a lower third takes to fade in or out. Keep in step with `duration-300` in LowerThirdStage's callers. */
export const LOWER_THIRD_FADE_MS = 300;

/** A size in pixels on the 1920 slide, as a share of the stage width. The stage sets `container-type`. */
const cq = (px: number) => `${px / 19.2}cqw`;

/** A hex colour with an opacity percentage, as a CSS colour. */
const rgba = (hex: string, percent: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${percent / 100})`;
};

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

/** Shadow and outline for the main text, from the style's switches. */
function textEffects(style: LowerThirdStyle): CSSProperties {
  const shadows: string[] = [];
  if (style.shadow) shadows.push(`0 ${cq(3)} ${cq(10)} rgba(0, 0, 0, 0.85)`);
  if (style.boldDepth) shadows.push(`0 ${cq(2)} 0 rgba(0, 0, 0, 0.55)`, `0 ${cq(4)} ${cq(4)} rgba(0, 0, 0, 0.35)`);
  const css: CSSProperties = {};
  if (shadows.length > 0) css.textShadow = shadows.join(', ');
  if (style.outline) {
    css.WebkitTextStroke = `${cq(style.outlineWidth)} ${style.outlineColor}`;
    css.paintOrder = 'stroke fill';
  }
  return css;
}

/**
 * The Praise & Worship lower third: the segment name on a gold tag, over a maroon bar that carries the song title and,
 * beneath it, a smaller line. Drawn in the default palette whatever the operator theme (decision D), so the stream
 * never gets a light bar. Sizes are in container widths, as the other lower thirds are.
 */
export function SegmentLowerThird({ value }: { value: LowerThird }) {
  return (
    <div data-theme="default" className="flex max-w-[80cqw] flex-col items-start">
      {value.tag && (
        <div
          className="font-sans font-extrabold tracking-[0.18em] uppercase"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-on-accent)',
            fontSize: cq(19),
            padding: `${cq(6)} ${cq(14)}`,
            borderRadius: `${cq(3)} ${cq(3)} 0 0`,
          }}
        >
          {value.tag}
        </div>
      )}
      <div
        className="flex min-w-0 flex-col"
        style={{
          background: 'color-mix(in oklab, var(--color-line-strong) 55%, var(--color-canvas))',
          color: 'var(--color-fg)',
          padding: `${cq(16)} ${cq(24)}`,
          borderRadius: `0 ${cq(3)} ${cq(3)} ${cq(3)}`,
          boxShadow: `0 ${cq(4)} ${cq(14)} rgba(0, 0, 0, 0.45)`,
        }}
      >
        <div className="font-serif font-semibold" style={{ fontSize: cq(56), lineHeight: 1.1 }}>
          {value.line1}
        </div>
        {value.line2 && (
          <div className="font-sans" style={{ fontSize: cq(24), color: 'var(--color-muted)', marginTop: cq(4) }}>
            {value.line2}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One lower third, drawn to its style. The response prompt keeps its white pill; everything else is the styled card:
 * the name, and the reference beneath it on its own line or folded into the main text.
 * Sizes are in container widths, so the preview and the live output are drawn to the same proportions.
 */
export function LowerThirdCard({ value, style }: { value: LowerThird; style: LowerThirdStyle }) {
  const template: LowerThirdTemplate = value.template ?? 'nameplate';

  if (template === 'segment') return <SegmentLowerThird value={value} />;

  if (template === 'response') {
    // A liturgical response on a white pill, for example "R: And with your spirit".
    return (
      <div className="inline-flex max-w-[80cqw] items-center rounded-full bg-white px-[2.6cqw] py-[1.1cqw] text-[2.2cqw] font-extrabold text-black shadow-2xl">
        {value.line1}
      </div>
    );
  }

  const main: CSSProperties = {
    color: style.textColor,
    fontFamily: TEXT_FONTS[style.fontFamily as keyof typeof TEXT_FONTS]?.css,
    fontSize: cq(style.fontSize),
    fontWeight: style.boldDepth ? 800 : 600,
    lineHeight: 1.2,
    textAlign: style.align,
    ...textEffects(style),
  };

  // The reference on its own line, with its own colour and size and, when chosen, its own background.
  const reference: CSSProperties = {
    color: style.refColor,
    fontSize: cq((style.fontSize * style.refSize) / 100),
    fontWeight: 600,
    letterSpacing: '0.04em',
    ...(style.refBackground
      ? { background: rgba(style.refBgColor, style.refBgOpacity), padding: `${cq(4)} ${cq(12)}`, borderRadius: cq(6) }
      : {}),
  };

  const text = (
    <div className="flex min-w-0 flex-col" style={{ gap: cq(style.fontSize * 0.2) }}>
      {template === 'intention' && (
        <div className="font-bold tracking-[0.25em] uppercase opacity-70" style={{ fontSize: cq(style.fontSize * 0.45), color: style.textColor }}>
          Mass intention
        </div>
      )}
      <div style={main}>{value.line1}</div>
      {value.line2 &&
        (style.showReference ? (
          <div className="flex" style={{ justifyContent: JUSTIFY[style.refPosition] }}>
            <div style={reference}>{value.line2}</div>
          </div>
        ) : (
          <div className="font-semibold tracking-[0.12em] uppercase" style={{ ...main, fontSize: cq(style.fontSize * 0.7), fontWeight: 600 }}>
            {value.line2}
          </div>
        ))}
    </div>
  );

  return (
    <div
      className="flex items-center"
      style={{
        width: `${style.width}%`,
        boxSizing: 'border-box',
        padding: cq(style.padding),
        borderRadius: cq(style.radius),
        background: rgba(style.bgColor, style.bgOpacity),
        gap: cq(style.padding),
      }}
    >
      {style.showLogo && <img src={LOGO_SRC} alt="" draggable={false} className="shrink-0" style={{ height: cq(style.fontSize * 2.2), width: 'auto' }} />}
      {text}
    </div>
  );
}

/**
 * A lower third in place on its screen. The position, alignment and width come from the look the operator chose.
 * The response prompt sits centred at the bottom, so it reads across the whole sanctuary. The stage never takes clicks.
 * The parent needs `container-type` so the sizes scale.
 */
export function LowerThirdStage({ value, className = '' }: { value: LowerThird; className?: string }) {
  const style = useOutput((s) => s.lowerStyle);

  if (value.template === 'response') {
    return (
      <div className={`pointer-events-none absolute z-50 flex bottom-[6%] left-1/2 max-w-[70%] -translate-x-1/2 justify-center text-center ${className}`}>
        <LowerThirdCard value={value} style={style} />
      </div>
    );
  }

  const edge = `calc(5% + ${cq(style.offset)})`;
  const vertical = style.position === 'top' ? { top: edge } : { bottom: edge };
  return (
    <div
      className={`pointer-events-none absolute z-50 flex ${className}`}
      style={{ left: '5%', width: '90%', justifyContent: JUSTIFY[style.align], ...vertical }}
    >
      <LowerThirdCard value={value} style={style} />
    </div>
  );
}

/**
 * Fades a lower third in and out. A change to the value fades the old one out, then fades the new one in. Turning it on from
 * nothing fades in, and clearing it fades out. Returns the value still on screen, and whether it is opaque yet.
 */
export function useFadedLowerThird(live: LowerThird | null) {
  // The store hands out a new object on every update, so changes are compared by content, not by identity.
  const liveKey = live ? JSON.stringify(live) : '';
  const [shown, setShown] = useState<LowerThird | null>(null);
  const [shownKey, setShownKey] = useState('');
  const [visible, setVisible] = useState(false);

  // Swap the shown value: straight away from nothing, or after a fade-out when it replaces another value.
  useEffect(() => {
    if (liveKey === shownKey) return;
    if (shownKey === '') {
      setShown(live);
      setShownKey(liveKey);
      return;
    }
    setVisible(false);
    const id = window.setTimeout(() => {
      setShown(live);
      setShownKey(liveKey);
    }, LOWER_THIRD_FADE_MS);
    return () => window.clearTimeout(id);
  }, [liveKey]);

  // Once the new value is on the page, fade it in on the next frame, so the browser draws the start state first.
  useEffect(() => {
    if (!shownKey || shownKey !== liveKey) return;
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [shownKey, liveKey]);

  return { shown, visible };
}

/** The lower third drawn over a projector screen. Pass null to fade it out. It sits above slides, lyrics and backgrounds. */
export function LowerThirdOverlay({ value }: { value: LowerThird | null }) {
  const { shown, visible } = useFadedLowerThird(value);
  if (!shown) return null;
  return (
    <LowerThirdStage
      value={shown}
      className={`z-50 transition-opacity duration-300 ease-in-out ${visible ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

/**
 * The lower-third window, and the browser source at /lower-third: a transparent overlay for stream capture.
 * The lower third fades in, out and between values, as LowerThirdOverlay does.
 */
export function LowerThirdView() {
  const live = useLive((s) => s.state.lowerThird.live);
  const { shown, visible } = useFadedLowerThird(live);

  useEffect(() => {
    document.body.classList.add('transparent');
    return () => document.body.classList.remove('transparent');
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden select-none [container-type:inline-size]">
      {shown && (
        <LowerThirdStage
          value={shown}
          className={`transition-opacity duration-300 ease-in-out ${visible ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
