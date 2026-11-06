import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TEXT_SHADE_OPACITY, type WelcomeBackground } from '../../shared/welcome-settings.js';
import { getSlideImageUrl } from './slideImage';
import { clearMediaFailed, reportMediaFailed } from './mediaStatus';
import { describeMediaError } from '../../shared/media-error.js';
import { boxShadeStyle, gradientShadeStyle, useShade, type ShadeTarget } from '../components/ContrastEngine';

/**
 * The picture or video behind the text, covering its box. Shared by the Welcome screen and the Live slides, so every surface draws the
 * background the same way. A video is muted, has no controls, starts by itself, and loops only when `loop` is on: otherwise it plays once and
 * holds its last frame. If the file will not load, it is hidden so the colour behind it shows, and the setting that chose it is told.
 */
export function BackgroundMedia({ media, onFail }: { media: NonNullable<WelcomeBackground['media']>; onFail?: () => void }) {
  const src = getSlideImageUrl(media.src);
  // The source that failed. The element is hidden only while it is still that source, so a new file is shown when it loads.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src) return null;
  const fit = media.fit === 'contain' ? 'object-contain' : 'object-cover';
  const style: CSSProperties | undefined = failedSrc === src ? { visibility: 'hidden' } : undefined;
  // The reason is kept with the file, so the setting that chose it can say why it is not shown.
  const failed = (reason: string) => {
    setFailedSrc(src);
    reportMediaFailed(src, reason);
    console.warn('[background] could not show', { url: src, reason });
    onFail?.();
  };
  const loaded = () => {
    setFailedSrc(null);
    clearMediaFailed(src);
  };
  if (media.kind === 'video') {
    return (
      <BackgroundVideo
        src={src}
        loop={media.loop}
        className={`absolute inset-0 h-full w-full ${fit} object-center`}
        style={style}
        onLoaded={loaded}
        onFail={(video) => failed(describeMediaError('video', video.error ? video.error.code : null, video.networkState))}
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={loaded}
      onError={() => failed(describeMediaError('image', null))}
      style={style}
      className={`absolute inset-0 h-full w-full ${fit} object-center`}
    />
  );
}

/**
 * The background video. It starts by itself, muted: the muted state is set as a property and as an attribute, so the browser's autoplay rule
 * allows it with no click. A start that the browser still refuses is retried when the clip is ready, and at the first click on the output.
 * Changing the file loads it from its beginning and starts it. With Loop off, a clip that has ended stays on its last frame.
 */
function BackgroundVideo({
  src,
  loop,
  className,
  style,
  onLoaded,
  onFail,
}: {
  src: string;
  loop: boolean;
  className: string;
  style?: CSSProperties;
  onLoaded: () => void;
  onFail: (video: HTMLVideoElement) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;

    const start = () => {
      // A clip that has ended with Loop off holds its last frame: it is not started again.
      if (video.paused && !video.ended) {
        // A refused start is logged with the reason, and retried when the clip is ready or at the next click.
        video.play().catch((err: unknown) => console.warn('[background] play() was refused', { url: video.currentSrc, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }));
      }
    };
    const loaded = () => {
      loadedRef.current();
      start();
    };
    start();
    video.addEventListener('loadeddata', loaded);
    video.addEventListener('canplay', start);
    document.addEventListener('pointerdown', start);
    return () => {
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('canplay', start);
      document.removeEventListener('pointerdown', start);
    };
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      muted
      autoPlay
      playsInline
      loop={loop}
      onError={(event) => {
        const video = event.currentTarget;
        console.warn('[background] video error', { url: video.currentSrc, code: video.error ? video.error.code : null, networkState: video.networkState, readyState: video.readyState });
        onFail(video);
      }}
      className={className}
      style={style}
    />
  );
}

/**
 * The Live set's background picture or video, as one layer that stays mounted for the whole slide sequence. It is placed outside the slides,
 * so Next, Back and every other slide change leave it alone: the video keeps its position and play state, and its file is not reloaded.
 * It is hidden (not unmounted) when no slide is on screen, so it keeps its place for when a slide comes back. The Welcome screen does not use it.
 */
export function SlideBackgroundLayer({ media, visible }: { media: NonNullable<WelcomeBackground['media']>; visible: boolean }) {
  return (
    <div aria-hidden className={`absolute inset-0 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <BackgroundMedia media={media} />
    </div>
  );
}

/**
 * The dark shade behind text when a picture or video is behind it. `area` is a CSS box (top and height) for the shade; the default is the
 * whole box. On the projector, auto-legibility sets its darkness from the picture (`target` names whose picture this is): a whole-box shade
 * becomes a gradient, darker where the picture is bright behind a text zone, and a text-box shade takes the centre zone's darkness. In an
 * editor preview, or before the picture has been measured, it is the fixed shade.
 */
export function BackgroundShade({ area, target }: { area?: { top: string; height: string }; target: ShadeTarget }) {
  const shade = useShade(target);
  const look = area ? boxShadeStyle(shade, TEXT_SHADE_OPACITY) : gradientShadeStyle(shade, TEXT_SHADE_OPACITY);
  return <div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ ...look, ...(area ?? { top: 0, bottom: 0 }) }} />;
}
