import { useLayoutEffect, useState, type RefObject } from 'react';
import { MIN_READABLE_CQW, fitFontSize, fitWholeLines, growByWrapping, wrapNeeded } from '../../shared/text-fit.js';

/** The share of the box's height the text may take, so it never touches the bottom edge. */
export const FIT_HEIGHT_SHARE = 0.9;
/** The smallest the text shrinks to, as a share of the slide's width: about 35px on a 1920 slide, whatever the operator's text size. */
export const FIT_FLOOR_CQW = 1.8;

interface Options {
  /** The slide box the text sits in. Its padding is left free. */
  boxRef: RefObject<HTMLElement | null>;
  /** The text block that is sized. Its size as set (the song's own size, times the text scale) is the ceiling. */
  textRef: RefObject<HTMLElement | null>;
  /** Anything above or below the text inside the box (the stanza's label; a title card's icon, rule and subtitle), whose height is taken off the room. */
  reservedRef?: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[];
  /** The size the text is set for, as CSS: what it is drawn at when it fits, and what it is reset to before each fit. */
  naturalSize: string;
  /** Anything that changes what is drawn: the words, the style, the scale. A change fits the text again. */
  deps: unknown[];
  /** The share of the room's height the text may take. FIT_HEIGHT_SHARE by default; edge-to-edge lets it take almost all of it. */
  heightShare?: number;
  /**
   * Song lyrics: every line of the text is kept whole (drawn with `white-space: pre`) and the size is the least of the set size, the size at
   * which the widest line fits the width, and the size at which all the lines fit the height. Only a line too long to fit whole at the readable
   * size (MIN_READABLE_CQW) lets the text wrap again, and the balancing then evens out those lines. On by default.
   */
  keepLines?: boolean;
  /**
   * The operator asked for the text larger than its layout (A+ above 100%, or MAX). Whole lines would cap the size where the widest line
   * fills the width, so the lines may wrap (balanced) instead when that draws the stanza clearly larger (see growByWrapping). Off by default.
   */
  grow?: boolean;
}

/**
 * Keeps a slide's text inside its slide (for song lyrics, with every line whole: see `keepLines`). The text is drawn at the size it was set for; when that is too tall (a long verse) or too wide, it is
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
export function useTextAutoFit({ boxRef, textRef, reservedRef, naturalSize, deps, heightShare = FIT_HEIGHT_SHARE, keepLines = true, grow = false }: Options): { isTruncated: boolean } {
  const [isTruncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return undefined;

    const fit = () => {
      // Back to the size it was set for, so a fit after a shorter verse starts from the top again.
      text.style.fontSize = naturalSize;
      text.style.maxHeight = '';
      text.style.removeProperty('text-wrap');
      const ceiling = parseFloat(getComputedStyle(text).fontSize);
      const style = getComputedStyle(box);
      const reservedHeight = (Array.isArray(reservedRef) ? reservedRef : [reservedRef]).reduce((sum, ref) => {
        const el = ref?.current;
        if (!el) return sum;
        const css = getComputedStyle(el);
        return sum + el.offsetHeight + parseFloat(css.marginTop) + parseFloat(css.marginBottom);
      }, 0);
      const roomHeight = (box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) * heightShare - reservedHeight;
      const roomWidth = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (!Number.isFinite(ceiling) || roomHeight <= 0 || roomWidth <= 0) return;
      // Measured with words unbreakable, so scrollWidth sees the widest word and the text shrinks until it fits whole. The slide's own
      // `overflow-wrap: break-word` (apcc-prose) comes back after the fit: it only ever breaks a word still wider than the box at the floor.
      text.style.overflowWrap = 'normal';

      const fits = (px: number) => {
        text.style.fontSize = `${px}px`;
        // Its own width counts as well as the box's: a column narrower than the box (max-w) must not have a word run past its side.
        return text.scrollHeight <= roomHeight && text.scrollWidth <= Math.min(roomWidth, text.clientWidth) + 1;
      };
      const floor = (box.clientWidth * FIT_FLOOR_CQW) / 100;
      // Tested at its exact size first: a whole pixel is a large step in a small preview, so the size just below it says nothing about this one.
      const wrapFit = () => {
        text.style.whiteSpace = '';
        return fits(ceiling) ? ceiling : fitFontSize(ceiling, floor, fits);
      };
      let size: number;
      if (keepLines) {
        // Every line whole: unwrapped, scrollWidth is the widest line, so the fit can only end where that line fits the width.
        text.style.whiteSpace = 'pre';
        const readable = (box.clientWidth * MIN_READABLE_CQW) / 100;
        const whole = fitWholeLines(ceiling, readable, fits);
        if (whole != null) size = whole;
        else {
          fits(Math.min(ceiling, readable));
          // Too tall even at the readable size: wrapping would only add lines, so the lines stay whole and the fail-safe below clips.
          size = wrapNeeded(text.scrollWidth, roomWidth + 1) ? wrapFit() : fitFontSize(ceiling, floor, fits);
        }
        // Asked to grow but held back by the widest line: wrapped, balanced lines take the larger size when it is clearly larger.
        if (grow && text.style.whiteSpace === 'pre') {
          const whole = size;
          text.style.setProperty('text-wrap', 'balance');
          const wrapped = wrapFit();
          if (growByWrapping({ requestedPx: ceiling, wholePx: whole, wrappedPx: wrapped })) size = wrapped;
          else {
            text.style.whiteSpace = 'pre';
            text.style.removeProperty('text-wrap');
            size = whole;
          }
        }
      } else size = wrapFit();
      text.style.fontSize = size === ceiling ? naturalSize : `${size}px`;
      // At the floor and still too tall: the clip below hides the last lines.
      const cut = size <= Math.ceil(floor) && text.scrollHeight > roomHeight + 1;
      setTruncated((was) => (was === cut ? was : cut));
      // The fail-safe: whatever is still too tall at the floor is clipped inside the room, never past the slide's bottom edge.
      text.style.maxHeight = `${Math.floor(roomHeight)}px`;
      text.style.overflowWrap = '';
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
  }, [naturalSize, heightShare, keepLines, grow, ...deps]);
  return { isTruncated };
}
