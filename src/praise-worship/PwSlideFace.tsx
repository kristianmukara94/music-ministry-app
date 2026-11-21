import { useRef, type CSSProperties } from 'react';
import { BookOpen, Cross, Music } from 'lucide-react';
import type { PwSlide, PwType } from '../../shared/pw.js';
import { LINEUP_LINE_HEIGHT } from '../../shared/prayer-fit.js';
import { PRAYER_WIDTH_SHARE } from '../../shared/prayer-slides.js';
import { textAreaShare, textAreaStyle } from '../../shared/text-area.js';
import type { WelcomeBackground } from '../../shared/welcome-settings.js';
import { charsPerLine, slideLine, slideText } from '../../shared/text-wrap.js';
import { TEXT_FONTS, scaledSize } from '../../shared/text-style.js';
import { BackgroundShade } from '../output/BackgroundMedia';
import { useProjectorTextAutoFit } from '../output/useProjectorTextAutoFit';
import { useTextAutoFit } from '../output/useTextAutoFit';
import { EDGE_TO_EDGE, edgeToEdgeBox } from '../../shared/text-fit.js';
import { slideTextAlign } from '../../shared/slide-look.js';

const TYPE_ICON = { prayer: Cross, song: Music, scripture: BookOpen } as const;

/**
 * One Praise & Worship slide, drawn the way the projector draws it. Every size is a share of the stage
 * (container units), so a thumbnail and the projector match. The parent sets `container-type: size`.
 *
 * Slides always use the default (dark) palette: `data-theme="default"` re-points the theme tokens on this
 * element, so a light operator theme never puts a light slide on the projector or in its preview.
 *
 * The background is the one the Welcome screen uses (see shared/welcome-settings.js): unset, the slide keeps its own dark colour; a colour
 * fills it; a picture or a video covers it, with a shade behind the text when that is on. The text is drawn on top, as before.
 *
 * Every offset is in container widths (cqw), never container heights (cqh). The slide is always 16:9, so the two are the same length, but a
 * height unit can resolve to zero in a preview box that is sized by its aspect ratio, which stacked the title card on top of itself.
 *
 * The lyric and prayer text is drawn at the same size and place whether the lower third is on or off. The lower third adapts to the text,
 * not the other way round (see shared/lyric-area.js).
 */
