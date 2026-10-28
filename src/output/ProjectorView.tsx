import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Frame, MediaFrame, SlideLine } from '../../shared/live.js';
import { useOutput } from './outputState';
import { translate } from '../i18n/strings';
import { LOGO_SRC } from '../brand/logo';
import { getSlideImageUrl, onSlideImageError } from './slideImage';
import { LowerThirdOverlay } from './LowerThirdView';
import { customSizes, fontCss } from '../../shared/text-style.js';
import { charsPerLine, slideLine, slideText } from '../../shared/text-wrap.js';
import { aspectRatioOf, type ProjectorSettings } from '../../shared/projector-settings.js';
import { NoteCallout } from './NoteCallout';
import { WelcomeFrame } from './WelcomeScreen';
import { SlideCanvas } from '../whiteboard/SlideCanvas';
import type { NoteOverlay } from '../../shared/live.js';
import type { TextStyle } from '../../shared/text-style';
import { PwSlideFace } from '../praise-worship/PwSlideFace';
import { lyricBottomOf } from '../../shared/lyric-area.js';
import { textAreaShare } from '../../shared/text-area.js';
import { welcomeBackground } from '../../shared/welcome-settings.js';
import { SlideBackgroundLayer } from './BackgroundMedia';

/** How long clearing the foreground takes to fade out. Keep in step with `duration-300` below. */
export const FOREGROUND_FADE_MS = 300;

const IDLE: Frame = { kind: 'idle' };

/** Frames made of text. These leave room for a lower third at the bottom left. Pictures and video are left full size. */
const TEXT_FRAME_KINDS = new Set<Frame['kind']>(['text', 'deck', 'lyrics', 'psalm', 'rosary', 'whiteboard']);

/**
 * Scripture, readings, psalm responses and citations are set in Cormorant Garamond (serif). Commentary
 * and Mass parts stay in the sans face. The paginator measures reader lines in serif, so keep these in step.
 */
const LINE_STYLE: Record<SlideLine['role'], string> = {
  priest: 'text-white/70 italic font-normal',
  reader: 'font-serif font-semibold text-white',
  cantor: 'text-white/80 font-medium',
  all: 'text-white font-bold',
  response: 'font-serif font-bold text-gold',
  cite: 'font-serif font-semibold tracking-wide text-gold',
  plain: 'text-white font-medium',
};

/** Dual-layer legibility: a dark shadow under every line so white type stays sharp over motion. */
const LEGIBLE = 'drop-shadow-[0_4px_12px_rgba(0,0,0,0.95)]';

/**
 * A soft dark card behind the text. It is absolutely positioned, so it adds no size to the text
 * column and the paginator's measurements stay exact.
 */
const BACKING = 'pointer-events-none absolute -top-[3cqh] -bottom-[3cqh] -left-[3cqw] -right-[3cqw] rounded-[2cqw] bg-black/35';

/**
 * Projected text, one paragraph per line. The sizes here are the ones the paginator
 * measures against (see paginate.ts). Empty lines keep their height.
 */
