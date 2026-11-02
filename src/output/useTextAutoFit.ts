import { useLayoutEffect, useState, type RefObject } from 'react';
import { fitFontSize } from '../../shared/text-fit.js';

/** The share of the box's height the text may take, so it never touches the bottom edge. */
export const FIT_HEIGHT_SHARE = 0.9;
/** The smallest the text shrinks to: this share of the size it was set for, and never below `FIT_FLOOR_CQW` of the slide's width. */
export const FIT_FLOOR_SHARE = 0.45;
export const FIT_FLOOR_CQW = 1.8;

interface Options {
  /** The slide box the text sits in. Its padding is left free. */
  boxRef: RefObject<HTMLElement | null>;
  /** The text block that is sized. Its size as set (the song's own size, times the text scale) is the ceiling. */
  textRef: RefObject<HTMLElement | null>;
  /** Anything above or below the text inside the box (the stanza's label), whose height is taken off the room. */
  reservedRef?: RefObject<HTMLElement | null>;
  /** The size the text is set for, as CSS: what it is drawn at when it fits, and what it is reset to before each fit. */
  naturalSize: string;
  /** Anything that changes what is drawn: the words, the style, the scale. A change fits the text again. */
  deps: unknown[];
}

/**
 * Keeps a slide's text inside its slide. The text is drawn at the size it was set for; when that is too tall (a long verse) or too wide, it is
 * shrunk to the largest size that fits within 90% of the room, down to a floor that stays legible. Short text is never grown past the size
 * it was set for, so a two-line chorus looks as it always has.
 *
 * It measures the real text, so it holds for any font, any wrapping and any window. It fits again whenever the box changes size (the
 * projector going full screen, the mirror being resized) and whenever `deps` change. The size is written to the element directly, as the
 * prayer fit does, so a fit does not cost the slide a second render.
 *
 * It returns `isTruncated`: true when the text is still too tall at the floor, so its last lines are clipped. Only the operator's views show
 * it; the state changes only when that answer does, so an ordinary fit never re-renders the slide.
 */
export function useTextAutoFit({ boxRef, textRef, reservedRef, naturalSize, deps }: Options): { isTruncated: boolean } {
  const [isTruncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return undefined;

    const fit = () => {
      // Back to the size it was set for, so a fit after a shorter verse starts from the top again.
      text.style.fontSize = naturalSize;
      text.style.maxHeight = '';
      const ceiling = parseFloat(getComputedStyle(text).fontSize);
      const style = getComputedStyle(box);
      const reserved = reservedRef?.current;
      const reservedHeight = reserved ? reserved.offsetHeight + parseFloat(getComputedStyle(reserved).marginTop) + parseFloat(getComputedStyle(reserved).marginBottom) : 0;
      const roomHeight = (box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) * FIT_HEIGHT_SHARE - reservedHeight;
      const roomWidth = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (!Number.isFinite(ceiling) || roomHeight <= 0 || roomWidth <= 0) return;

      const fits = (px: number) => {
        text.style.fontSize = `${px}px`;
        return text.scrollHeight <= roomHeight && text.scrollWidth <= roomWidth + 1;
      };
      const floor = Math.max(ceiling * FIT_FLOOR_SHARE, (box.clientWidth * FIT_FLOOR_CQW) / 100);
      const size = fitFontSize(ceiling, floor, fits);
      text.style.fontSize = size >= Math.floor(ceiling) ? naturalSize : `${size}px`;
      // At the floor and still too tall: the clip below hides the last lines.
      const cut = size <= Math.ceil(floor) && text.scrollHeight > roomHeight + 1;
      setTruncated((was) => (was === cut ? was : cut));
      // The fail-safe: whatever is still too tall at the floor is clipped inside the room, never past the slide's bottom edge.
      text.style.maxHeight = `${Math.floor(roomHeight)}px`;
    };

    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
    observer?.observe(box);
    // A web font that arrives after the first draw changes the text's size, so the fit runs again once fonts are ready.
    let cancelled = false;
    void document.fonts?.ready.then(() => !cancelled && fit());
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [naturalSize, ...deps]);
  return { isTruncated };
}
