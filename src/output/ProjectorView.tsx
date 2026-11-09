import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Frame, MediaFrame, SlideLine } from '../../shared/live.js';
import { presentedFrame, slotTitleShown } from '../../shared/live.js';
import { OnAirLook, useOutput } from './outputState';
import { dispatch } from '../live/store';
import { pwT } from '../../shared/pw-i18n.js';
import { useUi } from '../state/ui';
import { mirrorSource } from '../../shared/stage-plan-row.js';
import { translate } from '../i18n/strings';
import { LOGO_SRC } from '../brand/logo';
import { getSlideImageUrl, onSlideImageError } from './slideImage';
import { LowerThirdOverlay } from './LowerThirdView';
import { customSizes, fontCss, scaledSize, slideFontCss } from '../../shared/text-style.js';
import { charsPerLine, slideLine, slideText } from '../../shared/text-wrap.js';
import { OVERLAP_TRANSITIONS, aspectRatioOf, type ProjectorSettings } from '../../shared/projector-settings.js';
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
import { SanctuaryAlertOverlay } from './SanctuaryAlertOverlay';
import { useTextAutoFit } from './useTextAutoFit';
import { useProjectorTextAutoFit } from './useProjectorTextAutoFit';
import { useHeadedTextFit } from './useHeadedTextFit';
import { lineCountOf, lineHeightFor } from '../../shared/text-fit.js';
import { LegibilityContext, gradientShadeStyle, legibilityShadowVars, useBackgroundLegibility, type BackgroundAsset, type ShadeChoice, type ShadeTarget } from '../components/ContrastEngine';

/** The slide font the operator chose, as CSS. Undefined keeps each slide's own face. */
const useSlideFont = (): string | undefined => useOutput((s) => slideFontCss(s.settings.slideFont));

/** The operator's slide text size, as a share of normal: 0.7 to 1.5. Each text surface multiplies its size by it. */
const useSlideScale = (): number => useOutput((s) => s.settings.slideFontScale);

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

/**
 * The slot title banner above a slide's text ("FIRST READING", "CONGREGATION RESPONSE"): a quiet label, about 16px on a 1920 slide and never more
 * than 18px, so the reading or response below it keeps the slide's type scale. Colour is added where it is used.
 */
const SLOT_TITLE = 'text-[length:min(0.85cqw,18px)] font-semibold tracking-[0.22em] uppercase';

/**
 * Dual-layer legibility: a dark shadow under every line so white type stays sharp over motion. Its blur, darkness and outline follow the
 * background behind the text when auto-legibility is on (see ContrastEngine); otherwise it is the fixed 12px shadow at 95%.
 */
const LEGIBLE = 'apcc-legible';

/** The two-layer text shadow of lyric and rosary slides, grown by auto-legibility like LEGIBLE. The fallback is its fixed form. */
const LEGIBLE_TEXT_SHADOW = 'var(--apcc-legible-text-shadow, 0 2px 14px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.6))';

/** The shade the projector has always drawn over a Media Library background: the fallback until the picture is measured. */
const LIBRARY_SHADE = 0.4;

/**
 * A soft dark card behind the text. It is absolutely positioned, so it adds no size to the text
 * column and the paginator's measurements stay exact.
 */
const BACKING = 'pointer-events-none absolute -top-[3cqh] -bottom-[3cqh] -left-[3cqw] -right-[3cqw] rounded-[2cqw] bg-black/35';

/**
 * Projected text, one paragraph per line. The sizes here are the ones the paginator
 * measures against (see paginate.ts). Empty lines keep their height.
 */
