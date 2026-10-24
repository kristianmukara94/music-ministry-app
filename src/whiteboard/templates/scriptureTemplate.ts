import type { CSSProperties } from 'react';
import { SLIDE_DESIGN_DEFAULTS, SLIDE_TEMPLATES, type WhiteboardDesign } from '../../../shared/whiteboard.js';

/** The gold of the scripture look: the title, the text, the bullets and the frame. */
export const SCRIPTURE_GOLD = '#FFB800';
/** The dark navy behind the scripture. */
export const SCRIPTURE_NAVY = '#0F172A';

/** A size in pixels on the 1920 slide, as a share of the slide's own width. The slide sets `container-type`. */
const cq = (px: number) => `${px / 19.2}cqw`;

/**
 * The defaults the Scripture template starts with: a traditional serif, centred, italic text in gold on navy, a dot
 * matrix behind it, and a gradient frame. The operator can change any of it before creating the slide.
 */
export const SCRIPTURE_DESIGN: WhiteboardDesign = {
  ...SLIDE_DESIGN_DEFAULTS,
  titleVisible: true,
  titleSize: 54,
  titleBold: true,
  titleItalic: false,
  fontSize: 36,
  fontFamily: 'serif',
  align: 'center',
  bodyBold: false,
  bodyItalic: true,
  bgColor: SCRIPTURE_NAVY,
  textColor: SCRIPTURE_GOLD,
  bulletStyle: 'bullet',
  bulletColor: SCRIPTURE_GOLD,
  pattern: 'dots',
  border: true,
  borderStyle: 'gradient',
  borderColor: SCRIPTURE_GOLD,
  borderWidth: 3,
  verses: [],
};

/** The whole starting point for a Scripture slide: its title, its outline, and its design. */
export const SCRIPTURE_TEMPLATE = {
  title: SLIDE_TEMPLATES.scripture.title,
  content: SLIDE_TEMPLATES.scripture.content,
  design: SCRIPTURE_DESIGN,
};

/** The dot matrix behind the text: a faint gold dot every 24 units of the slide's width. */
export function dotPatternStyle(): CSSProperties {
  return {
    backgroundImage: 'radial-gradient(rgba(255, 184, 0, 0.16) 1px, transparent 1px)',
    backgroundSize: `${cq(24)} ${cq(24)}`,
  };
}

/**
 * The gradient frame. The gradient fills an outer box whose padding is the frame's width; the inner box is clear, so
 * the slide's own background shows through and only the ring is gradient.
 */
export function gradientFrameStyle(width: number): CSSProperties {
  return {
    background: `linear-gradient(135deg, ${SCRIPTURE_GOLD}, #B45309 50%, ${SCRIPTURE_GOLD})`,
    padding: cq(width),
    boxSizing: 'border-box',
  };
}
