import { BookOpen, Cross, Music } from 'lucide-react';
import type { PwSlide, PwType } from '../../shared/pw.js';
import { TEXT_FONTS } from '../../shared/text-style.js';

const TYPE_ICON = { prayer: Cross, song: Music, scripture: BookOpen } as const;

/**
 * One Praise & Worship slide, drawn the way the projector draws it. Every size is a share of the stage
 * (container units), so a thumbnail and the projector match. The parent sets `container-type: size`.
 *
 * Slides always use the default (dark) palette: `data-theme="default"` re-points the theme tokens on this
 * element, so a light operator theme never puts a light slide on the projector or in its preview.
 */
export function PwSlideFace({
  slide,
  segmentName,
  type,
  index,
  total,
  footer,
}: {
  slide: PwSlide;
  segmentName: string;
  type: PwType;
  index: number;
  total: number;
  /** Bottom-left caption: the song's title, or "Pray together". */
  footer?: string;
}) {
  const position = total > 1 ? `${index + 1} / ${total}` : '';

  if (slide.kind === 'title') {
    const Icon = TYPE_ICON[type];
    return (
      <div data-theme="default" className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqh] bg-canvas px-[8cqw] text-center text-fg">
        <Icon aria-hidden className="size-[6cqw] text-gold" strokeWidth={1.25} />
        <h2 className="text-[6.2cqw] leading-[1.15] tracking-[0.08em] uppercase" style={{ fontFamily: TEXT_FONTS.display.css, fontWeight: 700 }}>
          {slide.label}
        </h2>
        <div aria-hidden className="h-[0.35cqh] w-[12cqw] bg-gold" />
        {slide.subtitle && <p className="text-[2.2cqw] tracking-wide text-muted">{slide.subtitle}</p>}
      </div>
    );
  }

  if (slide.kind === 'prayer') {
    return (
      <div data-theme="default" className="absolute inset-0 bg-canvas text-fg">
        <div className="absolute inset-0 bg-panel" />
        <div className="absolute top-[7cqh] left-[6cqw] text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{slide.label}</div>
        <p
          className={`absolute inset-x-[6cqw] top-1/2 -translate-y-1/2 font-serif text-[5cqw] leading-[1.25] whitespace-pre-line ${slide.placeholder ? 'text-muted italic' : 'font-semibold'}`}
        >
          {slide.text}
        </p>
        <div className="absolute bottom-[7cqh] left-[6cqw] text-[1.6cqw] text-muted">{footer}</div>
        {position && <div className="absolute right-[6cqw] bottom-[7cqh] font-mono text-[1.6cqw] text-muted">{position}</div>}
      </div>
    );
  }

  return (
    <div data-theme="default" className="absolute inset-0 bg-canvas text-fg">
      <div className="absolute top-[7cqh] left-[6cqw] text-[1.6cqw] font-bold tracking-[0.2em] text-gold uppercase">{slide.label}</div>
      <div className="absolute top-[7cqh] right-[6cqw] text-[1.6cqw] text-muted">{segmentName}</div>
      <p className="absolute inset-x-[6cqw] top-1/2 -translate-y-1/2 text-center font-serif text-[5cqw] leading-[1.18] font-semibold whitespace-pre-line">
        {slide.text}
      </p>
      <div className="absolute bottom-[7cqh] left-[6cqw] text-[1.6cqw] text-muted">{footer}</div>
      {position && <div className="absolute right-[6cqw] bottom-[7cqh] font-mono text-[1.6cqw] text-muted">{position}</div>}
    </div>
  );
}
