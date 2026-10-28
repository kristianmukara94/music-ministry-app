import { BookOpen, Cross, Music } from 'lucide-react';
import type { PwSlide, PwType } from '../../shared/pw.js';
import { LINEUP_LINE_HEIGHT } from '../../shared/prayer-fit.js';
import { PRAYER_WIDTH_SHARE } from '../../shared/prayer-slides.js';
import { textAreaShare, textAreaStyle } from '../../shared/text-area.js';
import type { WelcomeBackground } from '../../shared/welcome-settings.js';
import { charsPerLine, slideLine, slideText } from '../../shared/text-wrap.js';
import { TEXT_FONTS, scaledSize } from '../../shared/text-style.js';
import { BackgroundShade } from '../output/BackgroundMedia';

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
  /** The operator's slide text size, as a share of normal (0.7 to 1.5). Undefined keeps the normal size. */
  slideScale?: number;
}) {
  const position = total > 1 ? `${index + 1} / ${total}` : '';
  // The colour is painted only when the type is Colour. With a picture or a video selected, the slide must not paint over the layer behind it,
  // even when a colour was saved earlier (it stays saved, for when Colour is selected again).
  const colorStyle = background?.color && !background.media ? { backgroundColor: background.color } : undefined;
  // The picture or video covers the slide, then the shade sits behind the text area, then the text is drawn on top (later in the page).
  // The picture or video is not drawn here: it is one layer the surface keeps mounted across slides (see SlideBackgroundLayer), under
  // this slide. So the slide's root is transparent when there is one, and only the shade and the text are drawn on top of it.
  const layers = background?.shade && background.media ? <BackgroundShade area={textAreaStyle()} /> : null;
  // The slide canvas clips everything: no text or child can draw outside the 16:9 frame.
  const rootClass = background?.media ? 'absolute inset-0 overflow-hidden text-fg' : 'absolute inset-0 overflow-hidden bg-canvas text-fg';

  if (slide.kind === 'title') {
    const Icon = TYPE_ICON[type];
    // Proportional across the whole 70%-150% range: no ceiling, so every A-/A+ step changes the title. Long titles (more than 25 characters,
    // which wrap to three lines) start smaller, so they stay inside the frame. The line width follows the scaled size.
    const long = slide.label.length > 25;
    const titleCqw = (long ? 3.6 : 4.4) * (slideScale ?? 1);
    const titleChars = charsPerLine(0.84, titleCqw * 19.2);
    // No text-area shade on a title card: the title stands on the picture or the colour itself, with no box behind it. The title is centred
    // on the full frame, and the header and footer badges are pinned to the top and bottom edges, above it.
    return (
      <div data-theme="default" className={rootClass} style={colorStyle}>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-[8cqw] py-[8cqh] text-center">
          <Icon aria-hidden className="mb-[2.5cqh] h-[4cqw] w-[4cqw] shrink-0 text-gold opacity-80" strokeWidth={1.25} />
          <h2 className="max-h-[65cqh] leading-[1.12] tracking-[0.08em] uppercase" style={{ fontFamily: slideFont ?? TEXT_FONTS.display.css, fontWeight: 700, fontSize: `${titleCqw}cqw` }}>
            {slideLine(slide.label, titleChars)}
          </h2>
          <div aria-hidden className="mt-[2.5cqh] h-[0.35cqh] w-[12cqw] bg-gold" />
          {slide.subtitle && <p className="mt-[2cqh] text-[2.2cqw] tracking-wide text-muted">{slide.subtitle}</p>}
        </div>
        <div className="absolute top-[5cqh] left-[6cqw] right-[6cqw] z-10 flex items-center justify-between">
          <span className="text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{segmentName}</span>
        </div>
        <div className="absolute bottom-[5cqh] left-[6cqw] right-[6cqw] z-10 flex items-center justify-between">
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
        <div className="absolute top-[7cqh] left-[6cqw] text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{slideLine(slide.label, charsPerLine(0.88, 1.6 * 19.2))}</div>
        {/* Full size, at the slide's top: the shared top for normal slides, the centred top for a short one (see shared/text-area.js). */}
        <p
          className={`absolute inset-x-[6cqw] font-serif text-[5cqw] whitespace-pre-line ${slide.placeholder ? 'text-muted italic' : 'font-semibold'}`}
          style={{
            top: `${(slide.top ?? textAreaShare().top) * 100}%`,
            textAlign: slide.align ?? 'center',
            lineHeight: LINEUP_LINE_HEIGHT,
            fontFamily: slideFont,
            fontSize: scaledSize(`${(slide.fontPx ?? 96) / 19.2}cqw`, slideScale),
          }}
        >
          {slideText(slide.text, charsPerLine(PRAYER_WIDTH_SHARE, slide.fontPx ?? 96))}
        </p>
        <div className="absolute bottom-[7cqh] left-[6cqw] text-[1.6cqw] text-muted">{footer}</div>
        {position && <div className="absolute right-[6cqw] bottom-[7cqh] font-mono text-[1.6cqw] text-muted">{position}</div>}
      </div>
    );
  }

  return (
    <div data-theme="default" className={rootClass} style={colorStyle}>
      {layers}
      <div className="absolute top-[7cqh] left-[6cqw] text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{slideLine(slide.label, charsPerLine(0.88, 1.6 * 19.2))}</div>
      <div className="absolute top-[7cqh] right-[6cqw] text-[1.6cqw] text-muted">{segmentName}</div>
      {/* Lyrics: the same rule as the prayer, at the slide's top. */}
      <p className="absolute inset-x-[6cqw] font-serif text-[5cqw] font-semibold whitespace-pre-line" style={{ top: `${(slide.top ?? textAreaShare().top) * 100}%`, textAlign: slide.align ?? 'center', lineHeight: LINEUP_LINE_HEIGHT, fontFamily: slideFont, fontSize: scaledSize('5cqw', slideScale) }}>
        {slideText(slide.text, charsPerLine(0.88, 5 * 19.2))}
      </p>
      <div className="absolute bottom-[7cqh] left-[6cqw] text-[1.6cqw] text-muted">{footer}</div>
      {position && <div className="absolute right-[6cqw] bottom-[7cqh] font-mono text-[1.6cqw] text-muted">{position}</div>}
    </div>
  );
}
