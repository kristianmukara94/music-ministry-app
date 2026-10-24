import type { CSSProperties } from 'react';
import { TEXT_FONTS } from '../../shared/text-style.js';
import { bulletMark, parseSlideContent, type WhiteboardDesign, type WhiteboardVerse } from '../../shared/whiteboard.js';
import { dotPatternStyle, gradientFrameStyle } from './templates/scriptureTemplate';

/** A size in pixels on the 1920 slide, as a share of the slide's own width. The slide sets `container-type`. */
const cq = (px: number) => `${px / 19.2}cqw`;

const PATTERN: Record<'none' | 'grid' | 'gradient', string | undefined> = {
  none: undefined,
  grid: 'linear-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
  gradient: 'linear-gradient(160deg, rgba(255, 255, 255, 0.10), rgba(0, 0, 0, 0.30))',
};

/** The background behind the text: the chosen pattern, or nothing for a solid colour. */
function backgroundFor(pattern: WhiteboardDesign['pattern']): CSSProperties {
  if (pattern === 'dots') return dotPatternStyle();
  return { backgroundImage: PATTERN[pattern] };
}

/** One verse, in its own style, size and alignment. Boxed and callout styles frame the text; the others mark it with a bar. */
function VerseBlock({ verse, design, family }: { verse: WhiteboardVerse; design: WhiteboardDesign; family: string | undefined }) {
  const frame: CSSProperties =
    verse.style === 'boxed'
      ? { border: `${cq(3)} solid ${design.bulletColor}`, borderRadius: cq(10), padding: cq(20), background: 'rgba(0, 0, 0, 0.25)' }
      : verse.style === 'callout'
        ? { borderLeft: `${cq(10)} solid ${design.bulletColor}`, borderRadius: cq(6), padding: cq(22), background: 'rgba(255, 184, 0, 0.12)' }
        : verse.style === 'italic'
          ? {}
          : { borderLeft: `${cq(6)} solid ${design.bulletColor}`, paddingLeft: cq(20) };
  return (
    <blockquote style={{ margin: 0, textAlign: verse.align, fontFamily: family, ...frame }}>
      {verse.text && (
        <p style={{ margin: 0, fontSize: cq(verse.fontSize), fontStyle: verse.style === 'plain' ? 'normal' : 'italic', lineHeight: 1.3 }}>{verse.text}</p>
      )}
      {verse.showReference && verse.reference && (
        <p className="font-bold tracking-wider uppercase" style={{ margin: `${cq(6)} 0 0`, fontSize: cq(verse.fontSize * 0.5), color: design.bulletColor }}>
          {verse.reference}
        </p>
      )}
    </blockquote>
  );
}

/**
 * One slide, drawn from its design. The same component draws the library thumbnails, the editor preview and the
 * projector, so a slide looks the same wherever it appears. Every size is a share of the slide's width.
 */
export function SlideCanvas({ slide, className = '' }: {
  slide: { title: string; content: string; design: WhiteboardDesign };
  className?: string;
}) {
  const d = slide.design;
  const items = parseSlideContent(slide.content);
  const family = TEXT_FONTS[d.fontFamily as keyof typeof TEXT_FONTS]?.css;
  const body: CSSProperties = {
    fontFamily: family,
    fontSize: cq(d.fontSize),
    fontWeight: d.bodyBold ? 700 : 500,
    fontStyle: d.bodyItalic ? 'italic' : 'normal',
    textAlign: d.align,
    lineHeight: 1.25,
  };
  // Verses are placed by position: top and bottom sit in the text flow, centre and full float over the slide.
  const inFlow = (position: WhiteboardVerse['position']) => d.verses.filter((v) => v.position === position);
  const floating = [...d.verses.filter((v) => v.position === 'center'), ...d.verses.filter((v) => v.position === 'full')];

  return (
    <div
      className={`relative flex flex-col overflow-hidden ${className}`}
      style={{ containerType: 'inline-size', backgroundColor: d.bgColor, color: d.textColor, ...backgroundFor(d.pattern) }}
    >
      {d.border &&
        (d.borderStyle === 'gradient' ? (
          // The gradient frame: its inner box is clear, so only the ring shows the gradient.
          <div aria-hidden className="pointer-events-none absolute inset-[4%]" style={gradientFrameStyle(d.borderWidth)}>
            <div className="h-full w-full" />
          </div>
        ) : (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[4%]"
            style={{ border: `${cq(d.borderWidth)} ${d.borderStyle} ${d.borderColor}` }}
          />
        ))}
      <div className="relative flex min-h-0 flex-1 flex-col justify-start" style={{ padding: '7%' }}>
        {d.titleVisible && slide.title && (
          <div
            className="leading-[1.1]"
            style={{
              fontFamily: family,
              fontSize: cq(d.titleSize),
              fontWeight: d.titleBold ? 800 : 600,
              fontStyle: d.titleItalic ? 'italic' : 'normal',
              textAlign: d.align,
              marginBottom: cq(d.titleSize * 0.5),
            }}
          >
            {slide.title}
          </div>
        )}

        {inFlow('top').length > 0 && (
          <div className="flex flex-col" style={{ gap: cq(d.fontSize * 0.5), marginBottom: cq(d.fontSize * 0.6) }}>
            {inFlow('top').map((verse, i) => (
              <VerseBlock key={`t${i}`} verse={verse} design={d} family={family} />
            ))}
          </div>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: cq(d.fontSize * 0.35) }}>
            {items.map((item, i) => {
              const mark = item.bullet ? bulletMark(d.bulletStyle, i) : '';
              return (
                <li key={i} className="flex items-baseline" style={body}>
                  {mark && (
                    <span className="shrink-0 font-bold" style={{ color: d.bulletColor, marginRight: cq(d.fontSize * 0.45), minWidth: cq(d.fontSize) }}>
                      {mark}
                    </span>
                  )}
                  <span className="min-w-0">{item.text}</span>
                </li>
              );
            })}
          </ul>
        )}

        {inFlow('bottom').length > 0 && (
          <div className="flex flex-col" style={{ gap: cq(d.fontSize * 0.5), marginTop: cq(d.fontSize * 0.9) }}>
            {inFlow('bottom').map((verse, i) => (
              <VerseBlock key={`b${i}`} verse={verse} design={d} family={family} />
            ))}
          </div>
        )}
      </div>

      {floating.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-center" style={{ padding: '10%', gap: cq(d.fontSize * 0.6) }}>
          {floating.map((verse, i) => (
            <VerseBlock key={`f${i}`} verse={verse} design={d} family={family} />
          ))}
        </div>
      )}
    </div>
  );
}
