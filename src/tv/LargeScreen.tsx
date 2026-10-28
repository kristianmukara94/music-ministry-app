import { useEffect, useState } from 'react';
import type { SecondaryFrame } from './types';
import { resolveMediaUrl } from './resolveMediaUrl';
import { scaledSize, slideFontCss } from '../../shared/text-style.js';

/** The screen's colour when a slide has none set: the design canvas, as the projector draws it. */
const CANVAS = '#100306';

const STATUS: Record<SecondaryFrame['kind'], string> = {
  off: 'The screen is off',
  idle: 'Nothing is on screen',
  blackout: '',
  slide: '',
};

/**
 * The large-screen picture: a 16:9 frame that scales to the screen, with the background (a colour, or a picture or video covering it) behind
 * the text. Every size is a share of the frame, so a 1080p or 4K TV draws the same layout. Used by the TV page; text is written as text, never HTML.
 */
export function LargeScreen({ frame, mediaBase = '' }: { frame: SecondaryFrame; mediaBase?: string }) {
  const [failed, setFailed] = useState(false);
  const src = frame.kind === 'slide' ? resolveMediaUrl(frame.mediaId, mediaBase) : null;
  // A picture that failed does not mark the next one: the warning belongs to the file that could not be shown.
  useEffect(() => setFailed(false), [src]);
  const fit = frame.fit === 'contain' ? 'object-contain' : 'object-cover';
  const live = frame.kind === 'slide';
  // The operator's slide font. Undefined keeps the default face, so the look is unchanged until a font is chosen.
  const fontFamily = slideFontCss(frame.font);
  // The operator's size scale. Lines wrap inside the 16:9 frame, which has its own bounds, so a larger scale wraps rather than spills.
  const scale = frame.fontScale ?? 1;
  return (
    <div className="relative h-full w-full overflow-hidden text-white [container-type:size]" style={{ backgroundColor: live ? (frame.color ?? CANVAS) : '#000' }}>
      {src && frame.mediaKind === 'image' && (
        <img key={src} src={src} alt="" draggable={false} onError={() => setFailed(true)} className={`absolute inset-0 h-full w-full ${fit} object-center`} />
      )}
      {src && frame.mediaKind === 'video' && (
        // Muted, with no controls: it starts by itself, loops when Loop is on, and otherwise holds its last frame.
        <video
          key={src}
          src={src}
          muted
          autoPlay
          playsInline
          loop={frame.loop ?? true}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full ${fit} object-center`}
        />
      )}
      {src && frame.shade && <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/45" />}

      {live ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-[6cqw] text-center">
          {frame.title && (
            <p className="absolute top-[7cqh] left-[6cqw] font-bold tracking-[0.2em] text-[#d6a94f] uppercase" style={{ fontFamily, fontSize: scaledSize('1.6cqw', scale) }}>
              {frame.title}
            </p>
          )}
          <div className="font-serif leading-[1.25] font-semibold whitespace-pre-line" style={{ fontFamily, fontSize: scaledSize('5cqw', scale) }}>
            {frame.lines.map((line, i) => (
              <p key={i} className="m-0">
                {line || ' '}
              </p>
            ))}
          </div>
          {failed && <p role="alert" className="absolute bottom-[7cqh] left-[6cqw] text-[1.6cqw] text-[#f5c96b]">This picture or video cannot be shown. The screen shows its colour.</p>}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[2.4cqw] text-stone-400">{STATUS[frame.kind]}</div>
      )}
    </div>
  );
}