function TextLines({ lines, serif = false, style = null, safe = false, inset = true }: { lines: string[]; serif?: boolean; style?: TextStyle | null; safe?: boolean; inset?: boolean }) {
  const slideFont = useSlideFont();
  const slideScale = useSlideScale();
  // A chosen style replaces the default size, face, colour and alignment. Without one, the default classes apply.
  const sizes = customSizes(style);
  const chars = charsPerLine(0.86, sizes ? sizes.body : 4.1 * 19.2);
  const naturalSize = scaledSize(sizes ? `${sizes.body / 19.2}cqw` : 'min(4.1cqw,88px)', slideScale);
  const body = (textRef?: RefObject<HTMLDivElement>) => (
    <div className="relative shrink-0">
      <div aria-hidden className={BACKING} />
      <div
        ref={textRef}
        className={`relative flex max-w-[86cqw] flex-col gap-[2.2cqh] leading-[1.22] text-white ${
          sizes ? '' : 'text-center text-[length:min(4.1cqw,88px)]'
        } ${serif ? 'font-serif font-semibold' : 'font-medium'}`}
        style={{
          textAlign: style?.textAlign ?? undefined,
          color: style?.textColor,
          fontFamily: fontCss(style) ?? slideFont,
          fontSize: naturalSize,
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
  return safe ? <SafeFit inset={inset} naturalSize={naturalSize} deps={[lines.join('\n'), style, slideFont]} render={body} /> : body();
}

/** The safe margins of a headed slide, as shares of the stage's height: clear of the edge at the top, and of the page count at the bottom. */
const HEADED_SAFE_TOP = 6;
const HEADED_SAFE_BOTTOM = 9;

/** Where a prayer's page sits: from a top (a share of the height), or centred on a height. Without one, the block is centred in the safe box. */
type HeadedPlace = { top: number } | { centre: number };

/**
 * The flexible space that places the block. It gives way first, so a block too tall for its place rises before its text is made smaller.
 */
function headedSpacers(place: HeadedPlace | null): { justify: string; before: number; after: number } {
  if (!place) return { justify: 'justify-center', before: 0, after: 0 };
  if ('top' in place) return { justify: 'justify-start', before: Math.max(0, place.top * 100 - HEADED_SAFE_TOP), after: 0 };
  // The safe box's own centre, moved to the height asked for by a space on one side.
  const shift = 2 * ((HEADED_SAFE_TOP + 100 - HEADED_SAFE_BOTTOM) / 2 - place.centre * 100);
  return { justify: 'justify-center', before: Math.max(0, -shift), after: Math.max(0, shift) };
}

/**
 * A document or prayer slide: a large headline over the body, on the same glass card as other text. The body is one line per paragraph, and each
 * size is relative to the window, so the mirror fits it the same way. Both stay inside the safe box at any text size (see useHeadedTextFit).
 */
function HeadedText({ headline, body, style = null, place = null }: { headline: string; body: string; style?: TextStyle | null; place?: HeadedPlace | null }) {
  const slideFont = useSlideFont();
  const slideScale = useSlideScale();
  const sizes = customSizes(style);
  const chars = charsPerLine(0.86, sizes ? sizes.body : 3.6 * 19.2);
  const headlineChars = charsPerLine(0.86, sizes ? sizes.headline : 4.6 * 19.2);
  const look = { color: style?.textColor, fontFamily: fontCss(style) ?? slideFont, textAlign: style?.textAlign ?? undefined };
  const titleSize = scaledSize(sizes ? `${sizes.headline / 19.2}cqw` : 'min(4.6cqw,96px)', slideScale);
  const bodySize = scaledSize(sizes ? `${sizes.body / 19.2}cqw` : 'min(3.6cqw,80px)', slideScale);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { overflow } = useHeadedTextFit({ boxRef, titleRef, bodyRef, titleSize, bodySize, deps: [headline, body, style, slideFont] });
  // True on the congregation's projector, false on the operator's mirror and previews. The warning is for the operator only.
  const audience = useContext(OnAirLook);
  const { justify, before, after } = headedSpacers(place);
  return (
    <div ref={boxRef} data-safe-fit className={`relative flex h-full w-full flex-col items-center overflow-hidden px-[6cqw] ${justify}`} style={{ paddingTop: `${HEADED_SAFE_TOP}cqh`, paddingBottom: `${HEADED_SAFE_BOTTOM}cqh` }}>
      {before > 0 && <div aria-hidden style={{ flex: `0 1 ${before}cqh` }} />}
      <div className="relative flex max-w-[86cqw] shrink-0 flex-col items-center gap-[3cqh] text-center" style={{ textAlign: look.textAlign }}>
        <div aria-hidden className={BACKING} />
        {headline && (
          <h2 ref={titleRef} className={`relative leading-[1.1] font-bold text-white ${sizes ? '' : 'text-[length:min(4.6cqw,96px)]'} ${LEGIBLE}`} style={{ ...look, fontSize: titleSize }}>
            {slideLine(headline, headlineChars)}
          </h2>
        )}
        {body && (
          <div ref={bodyRef} className={`relative flex flex-col gap-[2.2cqh] leading-[1.25] font-medium text-white ${sizes ? '' : 'text-[length:min(3.6cqw,80px)]'}`} style={{ ...look, fontSize: bodySize }}>
            {body.split('\n').map((line, i) => (
              <p key={i} className={LEGIBLE}>
                {slideLine(line, chars) || ' '}
              </p>
            ))}
          </div>
        )}
      </div>
      {after > 0 && <div aria-hidden style={{ flex: `0 1 ${after}cqh` }} />}
      {!audience && overflow && <TextFitBadge />}
    </div>
  );
}

/**
 * Reading lines. A chosen style sets the face, size, alignment and the colour of the text. Responses and citations keep
 * their own colours. With no style, the default classes apply.
 */
function Slide({ lines, style = null, safe = false, header = true }: { lines: SlideLine[]; style?: TextStyle | null; safe?: boolean; header?: boolean }) {
  const slideFont = useSlideFont();
  const slideScale = useSlideScale();
  const sizes = customSizes(style);
  const chars = charsPerLine(0.86, sizes ? sizes.body : 4.1 * 19.2);
  const naturalSize = scaledSize(sizes ? `${sizes.body / 19.2}cqw` : 'min(4.1cqw,88px)', slideScale);
  const body = (textRef?: RefObject<HTMLDivElement>) => (
    <div className="relative shrink-0">
      <div aria-hidden className={BACKING} />
      <div
        ref={textRef}
        className={`relative flex max-w-[86cqw] flex-col gap-[2.2cqh] leading-[1.22] ${sizes ? '' : 'text-center text-[length:min(4.1cqw,88px)]'}`}
        style={{ textAlign: style?.textAlign ?? 'center', fontFamily: fontCss(style) ?? slideFont, fontSize: naturalSize }}
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
  return safe ? <SafeFit header={header} naturalSize={naturalSize} deps={[JSON.stringify(lines), style, slideFont]} render={body} /> : body();
}

/**
 * The safe box a Holy Mass Order or text slide is drawn in: the whole slide less a margin at the top (clear of the title and slot name), at the
 * bottom (clear of the page count and the operator's badges) and at the sides. It fills its parent, so a lower third on air, which raises the
 * parent's bottom, shrinks it too. The text inside steps down in size until it fits (see useProjectorTextAutoFit). With `header` off (the slot
 * title hidden) the top margin is smaller, so the text has more of the slide. With `inset` off the parent has already kept the top and the sides clear
 * (the psalm, under its response), and only the bottom margin is left.
 */
function SafeFit({ naturalSize, deps, render, header = true, inset = true }: { naturalSize: string; deps: unknown[]; render: (textRef: RefObject<HTMLDivElement>) => ReactNode; header?: boolean; inset?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const { overflow } = useProjectorTextAutoFit({ boxRef, textRef, naturalSize, deps: [...deps, header] });
  // True on the congregation's projector, false on the operator's mirror and previews. The warning is for the operator only.
  const audience = useContext(OnAirLook);
  return (
    <div ref={boxRef} data-safe-fit className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden pb-[9cqh] ${!inset ? '' : header ? 'px-[6cqw] pt-[9cqh]' : 'px-[6cqw] pt-[6cqh]'}`}>
      {render(textRef)}
      {!audience && overflow && <TextFitBadge />}
    </div>
  );
}

/** The operator's warning on a slide whose text is still too long at the smallest size: its last lines are cut off. Never on the projector. */
function TextFitBadge() {
  const lang = useUi((s) => s.lang);
  return (
    <span
      data-operator-only
      role="status"
      title="This slide is too long even at the smallest size. Shorten its words, or put a blank line in the Holy Mass Order editor to start a new slide."
      className="absolute right-[1.5cqw] bottom-[1.5cqh] z-20 inline-flex items-center gap-[0.5cqw] rounded-full border border-amber-300/70 bg-amber-500/90 px-[1.1cqw] py-[0.5cqh] text-[max(10px,1.05cqw)] font-bold text-stone-950 shadow-lg"
    >
      <span aria-hidden>⚠</span>
      {pwT(lang, 'textCutOff')}
    </span>
  );
}

/**
 * A label above a text block. The text starts at the largest size that fits its space, and shrinks until it does,
 * so no prayer runs into the header or the bead row. Sizes are relative to the window width, so the mirror,
 * which is zoomed to the 1920 page, fits its text the same way the projector does. An empty label (the title hidden) gives the text its room.
 */
function FittedPrayer({ label, text, className, style = null }: { label: string; text: string; className: string; style?: TextStyle | null }) {
  const slideFont = useSlideFont();
  const slideScale = useSlideScale();
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const labelEl = labelRef.current;
    const el = textRef.current;
    if (!box || !el) return;
    const fit = () => {
      const room = box.clientHeight - (labelEl?.offsetHeight ?? 0) - Math.min(24, box.clientHeight * 0.04);
      // A chosen size is the most the prayer grows to. The fit still shrinks it when the text is long.
      const width = box.clientWidth;
      // The scale raises the maximum too, and the fit below still shrinks the text to the room it has.
      const max = (style?.fontSize ? (width * style.fontSize) / 1920 : width * 0.045) * slideScale;
      // A share of this slide's width, so the floor scales down with a small preview as the text does.
      const min = width * 0.018;
      const step = Math.max(0.5, width / 960);
      let size = max;
      el.style.fontSize = `${size}px`;
      while (el.offsetHeight > room && size > min) {
        size -= step;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    // The box changes size with the window, the mirror's zoom, and a lower third raising the bottom. Fit again each time.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
    observer?.observe(box);
    return () => observer?.disconnect();
  }, [label, text, style, slideScale]);

  const look = { color: style?.textColor, fontFamily: fontCss(style) ?? slideFont, textAlign: style?.textAlign ?? undefined };
  return (
    <div ref={boxRef} className="flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden">
      {label && <div ref={labelRef} className="shrink-0 font-mono text-[1.1cqw] font-bold tracking-[0.25em] text-white/70 uppercase">{label}</div>}
      <p ref={textRef} className={`${label ? 'mt-[1.5cqh]' : ''} ${className}`} style={look}>{slideText(text, charsPerLine(0.84, 4.5 * 19.2))}</p>
    </div>
  );
}

/**
 * One frame. `sharedBackground` is set by the projector when the Media Library's background is on screen behind every slide: the Live set's
 * slides then draw no background of their own, so it shows through them.
 */
function FrameView({ frame, sharedBackground = false }: { frame: Frame; sharedBackground?: boolean }) {
  const slideFont = useSlideFont();
  const slideScale = useSlideScale();
  // The background behind the Live set's slides: its own saved setting, separate from the Welcome background.
  const ownBackground = welcomeBackground(useOutput((s) => s.welcome.slideBackground));
  // A face that has media draws no colour of its own; the shared layer below already has its shade, so the face adds none.
  const pwBackground = sharedBackground ? SEE_THROUGH : ownBackground;
  // The title above a slide's text, on every kind of slide: the slot or reading banner, a prayer's or announcement's heading, a song's label. The
  // operator can hide it, for every slide or for one Holy Mass plan. A heading that is all the slide says stays, so hiding titles never blanks the screen.
  const showSlotTitle = useOutput(slotTitleShown);
  switch (frame.kind) {
    case 'idle':
    case 'blackout':
    case 'black':
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
            {showSlotTitle && <div className={`${SLOT_TITLE} text-gold/70`}>Congregation response</div>}
            <p className={`${showSlotTitle ? 'mt-[1.5cqh]' : ''} max-w-[88cqw] font-serif text-[length:min(3.6cqw,76px)] leading-[1.2] font-bold text-gold ${LEGIBLE}`}>
              <span className="mr-[0.4em]">℟</span>
              {slideLine(frame.response, charsPerLine(0.86, 3.6 * 19.2))}
            </p>
          </div>
          <div className="absolute inset-x-0 top-[34cqh] bottom-0 flex items-center justify-center px-[6cqw]">
            <TextLines safe inset={false} serif lines={(frame.pages[frame.index] ?? '').split('\n')} style={frame.style} />
          </div>
          {frame.pages.length > 1 && (
            <div className="pointer-events-none absolute right-[4cqw] bottom-[3cqh] z-20 font-mono text-[1cqw] text-white/40">
              {frame.index + 1} / {frame.pages.length}
            </div>
          )}
        </>
      );
    case 'lyrics':
      return <SongLyricsSlide label={showSlotTitle ? frame.label : ''} text={frame.text} style={frame.style ?? null} slideFont={slideFont} slideScale={slideScale} song={frame.song ?? null} />;
    case 'text': {
      const headingHidden = Boolean(frame.headline) && !showSlotTitle && frame.text.trim().length > 0;
      // A prayer's page shares a top with its other pages. A short one is centred in the text area, at whatever size its block is drawn.
      const prayerPlace = !frame.key?.startsWith('prayer:') ? null : frame.centred ? { centre: textAreaShare().centre } : { top: frame.top ?? textAreaShare().top };
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
          {/* A prayer's page (a Notes & Prayers slide) starts at its top, the same rule as the lineup: a shared top, or centred when short. All text is fitted in the safe box. */}
          {frame.headline ? (
            <HeadedText headline={headingHidden ? '' : frame.headline} body={frame.text} style={frame.style} place={prayerPlace} />
          ) : (
            <TextLines safe lines={frame.text.split('\n')} style={frame.style} />
          )}
          {/* A prayer split into slides shows its place, as the psalm pages do. */}
          {frame.page && frame.page.total > 1 && (
            <div className="pointer-events-none absolute right-[4cqw] bottom-[3cqh] z-20 font-mono text-[1cqw] text-white/40">
              {frame.page.index + 1} / {frame.page.total}
            </div>
          )}
        </>
      );
    }
    case 'pw':
      // A Praise & Worship slide. It draws its own background, so it fills the stage.
      return <PwSlideFace slide={frame.slide} segmentName={frame.segmentName} hideTitle={!showSlotTitle} type={frame.type} index={frame.index} total={frame.total} slideFont={slideFont} slideScale={slideScale} footer={frame.footer} background={pwBackground} />;
    case 'whiteboard':
      // Sized to the space the screen leaves, so the lower-third clearance on the parent shortens it too.
      return (
        <div className="h-full w-full">
          <SlideCanvas slide={frame.slide} hideTitle={!showSlotTitle} className="h-full w-full" />
        </div>
      );

    case 'rosary': {
      const heading = showSlotTitle || frame.text.trim().length === 0;
      // One column: header at the top, the prayer in the space between the header and the beads, beads at the bottom.
      // It fills its parent rather than the screen, so the lower-third clearance on the parent shortens it too.
      return (
        <div
          className="apcc-legible-stroke flex h-full w-full flex-col items-center px-[6cqw] pt-[5cqh] pb-[5cqh] text-center"
          style={{ textShadow: LEGIBLE_TEXT_SHADOW }}
        >
          <div className="shrink-0">
            {heading && (
              <div className="font-mono text-[1cqw] font-bold tracking-[0.25em] text-gold uppercase">
                {frame.section}
                {frame.decade && ` · ${frame.decade}`}
              </div>
            )}
            {heading && frame.mystery && (
              <div className="mt-[1cqh] font-serif text-[length:min(3.6cqw,80px)] leading-none font-semibold tracking-wide text-gold">{frame.mystery}</div>
            )}
            {frame.scripture && <div className="mt-[0.8cqh] font-serif text-[1.3cqw] tracking-wide text-gold/80 italic">{frame.scripture}</div>}
          </div>
          <FittedPrayer
            label={heading ? frame.prayer : ''}
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
          {showSlotTitle && <div className={`absolute top-[4cqh] right-[12cqw] left-[4cqw] truncate ${SLOT_TITLE} text-white/45`}>{frame.labels?.[frame.index] ?? frame.title}</div>}
          <Slide safe header={showSlotTitle} lines={lines} style={frame.style} />
          {frame.slides.length > 1 && (
            <div className="pointer-events-none absolute right-[4cqw] bottom-[4cqh] z-20 font-mono text-[1cqw] text-white/40">
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
function useFadedFrame(live: Frame, fadeMs: number, overlap = false) {
  const [shown, setShown] = useState<Frame>(live);
  const [fading, setFading] = useState(false);
  // Counts each new foreground frame, so the foreground re-mounts and plays its entrance animation.
  const [serial, setSerial] = useState(0);
  // The slide that is leaving, kept on screen under the new one while a dissolve or a push plays. Null otherwise.
  const [leaving, setLeaving] = useState<{ frame: Frame; serial: number } | null>(null);
  // Every state update from the main process brings a fresh copy of the frame, so the object's identity changes even when
  // the frame does not (a queue edit, for example). The content key tells a new frame apart, so only a real change replays.
  const key = JSON.stringify(live);
  const latest = useRef(live);
  latest.current = live;
  // What is on screen now, read by the next change without waiting for a render.
  const current = useRef({ frame: live, serial: 0 });

  useEffect(() => {
    const frame = latest.current;
    const before = current.current;
    if (frame.kind !== 'idle') {
      setShown(frame);
      setFading(false);
      // The same slide with new words (a live edit): swapped in place, with no transition and nothing leaving.
      if (before.frame.kind !== 'idle' && slideIdentity(before.frame) === slideIdentity(frame)) {
        current.current = { frame, serial: before.serial };
        return;
      }
      const next = before.serial + 1;
      current.current = { frame, serial: next };
      setSerial(next);
      if (!overlap || fadeMs <= 0 || before.frame.kind === 'idle') {
        setLeaving(null);
        return;
      }
      setLeaving({ frame: before.frame, serial: before.serial });
      const timer = window.setTimeout(() => setLeaving(null), fadeMs);
      return () => window.clearTimeout(timer);
    }
    setLeaving(null);
    setFading(true);
    const timer = window.setTimeout(() => {
      current.current = { frame: IDLE, serial: before.serial };
      setShown(IDLE);
      setFading(false);
    }, fadeMs);
    return () => window.clearTimeout(timer);
  }, [key, fadeMs, overlap]);

  return { frame: shown, fading, serial, leaving };
}

/**
 * A song's stanza on the projector, the mirror and the previews. The stanza is set at the song's size (times the text scale) and shrinks to fit
 * when it is too long for the slide: it stays inside 90% of the room left by a padding of 4% top and bottom and 6% at the sides, centred both
 * ways, and is clipped there at worst, never past the slide's edge (see useTextAutoFit). A short chorus keeps its size; a long verse gets
 * tighter line spacing as well as a smaller size. Centred by default. The shadow keeps the text legible over moving backgrounds. A song's own
 * style replaces the default size, face, colour and alignment, and keeps the shadow.
 */
function SongLyricsSlide({ label, text, style, slideFont, slideScale, song }: { label: string; text: string; style: TextStyle | null; slideFont: string | undefined; slideScale: number; song: { hymnId: number; position: number } | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const sizes = customSizes(style);
  const naturalSize = scaledSize(sizes ? `${sizes.body / 19.2}cqw` : 'min(4.6cqw,96px)', slideScale);
  const shown = slideText(text, charsPerLine(0.88, sizes ? sizes.body : 4.6 * 19.2));
  const { isTruncated } = useTextAutoFit({ boxRef, textRef, reservedRef: labelRef, naturalSize, deps: [shown, style, slideFont, label] });
  // True on the congregation's projector, false on the operator's mirror and previews. The warning is for the operator only.
  const audience = useContext(OnAirLook);
  return (
    <div ref={boxRef} className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-[6cqw] py-[4cqh] text-center" style={{ textAlign: style?.textAlign ?? 'center' }}>
      {label && <div ref={labelRef} className="mb-[3cqh] shrink-0 font-mono text-[1.1cqw] font-bold tracking-[0.25em] text-white/70 uppercase">{label}</div>}
      <p
        ref={textRef}
        className={`apcc-legible-stroke max-w-[88cqw] overflow-hidden font-bold whitespace-pre-line ${sizes ? '' : 'text-white'}`}
        style={{
          textShadow: LEGIBLE_TEXT_SHADOW,
          color: style?.textColor,
          fontFamily: fontCss(style) ?? slideFont,
          fontSize: naturalSize,
          lineHeight: lineHeightFor(lineCountOf(shown)),
          textAlign: style?.textAlign ?? 'center',
        }}
      >
        {shown}
      </p>
      {!audience && isTruncated && song && <TextCutBadge song={song} />}
    </div>
  );
}

/**
 * The operator's warning on a stanza whose last lines are cut off: drawn on the mirror and the previews, never on the projector (see
 * OnAirLook). Pressing it asks the operator window to open the stanza for splitting, which works from the mirror's own window too.
 */
function TextCutBadge({ song }: { song: { hymnId: number; position: number } }) {
  const lang = useUi((s) => s.lang);
  return (
    <button
      type="button"
      data-operator-only
      onClick={() => dispatch({ type: 'operator/splitStanza', hymnId: song.hymnId, position: song.position })}
      title={pwT(lang, 'textCutOffTip')}
      className="absolute right-[1.5cqw] bottom-[1.5cqh] z-20 inline-flex items-center gap-[0.5cqw] rounded-full border border-amber-300/70 bg-amber-500/90 px-[1.1cqw] py-[0.5cqh] text-[max(10px,1.05cqw)] font-bold text-stone-950 shadow-lg transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:outline-none"
    >
      <span aria-hidden>⚠</span>
      {pwT(lang, 'textCutOff')}
    </button>
  );
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
  dissolve: 'apcc-enter-fade',
  push: 'apcc-enter-push',
  slideLeft: 'apcc-enter-left',
  slideRight: 'apcc-enter-right',
  slideUp: 'apcc-enter-up',
  zoomIn: 'apcc-enter-zoom',
};

/** A push eases out hard, so the slides settle rather than stop. */
const PUSH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** The entrance animation for a new foreground frame. A zero duration (transitions off) means none. */
const enterAnimation = (style: ProjectorSettings['transitionStyle'], ms: number) =>
  ms > 0 ? `${ENTER_ANIMATION[style]} ${ms}ms ${style === 'push' ? PUSH_EASING : 'ease-out'} both` : undefined;

/** The exit animation of the slide that leaves, for the transitions that keep it on screen while the next one arrives. */
const EXIT_ANIMATION: Partial<Record<ProjectorSettings['transitionStyle'], string>> = { dissolve: 'apcc-exit-fade', push: 'apcc-exit-push' };
const exitAnimation = (style: ProjectorSettings['transitionStyle'], ms: number) =>
  `${EXIT_ANIMATION[style] ?? 'apcc-exit-fade'} ${ms}ms ${style === 'push' ? PUSH_EASING : 'ease-in-out'} both`;

/** The Live set's slide face with no background of its own, so the Media Library's background shows through it. */
const SEE_THROUGH = { color: null, media: { kind: 'image' as const, src: '', fit: 'cover' as const, loop: false }, shade: false };

/**
 * What makes two frames the same slide. A lyric slide is its song and stanza, so an edit to the words on screen swaps them in place, with no
 * transition. Anything else is the frame itself.
 */
function slideIdentity(frame: Frame): string {
  if (frame.kind === 'lyrics' && frame.key && frame.song) return `lyrics|${frame.key}|${frame.song.position}`;
  // A lineup lyric slide is its card, its place in the card, and the stanza page it shows.
  if (frame.kind === 'pw' && frame.slide.kind === 'lyrics') {
    return `pw|${frame.segmentName}|${frame.index}|${frame.slide.hymnId}|${frame.slide.sectionId}|${frame.slide.part ?? 0}`;
  }
  return JSON.stringify(frame);
}

/**
 * The advanced output styling, as custom properties and the class that applies them to every line of slide text. Off gives nothing, and
 * each slide keeps its own look.
 */
function advancedTextLook(settings: ProjectorSettings): { className: string; style: Record<string, string> } {
  if (!settings.advancedOutput) return { className: '', style: {} };
  const style: Record<string, string> = {
    '--apcc-text-shadow': settings.textShadow > 0 ? `0 0.12cqw ${(0.2 + settings.textShadow * 0.6).toFixed(2)}cqw rgba(0, 0, 0, ${settings.textShadow})` : 'none',
    '--apcc-text-stroke': settings.textOutline > 0 ? `0.07cqw rgba(0, 0, 0, ${settings.textOutline})` : '0 transparent',
  };
  if (settings.textColor) style['--apcc-text-color'] = settings.textColor;
  return { className: `apcc-advanced-text${settings.textColor ? ' apcc-text-color' : ''}`, style };
}

/**
 * The background behind the text on screen now, for auto-legibility, and the surface that draws its shade. The Welcome screen draws its own
 * picture over everything; a Live set slide draws the slide background unless the Media Library's is shown everywhere; any other slide sits
 * on the Media Library's background when one is live. Null when the text is on a plain colour.
 */
function legibilitySource({
  frame,
  background,
  slideMedia,
  welcomeMedia,
  sharedBackground,
  ratio,
}: {
  frame: Frame;
  background: MediaFrame | null;
  slideMedia: { kind: 'image' | 'video'; src: string; fit: 'cover' | 'contain' } | null | undefined;
  welcomeMedia: { kind: 'image' | 'video'; src: string; fit: 'cover' | 'contain' } | null | undefined;
  sharedBackground: boolean;
  ratio: number;
}): { target: ShadeTarget; asset: BackgroundAsset } | null {
  const own = (target: ShadeTarget, media: { kind: 'image' | 'video'; src: string; fit: 'cover' | 'contain' }) => {
    const src = getSlideImageUrl(media.src);
    return src ? { target, asset: { src, kind: media.kind, fit: media.fit, aspect: ratio } } : null;
  };
  if (frame.kind === 'welcome') return welcomeMedia ? own('welcome', welcomeMedia) : null;
  if (frame.kind === 'pw' && slideMedia && !sharedBackground) return own('slide', slideMedia);
  if (!background || !TEXT_ON_BACKGROUND.has(frame.kind)) return null;
  const src = background.mediaType === 'video' ? background.src : getSlideImageUrl(background.src);
  return src ? { target: 'library', asset: { src, kind: background.mediaType === 'video' ? 'video' : 'image', fit: 'cover', aspect: ratio } } : null;
}

/** The frames that draw text over the Media Library background. A picture slide covers it, and an empty screen has no text to protect. */
const TEXT_ON_BACKGROUND = new Set<Frame['kind']>(['text', 'deck', 'lyrics', 'psalm', 'rosary', 'whiteboard', 'pw', 'announcements']);

/** The text colour a slide chose, when it chose one. */
function frameTextColor(frame: Frame): string | null {
  return 'style' in frame && frame.style && typeof frame.style === 'object' && 'textColor' in frame.style ? (frame.style.textColor ?? null) : null;
}

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

/**
 * Congregation screen. With `mirror`, the same view becomes the operator's confidence monitor. The congregation's picture draws the look
 * that is on air, which stays as it was at the pause until the projector resumes. The mirror draws the working look, so the operator sees
 * every change as it is made.
 */
export function ProjectorView(props: { mirror?: boolean; embedded?: boolean }) {
  return (
    <OnAirLook.Provider value={!props.mirror}>
      <ProjectorViewBody {...props} />
    </OnAirLook.Provider>
  );
}

/**
 * One frame drawn as the projector draws it, filling its box. For the operator's previews (the next slide, a slide not yet shown): nothing
 * here is on air, so it uses the working look and has no fades, background video or lower third. `counter` is the operator's place in the item,
 * drawn in the slide's own proportions so it stays in the margin the text keeps clear, however small the preview is.
 */
export function FramePreview({ frame, counter }: { frame: Frame; counter?: string }) {
  const introSlideMode = useOutput((s) => s.introSlideMode);
  const shown = presentedFrame(frame, introSlideMode);
  return (
    <OnAirLook.Provider value={false}>
      <div className="relative isolate h-full w-full overflow-hidden bg-stone-950 text-white select-none [container-type:size]">
        {(shown.kind === 'lyrics' || shown.kind === 'rosary') && shown.style?.bgColor && (
          <div className="absolute inset-0" style={{ backgroundColor: shown.style.bgColor }} />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <FrameView frame={shown} />
        </div>
        {counter && (
          <span className="pointer-events-none absolute right-[4cqw] bottom-[2cqh] z-20 rounded-full bg-black/75 px-[1.2cqw] font-mono text-[length:max(7px,1.4cqw)] font-bold tracking-wider text-white shadow">
            {counter}
          </span>
        )}
      </div>
    </OnAirLook.Provider>
  );
}

function ProjectorViewBody({ mirror = false, embedded = false }: { mirror?: boolean; embedded?: boolean }) {
  const projector = useOutput((s) => s.projector);
  const projectorOn = useOutput((s) => s.outputs.projector);
  const settings = useOutput((s) => s.settings);
  const calibration = useOutput((s) => s.calibration);
  const counter = useOutput((s) => s.counter);
  const noteOverlay = useOutput((s) => s.noteOverlay);
  const sanctuaryAlert = useOutput((s) => s.sanctuaryAlert ?? null);
  // Transitions off means changes switch at once, so the fade and the entrance both take no time.
  const transitionMs = settings.transitionsOn ? settings.fadeMs : 0;
  // While the projector is paused, the operator's mirror shows the staged frame, so it follows every change. The projector
  // itself keeps the frame it was showing until it resumes.
  // The intro slide shows as its title card or as black, by the operator's choice on the Live panel.
  const introSlideMode = useOutput((s) => s.introSlideMode);
  // The same goes for a row the operator has just staged from the planner: the mirror shows it until something else goes live.
  const stagePeek = useUi((s) => s.stagePeek);
  const picture = presentedFrame(mirrorSource(projector, { mirror, peek: stagePeek }), introSlideMode);
  const overlap = (OVERLAP_TRANSITIONS as readonly string[]).includes(settings.transitionStyle);
  const { frame, fading, serial, leaving } = useFadedFrame(picture, transitionMs, overlap);
  const textLook = advancedTextLook(settings);

  // Blackout hides the background as well as the foreground, and keeps it queued for when it lifts.
  const blackedOut = picture.kind === 'blackout';
  // The Live set's background picture or video: one layer for the whole slide sequence, kept outside the slides so a slide change never restarts it.
  const slideMedia = welcomeBackground(useOutput((s) => s.welcome.slideBackground)).media;
  // The projector output shows nothing while its master switch is OFF, whatever the live buffer holds.
  // The operator mirror is a separate monitor with its own toggle, so it is not gated by this switch.
  const outputShowing = mirror || projectorOn;
  const background = blackedOut || !outputShowing ? null : projector.background?.live ?? null;
  // The Media Library's background over every slide: the Live set's slides show it in place of their own background.
  const sharedBackground = Boolean(background && settings.backgroundEverywhere);
  const shownFrame = outputShowing ? frame : IDLE;
  // The lower third is drawn over the picture while it is live. Blackout and a switched-off projector hide it,
  // and it fades out rather than cutting.
  const lowerThirdLive = useOutput((s) => s.lowerThird.live);
  const lowerThirdValue = outputShowing && !blackedOut ? lowerThirdLive : null;
  // A note overlay is drawn over the picture while it is sent. Text clears it the same way it clears a lower third.
  const noteLive = outputShowing && !blackedOut ? noteOverlay : null;
  const noteFaded = useFadedNote(noteLive, settings.fadeMs);
  // The Sanctuary Alert is drawn whenever the output is showing, over Blackout too: the operator sent it on purpose, and it is urgent.
  const alertLive = outputShowing ? sanctuaryAlert : null;
  // While a lower third is on, text moves clear of it. Other text centres in the space above it. A scripture
  // passage moves up by 18% of the screen height, so the verses sit clear of the nameplate. The alert banner moves it the same way, so the
  // last lyric line is never hidden under the banner; the slide itself, and the operator's place in it, do not change.
  const raised = Boolean(lowerThirdValue || noteLive || alertLive);
  const clearance = !raised
    ? ''
    : shownFrame.kind === 'deck' && shownFrame.passage
      ? '-translate-y-[18cqh]'
      : TEXT_FRAME_KINDS.has(shownFrame.kind)
        ? 'pb-[18cqh]'
        : '';

  const ratio = aspectRatioOf(settings.aspect);

  // Auto-legibility: the background actually behind the text is measured, and its shade and the text shadow follow it.
  const welcomeMedia = welcomeBackground(useOutput((s) => s.welcome)).media;
  const welcomeTextColor = useOutput((s) => s.welcome.textColor);
  const legibilityTarget = legibilitySource({ frame: shownFrame, background, slideMedia, welcomeMedia, sharedBackground, ratio });
  const textColor = (settings.advancedOutput && settings.textColor) || (shownFrame.kind === 'welcome' ? welcomeTextColor : frameTextColor(shownFrame));
  const plan = useBackgroundLegibility(legibilityTarget?.asset ?? null, textColor, settings.autoLegibility);
  const shadeChoice: ShadeChoice = settings.autoLegibility
    ? { manual: null, measured: plan && legibilityTarget ? { target: legibilityTarget.target, scrim: plan.scrim } : null }
    : { manual: settings.manualShade, measured: null };
  const libraryShade = shadeChoice.manual !== null ? { top: shadeChoice.manual, center: shadeChoice.manual, lower: shadeChoice.manual } : shadeChoice.measured?.target === 'library' ? shadeChoice.measured.scrim : null;
  const legibleVars = settings.autoLegibility ? legibilityShadowVars(plan) : {};
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
    <LegibilityContext.Provider value={shadeChoice}>
    <div className="relative isolate overflow-hidden [container-type:size]" style={{ ...stageStyle, ...legibleVars }}>
      {background && <BackgroundLayer media={background} />}
      {slideMedia && <SlideBackgroundLayer media={slideMedia} visible={outputShowing && !blackedOut && shownFrame.kind === 'pw' && !sharedBackground} />}
      {/* A song's or prayer's background colour fills the screen only when no motion background is playing, so it never covers the media. */}
      {!background && shownFrame.kind === 'idle' && <IdleScreen mode={settings.idle} media={settings.idleMedia} />}
      {shownFrame.kind === 'black' && <div className="absolute inset-0 bg-black" />}
      {!background && (shownFrame.kind === 'lyrics' || shownFrame.kind === 'rosary') && shownFrame.style?.bgColor && (
        <div className="absolute inset-0" style={{ backgroundColor: shownFrame.style.bgColor }} />
      )}

      {/* The shade over a background sits outside the slides, so it holds still while they change. */}
      {background && <div aria-hidden className="absolute inset-0" style={gradientShadeStyle(libraryShade, LIBRARY_SHADE)} />}

      {/* The slide that is leaving, during a dissolve or a push. It is drawn under the new one and is gone when the transition ends. */}
      {leaving && outputShowing && (
        <div
          key={`leaving-${leaving.serial}`}
          aria-hidden
          className={`pointer-events-none absolute inset-0 flex items-center justify-center will-change-[opacity,transform] ${clearance} ${textLook.className}`}
          style={{ ...textLook.style, animation: exitAnimation(settings.transitionStyle, transitionMs) }}
        >
          <FrameView frame={leaving.frame} sharedBackground={sharedBackground} />
        </div>
      )}

      <div
        key={serial}
        className={`absolute inset-0 flex items-center justify-center transition-[padding,opacity,transform] ${
          fading ? 'opacity-0' : 'opacity-100'
        } ${leaving ? 'will-change-[opacity,transform]' : ''} ${clearance} ${textLook.className}`}
        style={{ ...textLook.style, transitionDuration: `${transitionMs}ms`, animation: enterAnimation(settings.transitionStyle, transitionMs) }}
      >
        <FrameView frame={shownFrame} sharedBackground={sharedBackground} />
      </div>

      <LowerThirdOverlay value={lowerThirdValue} lyricBottomShare={lyricBottomOf(shownFrame)} />

      {calibration && <CalibrationGrid />}

      {noteFaded.shown && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-[45] flex justify-center transition-opacity ease-in-out ${noteFaded.visible ? 'opacity-100' : 'opacity-0'}`}
          style={{ bottom: lowerThirdValue ? '24cqh' : alertLive ? '13cqh' : '5cqh', transitionDuration: `${settings.fadeMs}ms` }}
        >
          <NoteCallout value={noteFaded.shown} />
        </div>
      )}

      {/* The Sanctuary Alert: the top layer of the stage. It never changes the slides under it. */}
      <SanctuaryAlertOverlay value={alertLive} />

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
    </LegibilityContext.Provider>
    </div>
  );
}
