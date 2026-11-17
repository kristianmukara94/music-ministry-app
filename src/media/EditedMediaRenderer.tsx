import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type SyntheticEvent } from 'react';
import {
  MEDIA_EDIT_REFERENCE_WIDTH,
  buildMediaFilterCss,
  buildMediaOverlays,
  buildMediaTransformCss,
  fadeOpacityAt,
  mediaObjectFit,
  normalizeMediaEditSettings,
  resolveTrimWindow,
  trimPlaybackAction,
  usesNativeLoop,
  type MediaEditSettings,
} from '../../shared/media-editor.js';

export type Playback = 'loop' | 'once' | 'hold';

/** The blur bleed: a blurred picture fades to transparent at its edges, so it is scaled up just enough to push that fade off screen. */
const bleedScale = (blurPx: number, width: number) => (blurPx > 0 && width > 0 ? 1 + (blurPx * 4) / width : 1);

/** The media element's style for a set of edits at a drawn width: object-fit, filter and transform, all from shared/media-editor.js. */
export function editedMediaStyle(edit: MediaEditSettings | null | undefined, width: number): CSSProperties {
  if (!edit) return { objectFit: 'cover' };
  const scale = width > 0 ? width / MEDIA_EDIT_REFERENCE_WIDTH : 1;
  const filter = buildMediaFilterCss(edit, { scale });
  const transform = buildMediaTransformCss(edit);
  const bleed = bleedScale(edit.blur * scale, width);
  const withBleed = bleed !== 1 ? `scale(${bleed.toFixed(4)})${transform === 'none' ? '' : ` ${transform}`}` : transform;
  return {
    objectFit: mediaObjectFit(edit),
    filter: filter === 'none' ? undefined : filter,
    transform: withBleed === 'none' ? undefined : withBleed,
    transformOrigin: '50% 50%',
  };
}

/** The warmth wash, the liturgical tint and the vignette, stacked over the media in that order. */
export function EditOverlays({ edit }: { edit: MediaEditSettings | null | undefined }) {
  if (!edit) return null;
  return (
    <>
      {buildMediaOverlays(edit).map((layer) => (
        <div
          key={layer.kind}
          aria-hidden
          data-edit-layer={layer.kind}
          className="pointer-events-none absolute inset-0"
          style={
            layer.kind === 'vignette'
              ? { background: layer.background }
              : { backgroundColor: layer.color, opacity: layer.opacity, mixBlendMode: layer.blendMode as CSSProperties['mixBlendMode'] }
          }
        />
      ))}
    </>
  );
}

