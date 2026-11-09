import { useLayoutEffect, useState, type RefObject } from 'react';
import { fitFontSize, titleFits } from '../../shared/text-fit.js';
import { FIT_FLOOR_CQW } from './useTextAutoFit';

interface Options {
  /** The slide box the title and body must stay inside. Its padding is left free. */
  boxRef: RefObject<HTMLElement | null>;
  /** The title. Null when the title is hidden, and the body then has all the room. */
  titleRef: RefObject<HTMLElement | null>;
  /** The body. Null on a slide that is only a title, and the title then has all the room. */
  bodyRef: RefObject<HTMLElement | null>;
  /** The sizes the two are set for, as CSS: what each is drawn at when it fits. */
  titleSize: string;
  bodySize: string;
  /** Anything that changes what is drawn: the words, the style. A change fits the text again. */
  deps: unknown[];
}

/**
 * Keeps a title over a body inside its slide. The title is fitted first, to two lines and a quarter of the room, and the body then takes what is
 * left, shrinking to the largest size that fits. Neither grows past the size it was set for, so text that fits looks as it always has.
 *
 * A body too tall at the smallest legible size is clipped inside the room and `overflow` turns true, so the operator's views can say so.
 */
export function useHeadedTextFit({ boxRef, titleRef, bodyRef, titleSize, bodySize, deps }: Options): { overflow: boolean } {
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;

    const fit = () => {
      const title = titleRef.current;
      const body = bodyRef.current;
      const style = getComputedStyle(box);
      const roomHeight = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const roomWidth = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (roomHeight <= 0 || roomWidth <= 0) return;
      const floor = (box.clientWidth * FIT_FLOOR_CQW) / 100;

      let titleBlock = 0;
      let titlePx = Infinity;
      if (title) {
        title.style.fontSize = titleSize;
        const computed = getComputedStyle(title);
        const ceiling = parseFloat(computed.fontSize);
        const leading = parseFloat(computed.lineHeight) / ceiling || 1.2;
        const titleOk = (px: number) => {
          title.style.fontSize = `${px}px`;
          const clear = title.scrollWidth <= roomWidth + 1;
          // A slide that is only a title may use the whole slide.
          return clear && (!body || titleFits(title.scrollHeight, px, leading, roomHeight));
        };
        titlePx = titleOk(ceiling) ? ceiling : fitFontSize(ceiling, floor, titleOk);
        title.style.fontSize = titlePx === ceiling ? titleSize : `${titlePx}px`;
        const gap = body ? parseFloat(getComputedStyle(title.parentElement ?? title).rowGap) || 0 : 0;
        titleBlock = title.offsetHeight + gap;
      }

      let cut = false;
      if (body) {
        body.style.maxHeight = '';
        body.style.overflow = '';
        body.style.fontSize = bodySize;
        const natural = parseFloat(getComputedStyle(body).fontSize);
        // A title shrunk to its two lines sets the limit, so the body is never larger than the title above it.
        const ceiling = Math.min(natural, titlePx);
        const room = roomHeight - titleBlock;
        const bodyOk = (px: number) => {
          body.style.fontSize = `${px}px`;
          return body.scrollHeight <= room + 1 && body.scrollWidth <= roomWidth + 1;
        };
        const size = bodyOk(ceiling) ? ceiling : fitFontSize(ceiling, floor, bodyOk);
        body.style.fontSize = size === natural ? bodySize : `${size}px`;
        cut = body.scrollHeight > room + 1;
        // The fail-safe: what is still too tall at the smallest size is clipped inside the room.
        if (cut) {
          body.style.maxHeight = `${Math.max(0, Math.floor(room))}px`;
          body.style.overflow = 'hidden';
        }
      }
      setOverflow(cut);
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
  }, [titleSize, bodySize, ...deps]);
  return { overflow };
}