export function PwSlideFace({
  slide,
  segmentName,
  type,
  index,
  total,
  footer,
  background = null,
  slideFont,
  slideScale,
  hideTitle = false,
  edgeToEdge = false,
  bandOn = false,
}: {
  slide: PwSlide;
  segmentName: string;
  type: PwType;
  index: number;
  total: number;
  /** Bottom-left caption: the song's title, or "Pray together". */
  footer?: string;
  /** The background behind the slide: colour, picture or video, and the shade. Null keeps the slide's own look. */
  background?: WelcomeBackground | null;
  /** The font the operator chose for slides, as CSS. Undefined keeps the face each part of the slide already uses. */
  slideFont?: string;
  /** The operator's slide text size, as a share of normal (0.5 to 2.5). Undefined keeps the normal size. */
  slideScale?: number;
  /** The operator's Title switch is off: no label or segment name above the text. A title card keeps its title, which is all that card says. */
  hideTitle?: boolean;
  /** Edge-to-edge (the MAX pill): a lyric page fills the slide at the largest size that fits, with a thin clearance at the edges. */
  edgeToEdge?: boolean;
  /** A lower third is on screen: edge-to-edge text keeps the band's room clear at the bottom. */
  bandOn?: boolean;
}) {
  const position = total > 1 ? `${index + 1} / ${total}` : '';
  // The colour is painted only when the type is Colour. With a picture or a video selected, the slide must not paint over the layer behind it,
  // even when a colour was saved earlier (it stays saved, for when Colour is selected again).
  const colorStyle = background?.color && !background.media ? { backgroundColor: background.color } : undefined;
  // The picture or video covers the slide, then the shade sits behind the text area, then the text is drawn on top (later in the page).
  // The picture or video is not drawn here: it is one layer the surface keeps mounted across slides (see SlideBackgroundLayer), under
  // this slide. So the slide's root is transparent when there is one, and only the shade and the text are drawn on top of it.
  const layers = background?.shade && background.media ? <BackgroundShade area={textAreaStyle()} target="slide" /> : null;
  // The slide canvas clips everything: no text or child can draw outside the 16:9 frame.
  const rootClass = background?.media ? 'absolute inset-0 overflow-hidden text-fg' : 'absolute inset-0 overflow-hidden bg-canvas text-fg';

  if (slide.kind === 'picture') {
    // A PowerPoint slide is its own design: drawn whole on black, with no background, caption or count over it.
    return (
      <div data-theme="default" className="absolute inset-0 overflow-hidden bg-black">
        <img src={slide.src} alt={slide.label} draggable={false} className="absolute inset-0 size-full object-contain" />
      </div>
    );
  }

  if (slide.kind === 'title') {
    const Icon = TYPE_ICON[type];
    // Proportional across the whole 50%-250% range: no ceiling, so every A-/A+ step changes the title. Long titles (more than 25 characters,
    // which wrap to three lines) start smaller, so they stay inside the frame. The line width follows the scaled size.
    const long = slide.label.length > 25;
    const titleCqw = (long ? 3.6 : 4.4) * (slideScale ?? 1);
    const titleChars = charsPerLine(0.84, titleCqw * 19.2);
    // No text-area shade on a title card: the title stands on the picture or the colour itself, with no box behind it. The title is centred
    // on the full frame, and the header and footer badges are pinned to the top and bottom edges, above it.
    return (
      <div data-theme="default" className={rootClass} style={colorStyle}>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-[8cqw] py-[4.5cqw] text-center">
          <Icon aria-hidden className="mb-[1.406cqw] h-[4cqw] w-[4cqw] shrink-0 text-gold opacity-80" strokeWidth={1.25} />
          <h2 data-slide-words className="max-h-[36.563cqw] leading-[1.12] tracking-[0.08em] uppercase" style={{ fontFamily: slideFont ?? TEXT_FONTS.display.css, fontWeight: 700, fontSize: `${titleCqw}cqw` }}>
            {slideLine(slide.label, titleChars)}
          </h2>
          <div aria-hidden className="mt-[1.406cqw] h-[0.197cqw] w-[12cqw] bg-gold" />
          {slide.subtitle && <p className="mt-[1.125cqw] text-[2.2cqw] tracking-wide text-muted">{slide.subtitle}</p>}
        </div>
        <div className="absolute top-[2.813cqw] left-[6cqw] right-[6cqw] z-10 flex items-center justify-between">
          <span className="text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{!hideTitle && segmentName}</span>
        </div>
        <div className="absolute bottom-[2.813cqw] left-[6cqw] right-[6cqw] z-10 flex items-center justify-between">
          <span className="text-[1.6cqw] text-muted">{footer}</span>
          {position && <span className="font-mono text-[1.6cqw] text-muted">{position}</span>}
        </div>
      </div>
    );
  }

  if (slide.kind === 'prayer') {
    return (
      <div data-theme="default" className={rootClass} style={colorStyle}>
        {layers}
        {/* The panel tint lifts a prayer off a plain background; a picture or a video is shown as it is, without it. */}
        {!background?.media && <div className="absolute inset-0 bg-panel" />}
        {!hideTitle && <div className="absolute top-[3.938cqw] left-[6cqw] text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{slideLine(slide.label, charsPerLine(0.88, 1.6 * 19.2))}</div>}
        {/* Full size, at the slide's top: the shared top for normal slides, the centred top for a short one (see shared/text-area.js). */}
        <FittedFaceText
          className={`font-serif text-[5cqw] whitespace-pre-line ${slide.placeholder ? 'text-muted italic' : 'font-semibold'}`}
          place={{ top: `${(slide.top ?? textAreaShare().top) * 100}%`, textAlign: slideTextAlign(slide.align) }}
          fontFamily={slideFont}
          naturalSize={scaledSize(`${(slide.fontPx ?? 96) / 19.2}cqw`, slideScale)}
        >
          {slideText(slide.text, charsPerLine(PRAYER_WIDTH_SHARE, slide.fontPx ?? 96))}
        </FittedFaceText>
        <div className="absolute bottom-[3.938cqw] left-[6cqw] text-[1.6cqw] text-muted">{footer}</div>
        {position && <div className="pointer-events-none absolute right-[6cqw] bottom-[3.938cqw] z-20 font-mono text-[1.6cqw] text-muted">{position}</div>}
      </div>
    );
  }

  return (
    <div data-theme="default" className={rootClass} style={colorStyle}>
      {layers}
      {!hideTitle && <div className="absolute top-[3.938cqw] left-[6cqw] text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{slideLine(slide.label, charsPerLine(0.88, 1.6 * 19.2))}</div>}
      {!hideTitle && <div className="absolute top-[3.938cqw] right-[6cqw] text-[1.6cqw] text-muted">{segmentName}</div>}
      {/* Lyrics: the same rule as the prayer, at the slide's top. Edge-to-edge fills the slide instead, clear of the label, footer and band. */}
      {edgeToEdge ? (
        <EdgeToEdgeFaceText
          box={edgeToEdgeBox({ header: !hideTitle, footer: Boolean(footer || position), lowerThird: bandOn })}
          textAlign={slideTextAlign(slide.align)}
          fontFamily={slideFont}
        >
          {slide.text}
        </EdgeToEdgeFaceText>
      ) : (
      <FittedFaceText keepLines className="font-serif text-[5cqw] font-semibold whitespace-pre-line" place={{ top: `${(slide.top ?? textAreaShare().top) * 100}%`, textAlign: slideTextAlign(slide.align) }} fontFamily={slideFont} naturalSize={scaledSize('5cqw', (slideScale ?? 1) * (slide.fontScale ?? 1))} grow={(slideScale ?? 1) * (slide.fontScale ?? 1) > 1}>
        {slideText(slide.text, charsPerLine(0.88, 5 * 19.2 * (slide.fontScale ?? 1)))}
      </FittedFaceText>
      )}
      <div className="absolute bottom-[3.938cqw] left-[6cqw] text-[1.6cqw] text-muted">{footer}</div>
      {position && <div className="pointer-events-none absolute right-[6cqw] bottom-[3.938cqw] z-20 font-mono text-[1.6cqw] text-muted">{position}</div>}
    </div>
  );
}

/**
 * A lyric page edge-to-edge: centred in a box with a thin clearance at the slide's edges (room for the label, the footer and a lower third only
 * when they are shown), starting from a size no stanza can take, so the fit ends at the largest size at which the whole page fits with every
 * line whole (see useTextAutoFit's `keepLines`): a short line is limited by the width, a long page by the height. Offsets are in cqw only, as the rest of the face (see the note on PwSlideFace).
 */
function EdgeToEdgeFaceText({ box, textAlign, fontFamily, children }: { box: { left: number; right: number; top: number; bottom: number }; textAlign: CSSProperties['textAlign']; fontFamily?: string; children: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const naturalSize = `${EDGE_TO_EDGE.ceilingCqw}cqw`;
  // MAX asks for the largest size the slide holds: the lines wrap when that draws the page clearly larger than whole lines can (growByWrapping).
  useTextAutoFit({ boxRef, textRef, naturalSize, deps: [children, fontFamily, box.top, box.bottom], heightShare: EDGE_TO_EDGE.heightShare, grow: true });
  return (
    <div
      ref={boxRef}
      data-edge-to-edge
      className="absolute flex items-center justify-center overflow-hidden"
      style={{ left: `${box.left}cqw`, right: `${box.right}cqw`, top: `${box.top}cqw`, bottom: `${box.bottom}cqw` }}
    >
      <p ref={textRef} data-slide-words className="apcc-prose w-full font-serif font-semibold whitespace-pre-line" style={{ fontFamily, fontSize: naturalSize, lineHeight: EDGE_TO_EDGE.leading, textAlign }}>
        {children}
      </p>
    </div>
  );
}

/**
 * The words of a prayer or lyric slide, between their top and the footer. Pagination already lays a page out to fit, so this normally draws it at its
 * own size; when a real font wraps wider than the page was counted, the text steps down rather than running into the footer and the page count.
 * A lyric page (`keepLines`) keeps each of its lines whole: at a large text size the page shrinks to its widest line instead of wrapping a word
 * onto a line of its own, so the CURRENT SLIDE and NEXT SLIDE previews and the projector never leave an orphan or clip at the right edge.
 * `grow` (A+ above 100%) lets those lines wrap, balanced, when that is what it takes to draw the page larger (see growByWrapping).
 */
function FittedFaceText({ className, place, fontFamily, naturalSize, keepLines = false, grow = false, children }: { className: string; place: { top: string; textAlign: CSSProperties['textAlign'] }; fontFamily?: string; naturalSize: string; keepLines?: boolean; grow?: boolean; children: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  useProjectorTextAutoFit({ boxRef, textRef, naturalSize, deps: [children, fontFamily, place.top], keepLines, grow });
  // The line spacing is on the box: the fit clears the text's own when it restores a step, and the text then inherits this.
  return (
    <div ref={boxRef} className="absolute inset-x-[6cqw] bottom-[6.6cqw] overflow-hidden" style={{ ...place, lineHeight: LINEUP_LINE_HEIGHT }}>
      <p ref={textRef} data-slide-words className={`apcc-prose ${className}`} style={{ fontFamily, fontSize: naturalSize }}>
        {children}
      </p>
    </div>
  );
}