function TextLines({ lines, serif = false, style = null }: { lines: string[]; serif?: boolean; style?: TextStyle | null }) {
  // A chosen style replaces the default size, face, colour and alignment. Without one, the default classes apply.
  const sizes = customSizes(style);
  const chars = charsPerLine(0.86, sizes ? sizes.body : 4.1 * 19.2);
  return (
    <div className="relative shrink-0">
      <div aria-hidden className={BACKING} />
      <div
        className={`relative flex max-w-[86cqw] flex-col gap-[2.2cqh] leading-[1.22] text-white ${
          sizes ? '' : 'text-center text-[clamp(28px,4.1cqw,88px)]'
        } ${serif ? 'font-serif font-semibold' : 'font-medium'}`}
        style={{
          textAlign: style?.textAlign ?? undefined,
          color: style?.textColor,
          fontFamily: fontCss(style),
          fontSize: sizes ? `${sizes.body / 19.2}cqw` : undefined,
        }}
      >
        {lines.map((line, i) => (
          <p key={i} className={LEGIBLE}>
            {slideLine(line, chars) || ' '}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * A document slide: a large headline over the body, on the same glass card as other text. The body is one
 * line per paragraph, and each size is relative to the window, so the mirror fits it the same way.
 */
function HeadedText({ headline, body, style = null }: { headline: string; body: string; style?: TextStyle | null }) {
  const sizes = customSizes(style);
  const chars = charsPerLine(0.86, sizes ? sizes.body : 3.6 * 19.2);
  const headlineChars = charsPerLine(0.86, sizes ? sizes.headline : 4.6 * 19.2);
  const look = { color: style?.textColor, fontFamily: fontCss(style), textAlign: style?.textAlign ?? undefined };
  return (
    <div className="relative flex max-w-[86cqw] flex-col items-center gap-[3cqh] text-center" style={{ textAlign: look.textAlign }}>
      <div aria-hidden className={BACKING} />
      <h2
        className={`relative leading-[1.1] font-bold text-white ${sizes ? '' : 'text-[clamp(36px,4.6cqw,96px)]'} ${LEGIBLE}`}
        style={{ ...look, fontSize: sizes ? `${sizes.headline / 19.2}cqw` : undefined }}
      >
        {slideLine(headline, headlineChars)}
      </h2>
      {body && (
        <div
          className={`relative flex flex-col gap-[2.2cqh] leading-[1.25] font-medium text-white ${sizes ? '' : 'text-[clamp(28px,3.6cqw,80px)]'}`}
          style={{ ...look, fontSize: sizes ? `${sizes.body / 19.2}cqw` : undefined }}
        >
          {body.split('\n').map((line, i) => (
            <p key={i} className={LEGIBLE}>
              {slideLine(line, chars) || ' '}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Reading lines. A chosen style sets the face, size, alignment and the colour of the text. Responses and citations keep
 * their own colours. With no style, the default classes apply.
 */
function Slide({ lines, style = null }: { lines: SlideLine[]; style?: TextStyle | null }) {
  const sizes = customSizes(style);
  const chars = charsPerLine(0.86, sizes ? sizes.body : 4.1 * 19.2);
  return (
    <div className="relative shrink-0">
      <div aria-hidden className={BACKING} />
      <div
        className={`relative flex max-w-[86cqw] flex-col gap-[2.2cqh] leading-[1.22] ${sizes ? '' : 'text-center text-[clamp(28px,4.1cqw,88px)]'}`}
        style={{ textAlign: style?.textAlign ?? 'center', fontFamily: fontCss(style), fontSize: sizes ? `${sizes.body / 19.2}cqw` : undefined }}
      >
        {lines.map((line, i) => {
          const color = line.role === 'response' || line.role === 'cite' ? undefined : style?.textColor;
          return (
            <p key={i} className={`${LINE_STYLE[line.role]} ${LEGIBLE}`} style={color ? { color } : undefined}>
              {line.role === 'response' && <span className="mr-[0.4em]">℟</span>}
              {slideLine(line.text, chars) || ' '}
            </p>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A label above a text block. The text starts at the largest size that fits its space, and shrinks until it does,
 * so no prayer runs into the header or the bead row. Sizes are relative to the window width, so the mirror,
 * which is zoomed to the 1920 page, fits its text the same way the projector does.
 */
function FittedPrayer({ label, text, className, style = null }: { label: string; text: string; className: string; style?: TextStyle | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const labelEl = labelRef.current;
    const el = textRef.current;
    if (!box || !labelEl || !el) return;
    const fit = () => {
      const room = box.clientHeight - labelEl.offsetHeight - 24;
      // A chosen size is the most the prayer grows to. The fit still shrinks it when the text is long.
      const width = box.clientWidth;
      const max = style?.fontSize ? (width * style.fontSize) / 1920 : width * 0.045;
      const min = window.innerWidth * 0.016;
      let size = max;
      el.style.fontSize = `${size}px`;
      while (el.offsetHeight > room && size > min) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    // The mirror's zoom is set after the page loads, which changes the window width. Fit again on every resize.
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [label, text, style]);

  const look = { color: style?.textColor, fontFamily: fontCss(style), textAlign: style?.textAlign ?? undefined };
  return (
    <div ref={boxRef} className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
      <div ref={labelRef} className="shrink-0 font-mono text-[1.1cqw] font-bold tracking-[0.25em] text-white/70 uppercase">{label}</div>
      <p ref={textRef} className={`mt-[1.5cqh] ${className}`} style={look}>{slideText(text, charsPerLine(0.84, 4.5 * 19.2))}</p>
    </div>
  );
}

function FrameView({ frame }: { frame: Frame }) {
  // The background behind the Live set's slides: its own saved setting, separate from the Welcome background.
  const pwBackground = welcomeBackground(useOutput((s) => s.welcome.slideBackground));
  switch (frame.kind) {
    case 'idle':
    case 'blackout':
      return null;
    case 'welcome':
      // The welcome screen's own content, colours and size, from the Welcome screen settings.
      return <WelcomeFrame />;
    case 'announcements':
      // Placeholder until the Announcements module feeds a rotating playlist here.
      return <div className="text-[6cqw] font-black uppercase condensed">{translate(frame.lang, 'proj.announcements')}</div>;
    case 'image':
      return (
        <img
          src={getSlideImageUrl(frame.src)}
          onError={onSlideImageError}
          alt={frame.title}
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      );
    case 'psalm':
      // The response is pinned to the top in gold, so the congregation always knows what to sing.
      return (
        <>
          {frame.style?.bgColor && <div className="absolute inset-0" style={{ backgroundColor: frame.style.bgColor }} />}
          <div className="absolute inset-x-0 top-0 flex flex-col items-center px-[6cqw] pt-[5cqh] text-center">
            <div className="font-mono text-[1cqw] font-bold tracking-[0.25em] text-gold/80 uppercase">Congregation response</div>
            <p className={`mt-[1.5cqh] max-w-[88cqw] font-serif text-[clamp(28px,3.6cqw,76px)] leading-[1.2] font-bold text-gold ${LEGIBLE}`}>
              <span className="mr-[0.4em]">℟</span>
              {slideLine(frame.response, charsPerLine(0.86, 3.6 * 19.2))}
            </p>
          </div>
          <div className="absolute inset-x-0 top-[34cqh] bottom-0 flex items-center justify-center px-[6cqw]">
            <TextLines serif lines={(frame.pages[frame.index] ?? '').split('\n')} style={frame.style} />
          </div>
          {frame.pages.length > 1 && (
            <div className="absolute right-[4cqw] bottom-[3cqh] font-mono text-[1cqw] text-white/40">
              {frame.index + 1} / {frame.pages.length}
            </div>
          )}
        </>
      );
    case 'lyrics': {
      // Centred by default. The shadow keeps the text legible over moving backgrounds. A song's own style replaces the
      // default size, face, colour and alignment, and keeps the shadow.
      const sizes = customSizes(frame.style);
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-[6cqw] text-center" style={{ textAlign: frame.style?.textAlign ?? 'center' }}>
          <div className="mb-[3cqh] font-mono text-[1.1cqw] font-bold tracking-[0.25em] text-white/70 uppercase">{frame.label}</div>
          <p
            className={`max-w-[88cqw] leading-[1.18] font-bold whitespace-pre-line ${sizes ? '' : 'text-[clamp(36px,4.6cqw,96px)] text-white'}`}
            style={{
              textShadow: '0 2px 14px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.6)',
              color: frame.style?.textColor,
              fontFamily: fontCss(frame.style),
              fontSize: sizes ? `${sizes.body / 19.2}cqw` : undefined,
              textAlign: frame.style?.textAlign ?? 'center',
            }}
          >
            {slideText(frame.text, charsPerLine(0.88, sizes ? sizes.body : 4.6 * 19.2))}
          </p>
        </div>
      );
    }
    case 'text':
      return (
        <>
          {frame.bg ? (
            <>
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${frame.bg}")`, backgroundSize: 'cover' }} />
              <div className="absolute inset-0 bg-black/60" />
            </>
          ) : (
            // A chosen background colour fills the slide when there is no background image.
            frame.style?.bgColor && <div className="absolute inset-0" style={{ backgroundColor: frame.style.bgColor }} />
          )}
          {/* A prayer's page (a Notes & Prayers slide) starts at its top, the same rule as the lineup: a shared top, or centred when short. Other text is centred on the frame. */}
          <div
            className={frame.key?.startsWith('prayer:') ? 'absolute inset-x-0 flex flex-col items-center' : 'relative flex items-center justify-center'}
            style={frame.key?.startsWith('prayer:') ? { top: `${(frame.top ?? textAreaShare().top) * 100}%` } : undefined}
          >
            {frame.headline ? (
              <HeadedText headline={frame.headline} body={frame.text} style={frame.style} />
            ) : (
              <TextLines lines={frame.text.split('\n')} style={frame.style} />
            )}
          </div>
          {/* A prayer split into slides shows its place, as the psalm pages do. */}
          {frame.page && frame.page.total > 1 && (
            <div className="absolute right-[4cqw] bottom-[3cqh] font-mono text-[1cqw] text-white/40">
              {frame.page.index + 1} / {frame.page.total}
            </div>
          )}
        </>
      );
    case 'pw':
      // A Praise & Worship slide. It draws its own background, so it fills the stage.
      return <PwSlideFace slide={frame.slide} segmentName={frame.segmentName} type={frame.type} index={frame.index} total={frame.total} footer={frame.footer} background={pwBackground} />;
    case 'whiteboard':
      // Sized to the space the screen leaves, so the lower-third clearance on the parent shortens it too.
      return (
        <div className="h-full w-full">
          <SlideCanvas slide={frame.slide} className="h-full w-full" />
        </div>
      );

    case 'rosary': {
      // One column: header at the top, the prayer in the space between the header and the beads, beads at the bottom.
      // It fills its parent rather than the screen, so the lower-third clearance on the parent shortens it too.
      return (
        <div
          className="flex h-full w-full flex-col items-center px-[6cqw] pt-[5cqh] pb-[5cqh] text-center"
          style={{ textShadow: '0 2px 14px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.6)' }}
        >
          <div className="shrink-0">
            <div className="font-mono text-[1cqw] font-bold tracking-[0.25em] text-gold uppercase">
              {frame.section}
              {frame.decade && ` · ${frame.decade}`}
            </div>
            {frame.mystery && (
              <div className="mt-[1cqh] font-serif text-[clamp(32px,3.6cqw,80px)] leading-none font-semibold tracking-wide text-gold">{frame.mystery}</div>
            )}
            {frame.scripture && <div className="mt-[0.8cqh] font-serif text-[1.3cqw] tracking-wide text-gold/80 italic">{frame.scripture}</div>}
          </div>
          <FittedPrayer
            label={frame.prayer}
            text={frame.text}
            style={frame.style}
            className={`max-w-[84cqw] font-serif leading-[1.3] whitespace-pre-line ${frame.style?.textColor ? '' : 'text-white'} ${frame.stage === 'announce' ? 'font-medium' : 'font-semibold'}`}
          />
          {frame.bead !== null && (
            <div className="mt-[2cqh] flex shrink-0 items-center justify-center gap-[1.2cqw]" aria-label={`${frame.bead} / 10`}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <span
                  key={n}
                  className={`size-[1.3cqw] rounded-full border-2 border-gold ${
                    n < frame.bead! ? 'bg-gold/60' : n === frame.bead ? 'bg-gold shadow-[0_0_18px_rgba(236,201,138,0.9)]' : 'bg-transparent'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      );
    }
    case 'deck': {
      const lines = frame.slides[frame.index] ?? [];
      return (
        <>
          {frame.style?.bgColor && <div className="absolute inset-0" style={{ backgroundColor: frame.style.bgColor }} />}
          <div className="absolute top-[4cqh] left-[4cqw] text-[1.2cqw] font-bold tracking-[0.2em] text-white/50 uppercase">{frame.title}</div>
          <Slide lines={lines} style={frame.style} />
          {frame.slides.length > 1 && (
            <div className="absolute right-[4cqw] bottom-[4cqh] font-mono text-[1cqw] text-white/40">
              {frame.index + 1} / {frame.slides.length}
            </div>
          )}
        </>
      );
    }
  }
}

/**
 * Keeps the last foreground frame on screen while it fades out after a clear, so text
 * does not snap off mid-Mass. Blackout and new content still switch instantly.
 */
function useFadedFrame(live: Frame, fadeMs: number) {
  const [shown, setShown] = useState<Frame>(live);
  const [fading, setFading] = useState(false);
  // Counts each new foreground frame, so the foreground re-mounts and plays its entrance animation.
  const [serial, setSerial] = useState(0);
  // Every state update from the main process brings a fresh copy of the frame, so the object's identity changes even when
  // the frame does not (a queue edit, for example). The content key tells a new frame apart, so only a real change replays.
  const key = JSON.stringify(live);
  const latest = useRef(live);
  latest.current = live;

  useEffect(() => {
    const frame = latest.current;
    if (frame.kind !== 'idle') {
      setShown(frame);
      setFading(false);
      setSerial((n) => n + 1);
      return;
    }
    setFading(true);
    const timer = window.setTimeout(() => {
      setShown(IDLE);
      setFading(false);
    }, fadeMs);
    return () => window.clearTimeout(timer);
  }, [key, fadeMs]);

  return { frame: shown, fading, serial };
}

/** The note overlay, kept on screen while it fades out so a cleared note does not snap away. A new note fades in. */
function useFadedNote(live: NoteOverlay | null, fadeMs: number) {
  const [shown, setShown] = useState<NoteOverlay | null>(live);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (live) {
      setShown(live);
      setVisible(false);
      // One frame later the note is visible, so it fades in rather than appearing.
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setShown(null), fadeMs);
    return () => window.clearTimeout(timer);
  }, [live, fadeMs]);

  return { shown, visible };
}

/** Looping motion (or a still) behind the foreground. Plays muted so it can autoplay. */
function BackgroundLayer({ media }: { media: MediaFrame }) {
  return media.mediaType === 'video' ? (
    <video
      key={media.src}
      src={media.src}
      autoPlay
      loop
      muted
      playsInline
      controls={false}
      preload="auto"
      onError={(e) => console.error('Video playback error:', e.currentTarget.error ?? e)}
      className="absolute inset-0 -z-10 h-full w-full object-cover"
    />
  ) : (
    <img key={media.src} src={getSlideImageUrl(media.src)} onError={onSlideImageError} alt="" draggable={false} className="absolute inset-0 -z-10 h-full w-full object-cover" />
  );
}

const ENTER_ANIMATION: Record<ProjectorSettings['transitionStyle'], string> = {
  fade: 'apcc-enter-fade',
  slideLeft: 'apcc-enter-left',
  slideRight: 'apcc-enter-right',
  slideUp: 'apcc-enter-up',
  zoomIn: 'apcc-enter-zoom',
};

/** The entrance animation for a new foreground frame. A zero duration (transitions off) means none. */
const enterAnimation = (style: ProjectorSettings['transitionStyle'], ms: number) =>
  ms > 0 ? `${ENTER_ANIMATION[style]} ${ms}ms ease-out both` : undefined;

/** What shows when nothing is live: black (nothing), the parish crest, or a static image from the Media Library. */
function IdleScreen({ mode, media }: { mode: ProjectorSettings['idle']; media: string | null }) {
  if (mode === 'crest') {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <img src={LOGO_SRC} alt="" draggable={false} className="h-[40cqh] w-auto opacity-90" />
      </div>
    );
  }
  if (mode === 'media' && media) {
    return <img src={getSlideImageUrl(media)} onError={onSlideImageError} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />;
  }
  return null;
}

/** A calibration pattern for aligning the projector: a 10% grid, a dashed safe area, and a centre cross. */
function CalibrationGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[60]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)',
          backgroundSize: '10% 10%',
        }}
      />
      <div className="absolute inset-[5%] border-2 border-dashed border-amber-300/80" />
      <div className="absolute top-1/2 left-0 h-px w-full bg-red-500/80" />
      <div className="absolute top-0 left-1/2 h-full w-px bg-red-500/80" />
      <div className="absolute top-[3cqh] left-[3cqw] font-mono text-[1.2cqw] font-bold tracking-[0.2em] text-red-400 uppercase">Calibration grid</div>
    </div>
  );
}

/** Congregation screen. With `mirror`, the same view becomes the operator's confidence monitor. */
export function ProjectorView({ mirror = false, embedded = false }: { mirror?: boolean; embedded?: boolean }) {
  const projector = useOutput((s) => s.projector);
  const projectorOn = useOutput((s) => s.outputs.projector);
  const settings = useOutput((s) => s.settings);
  const calibration = useOutput((s) => s.calibration);
  const counter = useOutput((s) => s.counter);
  const noteOverlay = useOutput((s) => s.noteOverlay);
  // Transitions off means changes switch at once, so the fade and the entrance both take no time.
  const transitionMs = settings.transitionsOn ? settings.fadeMs : 0;
  // While the projector is paused, the operator's mirror shows the staged frame, so it follows every change. The projector
  // itself keeps the frame it was showing until it resumes.
  const picture = mirror && projector.paused ? projector.staged : projector.live;
  const { frame, fading, serial } = useFadedFrame(picture, transitionMs);

  // Blackout hides the background as well as the foreground, and keeps it queued for when it lifts.
  const blackedOut = picture.kind === 'blackout';
  // The Live set's background picture or video: one layer for the whole slide sequence, kept outside the slides so a slide change never restarts it.
  const slideMedia = welcomeBackground(useOutput((s) => s.welcome.slideBackground)).media;
  // The projector output shows nothing while its master switch is OFF, whatever the live buffer holds.
  // The operator mirror is a separate monitor with its own toggle, so it is not gated by this switch.
  const outputShowing = mirror || projectorOn;
  const background = blackedOut || !outputShowing ? null : projector.background?.live ?? null;
  const shownFrame = outputShowing ? frame : IDLE;
  // The lower third is drawn over the picture while it is live. Blackout and a switched-off projector hide it,
  // and it fades out rather than cutting.
  const lowerThirdLive = useOutput((s) => s.lowerThird.live);
  const lowerThirdValue = outputShowing && !blackedOut ? lowerThirdLive : null;
  // A note overlay is drawn over the picture while it is sent. Text clears it the same way it clears a lower third.
  const noteLive = outputShowing && !blackedOut ? noteOverlay : null;
  const noteFaded = useFadedNote(noteLive, settings.fadeMs);
  // While a lower third is on, text moves clear of it. Other text centres in the space above it. A scripture
  // passage moves up by 18% of the screen height, so the verses sit clear of the nameplate.
  const raised = Boolean(lowerThirdValue || noteLive);
  const clearance = !raised
    ? ''
    : shownFrame.kind === 'deck' && shownFrame.passage
      ? '-translate-y-[18cqh]'
      : TEXT_FRAME_KINDS.has(shownFrame.kind)
        ? 'pb-[18cqh]'
        : '';

  const ratio = aspectRatioOf(settings.aspect);
  // Contain: the largest box of the chosen ratio that fits the window, centred on black. Fill: the whole window.
  const stageStyle =
    embedded || settings.fit === 'fill'
      ? { width: '100%', height: '100%' }
      : { width: `min(100vw, calc(100vh * ${ratio}))`, height: `min(100vh, calc(100vw / ${ratio}))` };

  return (
    <div
      className={`relative isolate flex items-center justify-center overflow-hidden text-white select-none ${
        embedded ? 'h-full w-full' : 'h-screen w-screen'
      } ${mirror ? 'bg-stone-950' : 'bg-black'} ${mirror || embedded ? '' : 'cursor-none'}`}
    >
    {/* Every size inside the stage is a share of the stage, so text keeps its proportions in any window. */}
    <div className="relative isolate overflow-hidden [container-type:size]" style={stageStyle}>
      {background && <BackgroundLayer media={background} />}
      {slideMedia && <SlideBackgroundLayer media={slideMedia} visible={outputShowing && !blackedOut && shownFrame.kind === 'pw'} />}
      {/* A song's or prayer's background colour fills the screen only when no motion background is playing, so it never covers the media. */}
      {!background && shownFrame.kind === 'idle' && <IdleScreen mode={settings.idle} media={settings.idleMedia} />}
      {!background && (shownFrame.kind === 'lyrics' || shownFrame.kind === 'rosary') && shownFrame.style?.bgColor && (
        <div className="absolute inset-0" style={{ backgroundColor: shownFrame.style.bgColor }} />
      )}

      <div
        key={serial}
        className={`absolute inset-0 flex items-center justify-center transition-[padding,opacity,transform] ${
          fading ? 'opacity-0' : 'opacity-100'
        } ${clearance}`}
        style={{ transitionDuration: `${transitionMs}ms`, animation: enterAnimation(settings.transitionStyle, transitionMs) }}
      >
        {background && <div className="absolute inset-0 bg-black/40" />}
        <FrameView frame={shownFrame} />
      </div>

      <LowerThirdOverlay value={lowerThirdValue} lyricBottomShare={lyricBottomOf(shownFrame)} />

      {calibration && <CalibrationGrid />}

      {noteFaded.shown && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-[45] flex justify-center transition-opacity ease-in-out ${noteFaded.visible ? 'opacity-100' : 'opacity-0'}`}
          style={{ bottom: lowerThirdValue ? '24cqh' : '5cqh', transitionDuration: `${settings.fadeMs}ms` }}
        >
          <NoteCallout value={noteFaded.shown} />
        </div>
      )}

      {counter?.show && counter.index > 0 && (shownFrame.kind === 'text' || shownFrame.kind === 'image') && (
        <div className="pointer-events-none absolute right-[3cqw] bottom-[3cqh] z-[40] rounded-full border border-white/15 bg-black/50 px-[1.2cqw] py-[0.6cqh] font-mono text-[1.1cqw] font-semibold tracking-wide text-white/80">
          Slide {counter.index} / {counter.total}
        </div>
      )}

      {/* Operator mirror only: the presenter's cues along the bottom edge. The congregation screen never renders notes. */}
      {mirror && shownFrame.kind === 'text' && shownFrame.notes?.trim() && (
        <div className="absolute inset-x-0 bottom-0 z-10 max-h-[32%] overflow-y-auto border-t border-white/15 bg-black/85 px-[2cqw] py-[1.2cqh]">
          <p className="font-mono text-[0.8cqw] font-extrabold tracking-[0.16em] text-white/60 uppercase">Speaker notes</p>
          <p className="mt-[0.6cqh] text-[1.35cqw] leading-snug whitespace-pre-line text-white/90">{shownFrame.notes}</p>
        </div>
      )}

      {/* Status badges for the operator mirror, top-left. They follow the live state as it changes. */}
      {mirror && !embedded && (
        <div className="absolute top-[1.2cqw] left-[1.2cqw] z-10 flex gap-[0.5cqw] font-mono text-[0.9cqw] font-extrabold tracking-[0.16em] uppercase">
          <span className="rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-white/80">Mirror</span>
          {projectorOn && !blackedOut && (
            <span className="rounded-full bg-[#10b981] px-2 py-0.5 text-black shadow-[0_0_10px_#10b981]">Live</span>
          )}
          {projector.paused && <span className="rounded-full bg-amber px-2 py-0.5 text-on-accent">Paused</span>}
          {blackedOut && <span className="rounded-full bg-crimson px-2 py-0.5 text-white">Blackout</span>}
        </div>
      )}
    </div>
    </div>
  );
}
