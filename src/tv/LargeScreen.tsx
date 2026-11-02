import { useEffect, useLayoutEffect, useState } from 'react';
import type { SecondaryFrame } from './types';
import { resolveMediaUrl } from './resolveMediaUrl';
import { slideFontCss } from '../../shared/text-style.js';

/** The screen's colour when a slide has none set: the design canvas, as the projector draws it. */
const CANVAS = '#100306';

const STATUS: Record<SecondaryFrame['kind'], string> = {
  off: 'The screen is off',
  idle: 'Nothing is on screen',
  blackout: '',
  slide: '',
};

/**
 * The width of an element in pixels, kept up to date as the screen changes size. Older TV browsers have no container-query units, so the
 * text is sized from this measure instead.
 */
function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return undefined;
    const read = () => setWidth(element.clientWidth);
    read();
    window.addEventListener('resize', read);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', read);
      observer?.disconnect();
    };
  }, [element]);
  return width;
}

/**
 * The large-screen picture: a 16:9 frame that scales to the screen, with the background (a colour, or a picture or video covering it) behind
 * the text. Every size is a share of the frame's width, so a 1080p or 4K TV draws the same layout. Used by the TV page; text is written as text,
 * never HTML. It is styled by tv.css, in plain CSS an old TV browser understands.
 */
export function LargeScreen({ frame, mediaBase = '' }: { frame: SecondaryFrame; mediaBase?: string }) {
  const [failed, setFailed] = useState(false);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const src = frame.kind === 'slide' ? resolveMediaUrl(frame.mediaId, mediaBase) : null;
  // A picture that failed does not mark the next one: the warning belongs to the file that could not be shown.
  useEffect(() => setFailed(false), [src]);
  const fit = frame.fit === 'contain' ? 'tv-contain' : 'tv-cover';
  const live = frame.kind === 'slide';
  // The operator's slide font. Undefined keeps the default face, so the look is unchanged until a font is chosen.
  const fontFamily = slideFontCss(frame.font);
  // The operator's size scale. Lines wrap inside the 16:9 frame, which has its own bounds, so a larger scale wraps rather than spills.
  const scale = frame.fontScale ?? 1;
  // One percent of the frame's width, in pixels. A size is written as that many percent of the width, times the scale when it applies.
  const unit = useWidth(frameElement) / 100;
  const sized = (percent: number) => `${(percent * scale * unit).toFixed(2)}px`;
  const fixed = (percent: number) => `${(percent * unit).toFixed(2)}px`;
  return (
    <div ref={setFrameElement} className="tv-frame" style={{ backgroundColor: live ? (frame.color ?? CANVAS) : '#000' }}>
      {src && frame.mediaKind === 'image' && <img key={src} src={src} alt="" draggable={false} onError={() => setFailed(true)} className={`tv-fill ${fit}`} />}
      {src && frame.mediaKind === 'video' && (
        // Muted, with no controls: it starts by itself, loops when Loop is on, and otherwise holds its last frame.
        <video key={src} src={src} muted autoPlay playsInline loop={frame.loop ?? true} onError={() => setFailed(true)} className={`tv-fill ${fit}`} />
      )}
      {src && frame.shade && <div aria-hidden className="tv-fill tv-shade" />}

      {live && frame.image ? (
        <img key={frame.image} src={`${mediaBase}/api/remote/slide/${frame.image}`} alt="" draggable={false} className="tv-fill tv-picture" />
      ) : live ? (
        <div className="tv-text">
          {frame.title && (
            <p className="tv-title" style={{ fontFamily, fontSize: sized(1.6) }}>
              {frame.title}
            </p>
          )}
          <div className="tv-lines" style={{ fontFamily, fontSize: sized(5) }}>
            {frame.lines.map((line, i) => (
              <p key={i}>{line || ' '}</p>
            ))}
          </div>
          {failed && (
            <p role="alert" className="tv-failed" style={{ fontSize: fixed(1.6) }}>
              This picture or video cannot be shown. The screen shows its colour.
            </p>
          )}
        </div>
      ) : (
        <div className="tv-status" style={{ fontSize: fixed(2.4) }}>
          {STATUS[frame.kind]}
        </div>
      )}
    </div>
  );
}
