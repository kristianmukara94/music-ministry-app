import { useLayoutEffect, useState, type RefObject } from 'react';
import { pickFitStep } from '../../shared/projector-autofit.js';

interface Options {
  /** The safe box the text must stay inside. Its padding is the margin kept clear of the title, the page count and the badges. */
  boxRef: RefObject<HTMLElement | null>;
  /** The text block that is sized. */
  textRef: RefObject<HTMLElement | null>;
  /** The size the text is set for, as CSS: the first step. Smaller steps are shares of it. */
  naturalSize: string;
  /** Anything that changes what is drawn: the words, the style, the scale. A change fits the text again. */
  deps: unknown[];
}

/**
 * Keeps a Holy Mass Order or text slide inside its safe box. On every draw the text is set at its size, and while it is taller (scrollHeight) or
 * wider than the room the box leaves inside its padding, it is tried at the next step down: 3.5rem → 3.0 → 2.5 → 2.0 → 1.75rem as shares of its
 * size, with tighter line spacing from the third step (see shared/projector-autofit.js). It fits again when the box changes size (the
 * projector going full screen, a preview being resized, a lower third raising the bottom) and when the fonts finish loading.
 *
 * Text still too tall at the smallest step is clipped inside the box, never over the title or the badges, and `overflow` turns true so the
 * operator's views can say so. Slides too long to read are split into parts before they are staged (see splitDeck), so this is rare.
 */
export function useProjectorTextAutoFit({ boxRef, textRef, naturalSize, deps }: Options): { overflow: boolean; step: number } {
  const [result, setResult] = useState({ overflow: false, step: 0 });
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return undefined;

    const fit = () => {
      text.style.maxHeight = '';
      const style = getComputedStyle(box);
      const roomHeight = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const roomWidth = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (roomHeight <= 0 || roomWidth <= 0) return;
      const picked = pickFitStep((scale, leading) => {
        text.style.fontSize = scale === 1 ? naturalSize : `calc(${naturalSize} * ${scale})`;
        text.style.lineHeight = leading == null ? '' : String(leading);
        return text.scrollHeight <= roomHeight + 1 && text.scrollWidth <= roomWidth + 1;
      });
      // The fail-safe: what is still too tall at the smallest step is clipped inside the room.
      if (picked.overflow) text.style.maxHeight = `${Math.floor(roomHeight)}px`;
      setResult((was) => (was.overflow === picked.overflow && was.step === picked.index ? was : { overflow: picked.overflow, step: picked.index }));
    };

    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
    observer?.observe(box);
    let cancelled = false;
    void document.fonts?.ready.then(() => !cancelled && fit());
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [naturalSize, ...deps]);
  return result;
}
