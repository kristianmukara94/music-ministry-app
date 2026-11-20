import { useLayoutEffect, useState, type RefObject } from 'react';
import { pickFitStep } from '../../shared/projector-autofit.js';
import { MIN_READABLE_CQW, fitFontSize, wrapNeeded } from '../../shared/text-fit.js';
import { FIT_FLOOR_CQW } from './useTextAutoFit';

interface Options {
  /** The safe box the text must stay inside. Its padding is the margin kept clear of the title, the page count and the badges. */
  boxRef: RefObject<HTMLElement | null>;
  /** The text block that is sized. */
  textRef: RefObject<HTMLElement | null>;
  /** The size the text is set for, as CSS: the first step. Smaller steps are shares of it. */
  naturalSize: string;
  /** Anything that changes what is drawn: the words, the style, the scale. A change fits the text again. */
  deps: unknown[];
  /**
   * Song lyrics: every line is kept whole (`white-space: pre`), so the steps and the shrink below end where the widest line fits the width,
   * down to the readable size (MIN_READABLE_CQW) rather than the usual floor. Only a line too long to fit whole even there lets the text wrap,
   * and the usual fit then runs on the wrapped text. Off by default: prayers and text slides are laid out to wrap.
   */
  keepLines?: boolean;
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
export function useProjectorTextAutoFit({ boxRef, textRef, naturalSize, deps, keepLines = false }: Options): { overflow: boolean; step: number } {
  const [result, setResult] = useState({ overflow: false, step: 0 });
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return undefined;

    const fit = () => {
      text.style.maxHeight = '';
      text.style.overflow = '';
      const style = getComputedStyle(box);
      const roomHeight = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const roomWidth = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (roomHeight <= 0 || roomWidth <= 0) return;
      // Measured with words unbreakable, so the widest word shows in scrollWidth and the text steps down until it fits whole (see useTextAutoFit).
      text.style.overflowWrap = 'normal';
      const clear = () => text.scrollHeight <= roomHeight + 1 && text.scrollWidth <= roomWidth + 1;
      const run = (floor: number) => {
        const picked = pickFitStep((scale, leading) => {
          text.style.fontSize = scale === 1 ? naturalSize : `calc(${naturalSize} * ${scale})`;
          text.style.lineHeight = leading == null ? '' : String(leading);
          return clear();
        });
        let overflow = picked.overflow;
        if (overflow) {
          // The steps are shares of the set size, so at a large text scale the last one can still be big. Below it, shrink to the legible floor.
          const last = parseFloat(getComputedStyle(text).fontSize);
          const size = fitFontSize(last, Math.min(last, floor), (px) => {
            text.style.fontSize = `${px}px`;
            return clear();
          });
          text.style.fontSize = `${size}px`;
          overflow = !clear();
        }
        return { picked, overflow };
      };
      const floor = (box.clientWidth * FIT_FLOOR_CQW) / 100;
      text.style.whiteSpace = keepLines ? 'pre' : '';
      let { picked, overflow } = run(keepLines ? (box.clientWidth * MIN_READABLE_CQW) / 100 : floor);
      // A line too wide to stay whole even at the readable size: the text wraps after all, fitted the usual way. Too tall only: it stays whole.
      if (keepLines && overflow && wrapNeeded(text.scrollWidth, roomWidth + 1)) {
        text.style.whiteSpace = '';
        ({ picked, overflow } = run(floor));
      }
      // The fail-safe: what is still too tall at the smallest size is clipped inside the room.
      if (overflow) {
        text.style.maxHeight = `${Math.floor(roomHeight)}px`;
        text.style.overflow = 'hidden';
      }
      text.style.overflowWrap = '';
      setResult((was) => (was.overflow === overflow && was.step === picked.index ? was : { overflow, step: picked.index }));
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
  }, [naturalSize, keepLines, ...deps]);
  return result;
}
