import { useLayoutEffect, useState } from 'react';
import { balanceProjectorLines } from '../../shared/text-fit.js';

/**
 * A line may use this share of the measured width. The canvas and the page lay text out from the same font, but the outline and the
 * rounding of a scaled mirror can differ by a pixel, and a balanced line that came out a hair too wide would wrap again on screen.
 */
const SLACK = 0.98;

let canvas: HTMLCanvasElement | null = null;

/** Measures text as `el` draws it: its font and letter spacing, in CSS pixels. Null where there is no canvas (a test, a thumbnail). */
function measurerFor(el: Element): ((text: string) => number) | null {
  const ctx = (canvas ??= document.createElement('canvas')).getContext('2d');
  if (!ctx) return null;
  const cs = getComputedStyle(el);
  const font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const spacing = cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px';
  const cache = new Map<string, number>();
  return (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      ctx.font = font;
      ctx.letterSpacing = spacing;
      width = ctx.measureText(text).width;
      cache.set(text, width);
    }
    return width;
  };
}

/**
 * The widest a line of `el` can be: the content width of `box` (the slide's safe box, which never shrinks to its text), less any max-width set
 * on `el` or on the elements between it and the box. Shrink-wrapped elements in between are not measured, since they are only as wide as the
 * text already drawn in them.
 */
function lineRoom(el: HTMLElement, box: HTMLElement): number {
  const boxStyle = getComputedStyle(box);
  let room = box.clientWidth - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight);
  for (let node: HTMLElement | null = el; node && node !== box; node = node.parentElement) {
    const max = getComputedStyle(node).maxWidth;
    if (max.endsWith('px')) room = Math.min(room, parseFloat(max));
  }
  return room;
}

/** What useBalancedText keeps: the balanced paragraphs and the source they were made from. */
export interface BalancedState {
  lines: string[];
  /** The paragraphs as useBalancedText last saw them. */
  key: string;
  result: { key: string; lines: string[] } | null;
  setResult: (update: (was: { key: string; lines: string[] } | null) => { key: string; lines: string[] } | null) => void;
  paragraphs: string[];
  enabled: boolean;
}

/**
 * The paragraphs of a projected slide with their long lines balanced (see balanceProjectorLines): a line that would wrap is broken into
 * even lines at natural phrase breaks instead of filling the first line and leaving a word alone on the last. Off, or until measured, the
 * paragraphs come back as they are. The added breaks are "
".
 *
 * It is in two halves because of order: React runs layout effects in the order they are declared, and the measuring must come after the
 * slide's text fit, at the size the fit chose, while the fit must see the balanced text. So: `const b = useBalancedText(...)`, draw and fit
 * `b.lines`, then `useBalanceAfterFit(b, ...)` below the fit hook (or in the parent of a component that fits: a child's effects run first).
 */
export function useBalancedText(paragraphs: string[], enabled: boolean): BalancedState {
  const key = paragraphs.join('\u0000');
  const [result, setResult] = useState<{ key: string; lines: string[] } | null>(null);
  const lines = enabled && result?.key === key ? result.lines : paragraphs;
  return { lines, key, result, setResult, paragraphs, enabled };
}

interface MeasureOptions {
  /** The element paragraph `index` is drawn in, once it is on the page. Its font is the one measured. Null skips that paragraph. */
  elementFor: (index: number) => HTMLElement | null | undefined;
  /** The slide's safe box: its width bounds every line, and a change of its size reflows the lines. */
  boxFor: () => HTMLElement | null | undefined;
  /** Anything else that changes the size or face the text is drawn at: the text scale, the song's own scale, the style, the font. */
  deps: unknown[];
}

/**
 * The measuring half of useBalancedText. A balanced paragraph has as many lines as the browser's own wrap, so the fit still holds and nothing
 * is pushed past the safe margins. It balances again when the slide, the text scale or the font changes, when the box changes size (the
 * window, a lower third), and once the fonts have loaded.
 */
export function useBalanceAfterFit(state: BalancedState, { elementFor, boxFor, deps }: MeasureOptions): void {
  const { key, paragraphs, enabled, setResult } = state;
  useLayoutEffect(() => {
    if (!enabled) {
      setResult(() => null);
      return undefined;
    }
    const balance = () => {
      const box = boxFor();
      if (!box) return;
      // A paragraph the fit drew with its lines whole (`white-space: pre`, see useTextAutoFit's keepLines) already fits on its own lines, so it
      // keeps what it is drawn from: balancing it would split a line that fits. Only a paragraph the fit let wrap is balanced.
      const whole = paragraphs.map((_, i) => {
        const el = elementFor(i);
        return Boolean(el && getComputedStyle(el).whiteSpace === 'pre');
      });
      const balanced = paragraphs.map((text, i) => {
        const el = elementFor(i);
        if (!el || whole[i] || !text.trim()) return text;
        const measure = measurerFor(el);
        const room = lineRoom(el, box);
        return measure && room > 0 ? balanceProjectorLines(text, room * SLACK, measure) : text;
      });
      setResult((was) => {
        const before = was && was.key === key ? was.lines : paragraphs;
        const lines = balanced.map((line, i) => (whole[i] ? before[i] : line));
        return was && was.key === key && was.lines.every((l, i) => l === lines[i]) ? was : { key, lines };
      });
    };
    balance();

    // A resize also refits the text; balancing waits a frame so it measures at the size the fit settles on.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(balance);
    };
    const box = boxFor();
    const observer = typeof ResizeObserver === 'undefined' || !box ? null : new ResizeObserver(later);
    if (box) observer?.observe(box);
    let cancelled = false;
    void document.fonts?.ready.then(() => !cancelled && later());
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
    // `paragraphs` is represented by `key`; elementFor and boxFor read refs.
  }, [enabled, key, ...deps]);
}
