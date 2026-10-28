import { BookOpen, Cross, Music } from 'lucide-react';
import type { PwSlide, PwType } from '../../shared/pw.js';
import { LINEUP_LINE_HEIGHT } from '../../shared/prayer-fit.js';
import { PRAYER_WIDTH_SHARE } from '../../shared/prayer-slides.js';
import { textAreaShare, textAreaStyle } from '../../shared/text-area.js';
import type { WelcomeBackground } from '../../shared/welcome-settings.js';
import { charsPerLine, slideLine, slideText } from '../../shared/text-wrap.js';
import { TEXT_FONTS } from '../../shared/text-style.js';
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
}) {
  const position = total > 1 ? `${index + 1} / ${total}` : '';
  // The colour is painted only when the type is Colour. With a picture or a video selected, the slide must not paint over the layer behind it,
  // even when a colour was saved earlier (it stays saved, for when Colour is selected again).
  const colorStyle = background?.color && !background.media ? { backgroundColor: background.color } : undefined;
  // The picture or video covers the slide, then the shade sits behind the text area, then the text is drawn on top (later in the page).
  // The picture or video is not drawn here: it is one layer the surface keeps mounted across slides (see SlideBackgroundLayer), under
  // this slide. So the slide's root is transparent when there is one, and only the shade and the text are drawn on top of it.
  const layers = background?.shade && background.media ? <BackgroundShade area={textAreaStyle()} /> : null;
  const rootClass = background?.media ? 'absolute inset-0 text-fg' : 'absolute inset-0 bg-canvas text-fg';

  if (slide.kind === 'title') {
    const Icon = TYPE_ICON[type];
    return (
      <div data-theme="default" className={rootClass} style={colorStyle}>
        {layers}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqh] px-[8cqw] text-center">
          <Icon aria-hidden className="size-[6cqw] text-gold" strokeWidth={1.25} />
          <h2 className="text-[6.2cqw] leading-[1.15] tracking-[0.08em] uppercase" style={{ fontFamily: TEXT_FONTS.display.css, fontWeight: 700 }}>
            {slideLine(slide.label, charsPerLine(0.84, 6.2 * 19.2))}
          </h2>
          <div aria-hidden className="h-[0.35cqh] w-[12cqw] bg-gold" />
          {slide.subtitle && <p className="text-[2.2cqw] tracking-wide text-muted">{slide.subtitle}</p>}
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
            fontSize: `${(slide.fontPx ?? 96) / 19.2}cqw`,
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
      <p className="absolute inset-x-[6cqw] font-serif text-[5cqw] font-semibold whitespace-pre-line" style={{ top: `${(slide.top ?? textAreaShare().top) * 100}%`, textAlign: slide.align ?? 'center', lineHeight: LINEUP_LINE_HEIGHT }}>
        {slideText(slide.text, charsPerLine(0.88, 5 * 19.2))}
      </p>
      <div className="absolute bottom-[7cqh] left-[6cqw] text-[1.6cqw] text-muted">{footer}</div>
      {position && <div className="absolute right-[6cqw] bottom-[7cqh] font-mono text-[1.6cqw] text-muted">{position}</div>}
    </div>
  );
}