/** The drawn width of an element, kept up to date. The blur radius follows it. */
function useWidth(ref: MutableRefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * One picture or video drawn with its saved Media Studio edits: crop, zoom, pan, rotation and flips; the colour grade and blur; the warmth
 * wash, tint and vignette; and for a video the trim window, its fades, speed and volume. The stage preview, the staged background card,
 * the projector, the mirror and the previews all draw backgrounds through this, so they match.
 *
 * A video seeks to the in point when it loads and loops back to it at the out point. With no trim and no fades it uses the browser's own
 * loop, exactly as backgrounds always played. `playback` 'once' reports the end through onEnded; 'hold' stops on the out point's frame.
 * Sound plays only when `audible` (the congregation's projector) and the edit's volume is above 0; everywhere else the video is muted.
 */
export function EditedMediaRenderer({
  mediaType,
  src,
  edit,
  playback = 'loop',
  rate = 1,
  audible = false,
  autoPlay = true,
  enforceTrim = true,
  className = 'absolute inset-0',
  mediaClassName = '',
  crossOrigin,
  videoRef,
  onEnded,
  onImageError,
  onLoaded,
}: {
  mediaType: 'image' | 'video';
  src: string;
  edit: MediaEditSettings | null | undefined;
  playback?: Playback;
  rate?: number;
  audible?: boolean;
  autoPlay?: boolean;
  /** Off in the Studio while the operator scrubs outside the trim window. */
  enforceTrim?: boolean;
  className?: string;
  mediaClassName?: string;
  /** 'anonymous' where a canvas reads the picture back (the Studio's bake and poster frame). */
  crossOrigin?: 'anonymous';
  videoRef?: MutableRefObject<HTMLVideoElement | null>;
  onEnded?: () => void;
  onImageError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onLoaded?: (el: HTMLImageElement | HTMLVideoElement) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const width = useWidth(boxRef);
  const settings = edit ? normalizeMediaEditSettings(edit) : null;
  const style = editedMediaStyle(settings, width);
  const mediaCls = `absolute inset-0 h-full w-full ${mediaClassName}`;

  return (
    <div ref={boxRef} className={`overflow-hidden ${className}`} data-edited-media={settings ? 'edited' : 'plain'}>
      {mediaType === 'video' ? (
        <TrimmedVideo
          src={src}
          edit={settings}
          playback={playback}
          rate={rate}
          audible={audible}
          autoPlay={autoPlay}
          enforceTrim={enforceTrim}
          crossOrigin={crossOrigin}
          className={mediaCls}
          style={style}
          videoRef={videoRef}
          onEnded={onEnded}
          onLoaded={onLoaded}
        />
      ) : (
        <img
          src={src}
          alt=""
          draggable={false}
          crossOrigin={crossOrigin}
          onError={onImageError}
          onLoad={(e) => onLoaded?.(e.currentTarget)}
          className={mediaCls}
          style={style}
        />
      )}
      <EditOverlays edit={settings} />
    </div>
  );
}

/** Keeps a muted autoplay going: the start is retried when the clip is ready and at the next click, as the projector always has. */
function startPlaying(video: HTMLVideoElement) {
  if (video.paused && !video.ended) {
    video.play().catch((err: unknown) => {
      // A start with sound can be refused; the picture matters more, so it plays muted instead.
      if (!video.muted) {
        video.muted = true;
        void video.play().catch(() => undefined);
      } else {
        console.warn('[background] play() was refused', { url: video.currentSrc, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }
}

function TrimmedVideo({
  src,
  edit,
  playback,
  rate,
  audible,
  autoPlay,
  enforceTrim,
  crossOrigin,
  className,
  style,
  videoRef,
  onEnded,
  onLoaded,
}: {
  src: string;
  edit: MediaEditSettings | null;
  playback: Playback;
  rate: number;
  audible: boolean;
  autoPlay: boolean;
  enforceTrim: boolean;
  crossOrigin?: 'anonymous';
  className: string;
  style: CSSProperties;
  videoRef?: MutableRefObject<HTMLVideoElement | null>;
  onEnded?: () => void;
  onLoaded?: (el: HTMLVideoElement) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // The latest values for the frame loop, which runs outside React.
  const live = useRef({ edit, playback, enforceTrim, audible, onEnded, ended: false });
  live.current = { ...live.current, edit, playback, enforceTrim, audible, onEnded };
  const nativeLoop = !edit || usesNativeLoop(edit, playback) || !enforceTrim;
  const speed = Math.min(2, Math.max(0.25, Number.isFinite(rate) ? rate : 1));
  const volume = edit && audible ? edit.volume / 100 : 0;

  useEffect(() => {
    const video = ref.current;
    if (video && video.playbackRate !== speed) video.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = volume === 0;
    video.defaultMuted = volume === 0;
    if (volume === 0) video.setAttribute('muted', '');
    else video.removeAttribute('muted');
    video.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  // Autoplay, retried as the projector always did.
  useEffect(() => {
    const video = ref.current;
    if (!video || !autoPlay) return;
    video.playsInline = true;
    const start = () => startPlaying(video);
    start();
    video.addEventListener('canplay', start);
    document.addEventListener('pointerdown', start);
    return () => {
      video.removeEventListener('canplay', start);
      document.removeEventListener('pointerdown', start);
    };
  }, [src, autoPlay]);

  // The trim window and fades, checked on every decoded frame (or animation frame where that callback is missing).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let stopped = false;
    let handle = 0;
    // Older typings lack the per-frame callback, so its presence is checked at run time.
    const v = video as unknown as { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
    const perFrame = typeof v.requestVideoFrameCallback === 'function';
    const schedule = () => {
      if (stopped) return;
      handle = perFrame ? v.requestVideoFrameCallback!(tick) : window.requestAnimationFrame(tick);
    };
    const tick = () => {
      const { edit: e, playback: pb, enforceTrim: enforce, audible: loud } = live.current;
      if (e && enforce && Number.isFinite(video.duration)) {
        const action = trimPlaybackAction(video.currentTime, e, video.duration, pb);
        if (action === 'seek-start') {
          video.currentTime = resolveTrimWindow(e, video.duration).start;
          if (pb === 'loop' && video.paused && autoPlay) startPlaying(video);
        } else if (action === 'end' && !live.current.ended) {
          live.current.ended = true;
          video.pause();
          if (pb === 'once') live.current.onEnded?.();
        }
        const fade = fadeOpacityAt(video.currentTime, e, video.duration);
        video.style.opacity = fade < 1 ? fade.toFixed(3) : '';
        if (loud && e.volume > 0) video.volume = Math.min(1, (e.volume / 100) * fade);
      } else if (video.style.opacity) {
        video.style.opacity = '';
      }
      schedule();
    };
    // While paused no frames are decoded, so a paused video is also checked when it seeks.
    const onSeeked = () => {
      if (video.paused) tick();
    };
    video.addEventListener('seeked', onSeeked);
    schedule();
    return () => {
      stopped = true;
      video.removeEventListener('seeked', onSeeked);
      if (perFrame) v.cancelVideoFrameCallback?.(handle);
      else window.cancelAnimationFrame(handle);
    };
  }, [src, autoPlay]);

  return (
    <video
      ref={(el) => {
        ref.current = el;
        if (videoRef) videoRef.current = el;
      }}
      src={src}
      muted={volume === 0}
      autoPlay={autoPlay}
      playsInline
      loop={nativeLoop && playback === 'loop'}
      preload="auto"
      controls={false}
      crossOrigin={crossOrigin}
      onLoadedMetadata={(e) => {
        const video = e.currentTarget;
        video.playbackRate = speed;
        live.current.ended = false;
        // A clip with an in point starts there, not at 0.
        if (edit && enforceTrim) {
          const { start } = resolveTrimWindow(edit, video.duration);
          if (start > 0 && video.currentTime < start) video.currentTime = start;
        }
      }}
      onLoadedData={(e) => onLoaded?.(e.currentTarget)}
      onEnded={(e) => {
        const video = e.currentTarget;
        // Without native loop (a trimmed clip), the end of the file loops back to the in point.
        if (playback === 'loop' && edit && enforceTrim) {
          video.currentTime = resolveTrimWindow(edit, video.duration).start;
          startPlaying(video);
          return;
        }
        if (!live.current.ended) {
          live.current.ended = true;
          if (playback === 'once') onEnded?.();
        }
      }}
      onError={(e) => console.error('Video playback error:', e.currentTarget.error ?? e)}
      className={className}
      style={style}
    />
  );
}
