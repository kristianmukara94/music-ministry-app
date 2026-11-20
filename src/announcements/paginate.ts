// Text-slide pagination. Every page is measured with the same layout the projector
// uses (see TextLines in ProjectorView), so a page that fits here fits on the wall.
//
// The projector's classes and these constants describe the same geometry:
//   max-w-[86vw]              -> TEXT_WIDTH_SHARE
//   text-[clamp(..,4.1vw,..)] -> TEXT_FONT_SHARE
//   gap-[2.2vh]               -> TEXT_GAP_SHARE
//   leading-[1.22]            -> TEXT_LINE_HEIGHT
// Change one side and change the other.

import { paginateProse } from '../../shared/prose-pagination.js';

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const BREAK = '---';

export const TEXT_WIDTH_SHARE = 0.86;
export const TEXT_FONT_SHARE = 0.041;
export const TEXT_GAP_SHARE = 0.022;
export const TEXT_LINE_HEIGHT = 1.22;

export type Fits = (text: string) => boolean;

/** Splits the editor text into pages at manual `---` lines. Empty pages are dropped. */
export function pagesOf(master: string): string[] {
  return master
    .split(/^\s*---\s*$/m)
    .map((page) => page.trim())
    .filter(Boolean);
}

/**
 * Packs one section into pages, cutting only at whitespace: lines are kept whole where they fit, a longer line is cut at its sentence ends,
 * then its clauses, then between words, so a word is never carried half onto the next page. The last two pages are evened out and a tiny
 * trailing stub is folded into the page before it (see shared/prose-pagination.js).
 */
export function paginateSection(section: string, fits: Fits): string[] {
  return paginateProse(section, fits);
}

/**
 * Adds automatic breaks wherever a section overflows. Manual breaks are kept, so
 * running this again never moves an operator's own divider.
 */
export function autoPaginateText(master: string, fits: Fits): string {
  return pagesOf(master)
    .flatMap((section) => paginateSection(section, fits))
    .join(`\n${BREAK}\n`);
}

/**
 * Runs `run` with a fit-test that lays text out exactly as the projector does:
 * one paragraph per line, in a column of the projector's width, font size, gap and
 * line height, at the slide's 1920px reference size. A page fits when its height is
 * within `heightShare` of the slide (0.8 by default; the psalm verses get less).
 */
/** Which face the projector sets this text in. The fit test must measure in the same face. */
export type Face = 'sans' | 'serif';

/**
 * `measure` sets the face, weight and size that the slides will use, when the operator has chosen them. Without it the
 * projector's default is measured.
 */
export function withFitter<T>(
  run: (fits: Fits) => T,
  heightShare = 0.8,
  face: Face = 'sans',
  measure?: { fontFamily: string; fontWeight: string; fontSize: number },
): T {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    left: '-99999px',
    top: '0',
    visibility: 'hidden',
    width: `${SLIDE_W * TEXT_WIDTH_SHARE}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: `${SLIDE_H * TEXT_GAP_SHARE}px`,
    textAlign: 'center',
    whiteSpace: 'normal',
    fontFamily: measure?.fontFamily ?? (face === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)'),
    fontWeight: measure?.fontWeight ?? (face === 'serif' ? '600' : '500'),
    fontSize: `${measure?.fontSize ?? SLIDE_W * TEXT_FONT_SHARE}px`,
    lineHeight: `${TEXT_LINE_HEIGHT}`,
  });
  document.body.appendChild(el);

  const limit = SLIDE_H * heightShare;
  try {
    return run((text) => {
      el.replaceChildren(
        ...text.split('\n').map((line) => {
          const p = document.createElement('p');
          p.style.margin = '0';
          p.textContent = line || ' ';
          return p;
        }),
      );
      return el.getBoundingClientRect().height <= limit;
    });
  } finally {
    el.remove();
  }
}
